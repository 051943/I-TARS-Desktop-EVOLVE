/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';

import { logger } from '@main/logger';
import { StatusEnum } from '@ui-tars/shared/types';
import { type ConversationWithSoM } from '@main/shared/types';
import { GUIAgent, type GUIAgentConfig } from '@ui-tars/sdk';
import { markClickPosition } from '@main/utils/image';
import { UTIOService } from '@main/services/utio';
import { NutJSElectronOperator } from '../agent/operator';
import {
  createRemoteBrowserOperator,
  RemoteComputerOperator,
} from '../remote/operators';
import {
  DefaultBrowserOperator,
  RemoteBrowserOperator,
} from '@ui-tars/operator-browser';
import { showPredictionMarker } from '@main/window/ScreenMarker';
import { SettingStore } from '@main/store/setting';
import { AppState, Operator } from '@main/store/types';
import { GUIAgentManager } from '../ipcRoutes/agent';
import { checkBrowserAvailability } from './browserCheck';
import {
  getModelVersion,
  getSpByModelVersion,
  beforeAgentRun,
  afterAgentRun,
  getLocalBrowserSearchEngine,
} from '../utils/agent';
import { FREE_MODEL_BASE_URL } from '../remote/shared';
import { getAuthHeader } from '../remote/auth';
import { ProxyClient } from '../remote/proxyClient';
import { UITarsModelConfig } from '@ui-tars/sdk/core';
import {
  operationManualManager,
  initTaskDefinitions,
  TaskDomain,
  getAllTaskDefinitions,
} from '../agent/operation-manual';

export const runAgent = async (
  setState: (state: AppState) => void,
  getState: () => AppState,
) => {
  logger.info('runAgent');
  const settings = SettingStore.getStore();
  const { instructions, abortController } = getState();
  assert(instructions, 'instructions is required');

  const language = settings.language ?? 'en';

  logger.info('settings.operator', settings.operator);

  // ========== 三层架构：记忆层匹配 ==========
  const manualDecision = await operationManualManager.decideExecution(instructions);
  const matchedManual = manualDecision.manual;
  const isReplayMode = manualDecision.useReplay && !!matchedManual;

  if (isReplayMode) {
    logger.info(`[三层架构] 命中操作手册: ${matchedManual!.name}，启用坐标辅助模式`);
    logger.info('[三层架构] VLM 继续生成内容，但点击坐标使用手册缓存值');
  } else {
    logger.info('[三层架构] 未匹配操作手册，使用纯视觉多模态模式');
  }

  // 初始化任务定义
  await initTaskDefinitions();

  // 开始记录操作（视觉模式记录新操作，用于更新手册）
  operationManualManager.startRecording();

  // ========== 以下为原有的视觉多模态Agent流程 ==========

  const handleData: GUIAgentConfig<NutJSElectronOperator>['onData'] = async ({
    data,
  }) => {
    const lastConv = getState().messages[getState().messages.length - 1];
    const { status, conversations, ...restUserData } = data;
    logger.info('[onGUIAgentData] status', status, conversations.length);

    // add SoM to conversations
    const conversationsWithSoM: ConversationWithSoM[] = await Promise.all(
      conversations.map(async (conv) => {
        const { screenshotContext, predictionParsed } = conv;
        if (
          lastConv?.screenshotBase64 &&
          screenshotContext?.size &&
          predictionParsed
        ) {
          const screenshotBase64WithElementMarker = await markClickPosition({
            screenshotContext,
            base64: lastConv?.screenshotBase64,
            parsed: predictionParsed,
          }).catch((e) => {
            logger.error('[markClickPosition error]:', e);
            return '';
          });
          return {
            ...conv,
            screenshotBase64WithElementMarker,
          };
        }
        return conv;
      }),
    ).catch((e) => {
      logger.error('[conversationsWithSoM error]:', e);
      return conversations;
    });

    const {
      screenshotBase64,
      predictionParsed,
      screenshotContext,
      screenshotBase64WithElementMarker,
      ...rest
    } = conversationsWithSoM?.[conversationsWithSoM.length - 1] || {};
    logger.info(
      '[onGUIAgentData] ======data======\n',
      predictionParsed,
      screenshotContext,
      rest,
      status,
      '\n========',
    );

    if (
      settings.operator === Operator.LocalComputer &&
      predictionParsed?.length &&
      screenshotContext?.size &&
      !abortController?.signal?.aborted
    ) {
      showPredictionMarker(predictionParsed, screenshotContext);
    }

    // 三层架构：记录操作到记忆层
    if (predictionParsed?.length) {
      for (const parsed of predictionParsed) {
        operationManualManager.recordOperation(
          parsed.action_type,
          parsed.action_inputs as Record<string, unknown>,
          screenshotContext?.size
            ? {
                width: screenshotContext.size.width,
                height: screenshotContext.size.height,
                scaleFactor: screenshotContext.scaleFactor || 1,
              }
            : undefined,
          'success',
          parsed.thought || undefined,
        );
      }
    }

    setState({
      ...getState(),
      status,
      restUserData,
      messages: [...(getState().messages || []), ...conversationsWithSoM],
    });
  };

  let operatorType: 'computer' | 'browser' = 'computer';
  let operator:
    | NutJSElectronOperator
    | DefaultBrowserOperator
    | RemoteComputerOperator
    | RemoteBrowserOperator;

  switch (settings.operator) {
    case Operator.LocalComputer:
      operator = new NutJSElectronOperator();
      operatorType = 'computer';
      break;
    case Operator.LocalBrowser:
      await checkBrowserAvailability();
      const { browserAvailable } = getState();
      if (!browserAvailable) {
        setState({
          ...getState(),
          status: StatusEnum.ERROR,
          errorMsg:
            'Browser is not available. Please install Chrome and try again.',
        });
        return;
      }

      operator = await DefaultBrowserOperator.getInstance(
        false,
        false,
        false,
        getState().status === StatusEnum.CALL_USER,
        getLocalBrowserSearchEngine(settings.searchEngineForBrowser),
      );
      operatorType = 'browser';
      break;
    case Operator.RemoteComputer:
      operator = await RemoteComputerOperator.create();
      operatorType = 'computer';
      break;
    case Operator.RemoteBrowser:
      operator = await createRemoteBrowserOperator();
      operatorType = 'browser';
      break;
    default:
      operator = undefined as any;
      break;
  }

  let modelVersion = getModelVersion(settings.vlmProvider);
  let modelConfig: UITarsModelConfig = {
    baseURL: settings.vlmBaseUrl,
    apiKey: settings.vlmApiKey,
    model: settings.vlmModelName,
    useResponsesApi: settings.useResponsesApi,
  };
  let modelAuthHdrs: Record<string, string> = {};

  if (
    settings.operator === Operator.RemoteComputer ||
    settings.operator === Operator.RemoteBrowser
  ) {
    const useResponsesApi = await ProxyClient.getRemoteVLMResponseApiSupport();
    modelConfig = {
      baseURL: FREE_MODEL_BASE_URL,
      apiKey: '',
      model: '',
      useResponsesApi,
    };
    modelAuthHdrs = await getAuthHeader();
    modelVersion = await ProxyClient.getRemoteVLMProvider();
  }

  // ===== 三层架构：坐标辅助模式（带失败回退） =====
  // 先用缓存坐标执行，如果失败则自动回退到 VLM 坐标
  if (isReplayMode && matchedManual && operator && operator.execute) {
    const originalExecute = operator.execute.bind(operator);
    operator.execute = async (params) => {
      const actionType = params.parsedPrediction?.action_type;
      const thought = (params.parsedPrediction?.thought || '').toLowerCase();

      // 排除字体/样式设置相关操作，这些坐标不固定，走VLM更准
      const styleKeywords = ['字体', '字号', '宋体', '五号', '四号', '加粗', '样式', '下拉框'];
      if (styleKeywords.some((kw) => thought.includes(kw))) {
        return originalExecute(params);
      }

      // 仅对 click 类型尝试使用缓存坐标
      if (actionType === 'click' && thought) {
        const cachedStep = matchedManual.steps.find((s) => {
          if (s.actionType !== 'click') return false;
          const keyTerms = (s.description || '').toLowerCase().match(/[\u4e00-\u9fff]{2,}/g) || [];
          return keyTerms.some((term) => thought.includes(term));
        });

        if (cachedStep?.actionInputs?.start_box) {
          // 保存VLM原始坐标作为回退
          const vlmInputs = { ...params.parsedPrediction.action_inputs };
          // 使用缓存坐标
          params.parsedPrediction.action_inputs = {
            ...params.parsedPrediction.action_inputs,
            start_box: cachedStep.actionInputs.start_box,
          } as any;
          logger.info(`[坐标辅助] 先用缓存坐标: "${(cachedStep.description || '').slice(0, 20)}"`);

          // 尝试用缓存坐标执行
          const result = await originalExecute(params);
          // 如果失败，回退到VLM坐标重试一次
          if (result && (result as any).status === 'error') {
            logger.info('[坐标辅助] 缓存坐标失败，回退到VLM坐标');
            params.parsedPrediction.action_inputs = vlmInputs as any;
            return originalExecute(params);
          }
          return result;
        }
      }
      return originalExecute(params);
    };
    logger.info('[三层架构] 坐标辅助模式已启用（带失败回退）');
  }

  const systemPrompt = getSpByModelVersion(
    modelVersion,
    language,
    operatorType,
  );

  const guiAgent = new GUIAgent({
    model: modelConfig,
    systemPrompt: systemPrompt,
    logger,
    signal: abortController?.signal,
    operator: operator!,
    onData: handleData,
    onError: (params) => {
      const { error } = params;
      logger.error('[onGUIAgentError]', settings, error);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: JSON.stringify({
          status: error?.status,
          message: error?.message,
          stack: error?.stack,
        }),
      });
    },
    retry: {
      model: {
        maxRetries: 5,
      },
      screenshot: {
        maxRetries: 5,
      },
      execute: {
        maxRetries: 1,
      },
    },
    maxLoopCount: settings.maxLoopCount,
    loopIntervalInMs: settings.loopIntervalInMs,
    uiTarsVersion: modelVersion,
  });

  GUIAgentManager.getInstance().setAgent(guiAgent);
  UTIOService.getInstance().sendInstruction(instructions);

  const { sessionHistoryMessages } = getState();

  beforeAgentRun(settings.operator);

  const startTime = Date.now();

  await guiAgent
    .run(instructions, sessionHistoryMessages, modelAuthHdrs)
    .catch((e) => {
      logger.error('[runAgentLoop error]', e);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: e.message,
      });
    });

  logger.info('[runAgent Totoal cost]: ', (Date.now() - startTime) / 1000, 's');

  // 三层架构：结束记录并生成操作手册（支持任何指令，无需预定义任务）
  const finalState = getState();
  const isSuccess = finalState.status === StatusEnum.END;

  // 自动识别领域，未知的归为 CUSTOM
  const domain = instructions.includes('知乎') || instructions.includes('zhihu')
    ? TaskDomain.ZHIHU
    : instructions.includes('word') || instructions.includes('Word')
      ? TaskDomain.WORD
      : instructions.includes('微信') || instructions.includes('wechat')
        ? TaskDomain.WECHAT
        : TaskDomain.CUSTOM;

  // 查找预定义任务，找不到也没关系，manager 会自动创建动态任务
  const taskList = getAllTaskDefinitions();
  const matchedTask = taskList.find((t) => t.domain === domain);

  await operationManualManager.finishRecording({
    instruction: instructions,
    domain,
    taskId: matchedTask?.id,
    success: isSuccess,
    totalDuration: Date.now() - startTime,
  });

  afterAgentRun(settings.operator);
};
