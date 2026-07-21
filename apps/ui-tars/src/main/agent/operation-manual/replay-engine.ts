/**
 * 进化层 - 操作回放引擎
 *
 * 当记忆层匹配到操作手册后，由回放引擎按步骤执行预定义的操作序列。
 * 每个步骤独立执行、有合理延迟、有清晰的前端进度反馈。
 * 如果某步骤失败，自动回退到视觉多模态模式。
 */

import { Key, keyboard, mouse, Button } from '@computer-use/nut-js';
import { clipboard } from 'electron';
import { logger } from '@main/logger';
import { sleep } from '@ui-tars/shared/utils';
import {
  OperationManual,
  ManualStep,
  ReplayStatus,
  ReplayProgress,
} from './types';

export type ReplayCallback = (progress: ReplayProgress) => void;

/** 根据操作类型返回建议等待时间 (ms) */
function getWaitTimeForAction(actionType: string): number {
  switch (actionType) {
    case 'click':
    case 'left_double':
    case 'right_single':
      return 1500; // 点击后等页面响应
    case 'type':
      return 2000; // 输入后等页面处理
    case 'hotkey':
      return 1500;
    case 'scroll':
      return 1500;
    case 'wait':
      return 5000; // wait本身已等5s
    case 'navigate':
      return 3000; // 导航需要更长时间
    case 'finished':
    case 'call_user':
      return 500;
    default:
      return 1500;
  }
}

export class ReplayEngine {
  private isPlaying = false;
  private abortController: AbortController | null = null;
  private onProgress: ReplayCallback | null = null;

  setOnProgress(callback: ReplayCallback) {
    this.onProgress = callback;
  }

  /** 执行单步操作 */
  private async executeStep(step: ManualStep): Promise<boolean> {
    const { actionType, actionInputs } = step;
    logger.info(
      `[ReplayEngine] >>> 步骤 ${step.order}: ${actionType} | ${step.description}`,
      actionInputs,
    );

    try {
      switch (actionType) {
        // ====== 鼠标操作 ======
        case 'click': {
          const startBox = actionInputs.start_box as string;
          if (startBox) {
            const [x1, y1, x2, y2] = JSON.parse(startBox);
            const cx = Math.floor((x1 + x2) / 2);
            const cy = Math.floor((y1 + y2) / 2);
            logger.info(`[ReplayEngine]    → 点击位置: (${cx}, ${cy})`);
            await mouse.move([{ x: cx, y: cy }]);
            await sleep(300);
            await mouse.click(Button.LEFT);
          }
          break;
        }

        case 'left_double': {
          const startBox = actionInputs.start_box as string;
          if (startBox) {
            const [x1, y1, x2, y2] = JSON.parse(startBox);
            const cx = Math.floor((x1 + x2) / 2);
            const cy = Math.floor((y1 + y2) / 2);
            await mouse.move([{ x: cx, y: cy }]);
            await sleep(300);
            await mouse.click(Button.LEFT);
            await sleep(100);
            await mouse.click(Button.LEFT);
          }
          break;
        }

        case 'right_single': {
          const startBox = actionInputs.start_box as string;
          if (startBox) {
            const [x1, y1, x2, y2] = JSON.parse(startBox);
            const cx = Math.floor((x1 + x2) / 2);
            const cy = Math.floor((y1 + y2) / 2);
            await mouse.move([{ x: cx, y: cy }]);
            await sleep(300);
            await mouse.click(Button.RIGHT);
          }
          break;
        }

        // ====== 键盘操作 ======
        case 'type': {
          const content = actionInputs.content as string;
          if (content) {
            // 处理 \n 换行
            const textToPaste = content
              .replace(/\\n/g, '\n')
              .replace(/\n$/, '');
            logger.info(
              `[ReplayEngine]    → 键入内容: "${textToPaste.slice(0, 50)}${textToPaste.length > 50 ? '...' : ''}"`,
            );
            const originalClipboard = clipboard.readText();
            clipboard.writeText(textToPaste);
            await sleep(200);
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await sleep(100);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
            await sleep(200);
            clipboard.writeText(originalClipboard);
          }
          break;
        }

        case 'hotkey': {
          const keyStr =
            (actionInputs.key as string) || (actionInputs.hotkey as string);
          if (keyStr) {
            logger.info(`[ReplayEngine]    → 快捷键: ${keyStr}`);
            const keys = keyStr.split(' ').map((k) => {
              const lower = k.toLowerCase();
              const keyMap: Record<string, Key> = {
                ctrl: Key.LeftControl,
                control: Key.LeftControl,
                alt: Key.LeftAlt,
                shift: Key.LeftShift,
                enter: Key.Enter,
                tab: Key.Tab,
                escape: Key.Escape,
                esc: Key.Escape,
                v: Key.V,
                c: Key.C,
                a: Key.A,
                s: Key.S,
                x: Key.X,
                z: Key.Z,
                n: Key.N,
                p: Key.P,
                w: Key.W,
                t: Key.T,
                r: Key.R,
                f: Key.F,
                delete: Key.Delete,
                backspace: Key.Backspace,
                space: Key.Space,
              };
              return keyMap[lower] || (lower as unknown as Key);
            });

            for (const k of keys) {
              await keyboard.pressKey(k);
            }
            await sleep(150);
            for (const k of keys) {
              await keyboard.releaseKey(k);
            }
          }
          break;
        }

        // ====== 滚轮操作 ======
        case 'scroll': {
          const direction = actionInputs.direction as string;
          const startBox = actionInputs.start_box as string;
          if (startBox) {
            const [x1, y1, x2, y2] = JSON.parse(startBox);
            const cx = Math.floor((x1 + x2) / 2);
            const cy = Math.floor((y1 + y2) / 2);
            await mouse.move([{ x: cx, y: cy }]);
            await sleep(300);
            const scrollAmount = 5;
            if (direction === 'down') {
              await mouse.scrollDown(scrollAmount);
            } else if (direction === 'up') {
              await mouse.scrollUp(scrollAmount);
            }
          }
          break;
        }

        // ====== 等待 ======
        case 'wait': {
          await sleep(5000);
          break;
        }

        // ====== 特殊动作 ======
        case 'finished':
        case 'call_user':
          break;

        default:
          logger.warn(`[ReplayEngine] 未知操作类型: ${actionType}`);
          break;
      }

      // 步骤执行后的等待：让页面/应用有时间响应
      const waitTime = getWaitTimeForAction(actionType);
      if (waitTime > 0) {
        logger.info(`[ReplayEngine]    → 等待 ${waitTime}ms 让应用响应...`);
        await sleep(waitTime);
      }

      return true;
    } catch (error) {
      logger.error(`[ReplayEngine] ❌ 步骤 ${step.order} 执行失败:`, error);
      return false;
    }
  }

  /** 开始回放 */
  async start(
    manual: OperationManual,
  ): Promise<{ success: boolean; progress: ReplayProgress }> {
    if (this.isPlaying) {
      logger.warn('[ReplayEngine] 已有回放正在执行');
      return {
        success: false,
        progress: {
          status: ReplayStatus.FAILED,
          currentStep: 0,
          totalSteps: manual.steps.length,
          currentDescription: '已有回放正在执行',
          elapsedMs: 0,
        },
      };
    }

    this.isPlaying = true;
    this.abortController = new AbortController();
    const startTime = Date.now();

    const emitProgress = (progress: Partial<ReplayProgress>) => {
      const full: ReplayProgress = {
        status: ReplayStatus.PLAYING,
        currentStep: 0,
        totalSteps: manual.steps.length,
        currentDescription: '',
        elapsedMs: Date.now() - startTime,
        ...progress,
      };
      this.onProgress?.(full);
    };

    const sortedSteps = [...manual.steps].sort((a, b) => a.order - b.order);

    logger.info(
      `[ReplayEngine] === 开始回放: ${manual.name} (${sortedSteps.length} 步) ===`,
    );
    emitProgress({ status: ReplayStatus.PLAYING, currentStep: 0 });

    for (let i = 0; i < sortedSteps.length; i++) {
      const step = sortedSteps[i];

      // 检查是否被中止
      if (this.abortController?.signal.aborted) {
        logger.info('[ReplayEngine] 回放被用户中止');
        emitProgress({
          status: ReplayStatus.FAILED,
          currentStep: i,
          currentDescription: '回放被中止',
          error: '用户中止回放',
        });
        this.isPlaying = false;
        return {
          success: false,
          progress: {
            status: ReplayStatus.FAILED,
            currentStep: i,
            totalSteps: sortedSteps.length,
            currentDescription: '回放被中止',
            error: '用户中止回放',
            elapsedMs: Date.now() - startTime,
          },
        };
      }

      // 向前端报告当前步骤
      emitProgress({
        currentStep: i + 1,
        currentDescription: step.description,
      });

      logger.info(
        `[ReplayEngine] [${i + 1}/${sortedSteps.length}] ${step.description}`,
      );

      // 给用户一个停顿感，让用户能看到步骤变化
      if (i > 0) {
        await sleep(300);
      }

      const success = await this.executeStep(step);

      if (!success) {
        const errorMsg = `步骤 ${step.order} (${step.description}) 执行失败`;
        logger.error(`[ReplayEngine] ❌ ${errorMsg}`);
        emitProgress({
          status: ReplayStatus.FALLBACK,
          currentStep: i + 1,
          currentDescription: step.description,
          error: errorMsg,
        });
        this.isPlaying = false;
        return {
          success: false,
          progress: {
            status: ReplayStatus.FALLBACK,
            currentStep: i + 1,
            totalSteps: sortedSteps.length,
            currentDescription: step.description,
            error: errorMsg,
            elapsedMs: Date.now() - startTime,
          },
        };
      }
    }

    logger.info(
      `[ReplayEngine] === 回放完成 (${(Date.now() - startTime) / 1000}s) ===`,
    );
    emitProgress({ status: ReplayStatus.COMPLETED });
    this.isPlaying = false;

    return {
      success: true,
      progress: {
        status: ReplayStatus.COMPLETED,
        currentStep: sortedSteps.length,
        totalSteps: sortedSteps.length,
        currentDescription: '回放完成',
        elapsedMs: Date.now() - startTime,
      },
    };
  }

  /** 停止回放 */
  stop() {
    this.abortController?.abort();
    this.isPlaying = false;
    logger.info('[ReplayEngine] 回放已停止');
  }
}

export const replayEngine = new ReplayEngine();
