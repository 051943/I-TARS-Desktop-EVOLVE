/**
 * 三层架构管理器
 * 
 * 认知层 (Cognition)  →  视觉多模态Agent（已有的GUIAgent）
 * 记忆层 (Memory)     →  操作记录存储与检索
 * 进化层 (Evolution)  →  操作回放（无需视觉多模态）
 * 
 * 工作流程：
 * 1. 收到指令 → 记忆层匹配关键词
 * 2. 匹配成功 → 进化层回放录好的操作序列
 * 3. 匹配失败 → 认知层视觉识别执行 → 记忆层记录操作
 * 4. 记录验证成功 → 进化层学习为新操作手册
 */

import { logger } from '@main/logger';
import { v4 as uuidv4 } from 'uuid';
import {
  OperationManual,
  ManualStep,
  StepActionGroup,
  ExecutionRecord,
  OperationRecord,
  TaskDomain,
  ReplayProgress,
  InstructionMatch,
  LayerEvent,
  LayerEventType,
} from './types';
import { operationManualStore } from './store';
import { replayEngine, ReplayCallback } from './replay-engine';

export type ManagerEventCallback = (event: LayerEvent) => void;
export type ManagerStatusCallback = (status: {
  layer: 'cognition' | 'memory' | 'evolution';
  phase: 'start' | 'end' | 'error';
  message: string;
}) => void;

export class OperationManualManager {
  private static instance: OperationManualManager;
  private eventCallbacks: ManagerEventCallback[] = [];
  private statusCallbacks: ManagerStatusCallback[] = [];
  private currentManual: OperationManual | null = null;
  private currentOperations: OperationRecord[] = [];

  static getInstance(): OperationManualManager {
    if (!OperationManualManager.instance) {
      OperationManualManager.instance = new OperationManualManager();
    }
    return OperationManualManager.instance;
  }

  onEvent(callback: ManagerEventCallback) {
    this.eventCallbacks.push(callback);
  }

  onStatus(callback: ManagerStatusCallback) {
    this.statusCallbacks.push(callback);
  }

  private emitEvent(event: LayerEvent) {
    this.eventCallbacks.forEach((cb) => cb(event));
  }

  private emitStatus(
    layer: 'cognition' | 'memory' | 'evolution',
    phase: 'start' | 'end' | 'error',
    message: string,
  ) {
    this.statusCallbacks.forEach((cb) => cb({ layer, phase, message }));
    logger.info(`[三层架构][${layer}] ${phase}: ${message}`);
  }

  // ========== 记忆层：指令匹配 ==========

  /** 匹配指令到操作手册 */
  async matchInstruction(instruction: string): Promise<InstructionMatch> {
    this.emitStatus('memory', 'start', `匹配指令: ${instruction}`);
    const result = await operationManualStore.matchInstruction(instruction);

    if (result.matched) {
      this.emitEvent({
        type: LayerEventType.MEMORY_MATCHED,
        timestamp: Date.now(),
        data: {
          instruction,
          manualId: result.manual?.id,
          confidence: result.confidence,
        },
      });
      this.emitStatus(
        'memory',
        'end',
        `匹配到操作手册: ${result.manual?.name} (置信度: ${result.confidence})`,
      );
    } else {
      this.emitEvent({
        type: LayerEventType.MEMORY_NO_MATCH,
        timestamp: Date.now(),
        data: { instruction },
      });
      this.emitStatus('memory', 'end', '未匹配到现有操作手册');
    }

    return result;
  }

  // ========== 记录层：记录操作 ==========

  /** 开始记录操作序列 */
  startRecording() {
    this.currentOperations = [];
    this.emitEvent({
      type: LayerEventType.MEMORY_RECORDING,
      timestamp: Date.now(),
    });
    this.emitStatus('memory', 'start', '开始记录操作序列');
  }

  /** 记录单步操作 */
  recordOperation(
    actionType: string,
    actionInputs: Record<string, unknown>,
    screenContext?: { width: number; height: number; scaleFactor: number },
    status: 'success' | 'failed' | 'skipped' = 'success',
    resultDescription?: string,
  ) {
    const record: OperationRecord = {
      stepIndex: this.currentOperations.length,
      actionType,
      actionInputs,
      screenContext,
      duration: 0,
      timestamp: Date.now(),
      status,
      resultDescription,
    };
    this.currentOperations.push(record);
  }

  /** 结束记录并生成操作手册 */
  async finishRecording(params: {
    instruction: string;
    domain: TaskDomain;
    taskId?: string;
    success: boolean;
    totalDuration: number;
  }): Promise<OperationManual | null> {
    const { instruction, domain, taskId: providedTaskId, success, totalDuration } = params;
    // 如果没有提供 taskId，从指令自动生成一个
    const taskId = providedTaskId || this.generateTaskIdFromInstruction(instruction);

    this.emitEvent({
      type: LayerEventType.MEMORY_RECORDED,
      timestamp: Date.now(),
      data: {
        operationCount: this.currentOperations.length,
        success,
      },
    });

    // 保存执行记录
    const executionRecord: ExecutionRecord = {
      id: uuidv4(),
      taskId,
      domain,
      executedAt: Date.now(),
      totalDuration,
      operations: [...this.currentOperations],
      instruction,
      success,
    };
    await operationManualStore.saveExecution(executionRecord);

    if (this.currentOperations.length === 0) {
      this.emitStatus('memory', 'end', '没有操作记录，跳过生成操作手册');
      return null;
    }

    // 生成操作手册（即使 success=false 也生成，未验证的后续可以人工确认）
    const manual = await this.generateManual(taskId, domain, success);
    this.emitStatus('memory', 'end', `操作记录完成，共 ${this.currentOperations.length} 步`);
    return manual;
  }

  /**
   * 从用户的 prompt 指令中解析出步骤列表
   * 支持格式：
   *   "第1步：xxx" / "第2步: xxx"
   *   "Step 1: xxx" / "Step 2. xxx"
   *   "1. xxx" / "2、xxx"
   *   "第一步：xxx" / "第二步：xxx"
   */
  private parsePromptSteps(instruction: string): string[] {
    const steps: string[] = [];

    // 匹配各种编号格式
    const patterns = [
      /第[一二三四五六七八九十]+步[：:]\s*([^\n]+)/g,
      /第(\d+)步[：:]\s*([^\n]+)/g,
      /Step\s+(\d+)[:.\s]+([^\n]+)/gi,
      /^(\d+)[.、．\s]+([^\n]+)/gm,
    ];

    for (const pattern of patterns) {
      const matches = instruction.matchAll(pattern);
      const found: string[] = [];
      for (const m of matches) {
        // 取匹配到的描述部分（最后一个捕获组）
        const desc = m[m.length - 1]?.trim();
        if (desc && desc.length > 3) found.push(desc);
      }
      if (found.length >= 2) {
        // 至少有2个步骤才认为是有效的步骤列表
        steps.push(...found);
        break;
      }
    }

    // 如果没解析出步骤，把指令按换行或句号拆成段落
    if (steps.length === 0) {
      const lines = instruction
        .split(/[\n]+/)
        .map((l) => l.trim().replace(/^[-*]\s*/, ''))
        .filter((l) => l.length > 5);
      if (lines.length >= 2) {
        steps.push(...lines);
      }
    }

    return steps;
  }

  /** 将操作的 action 按 prompt 步骤分组 */
  private groupActionsByPromptStep(
    operations: OperationRecord[],
    promptSteps: string[],
  ): StepActionGroup[] {
    if (promptSteps.length === 0 || operations.length === 0) {
      return [];
    }

    // 过滤掉 finished/call_user 等非执行操作
    const execOps = operations.filter(
      (op) =>
        op.status === 'success' &&
        !['finished', 'call_user'].includes(op.actionType),
    );

    if (execOps.length === 0) return [];

    // 将 action 尽量均匀地分配到各个 prompt 步骤
    const actionsPerStep = Math.max(
      1,
      Math.floor(execOps.length / promptSteps.length),
    );
    const groups: StepActionGroup[] = [];

    for (let i = 0; i < promptSteps.length; i++) {
      const start = i * actionsPerStep;
      const end =
        i === promptSteps.length - 1 ? execOps.length : start + actionsPerStep;
      const stepOps = execOps.slice(start, end);

      groups.push({
        promptStep: promptSteps[i],
        actions: stepOps.map((op, idx) => ({
          order: idx + 1,
          description: op.resultDescription || op.actionType,
          actionType: op.actionType,
          actionInputs: { ...op.actionInputs },
          waitAfterMs: 1500,
          requireVerification: false,
        })),
      });
    }

    return groups;
  }

  /** 从指令生成动态任务ID */
  private generateTaskIdFromInstruction(instruction: string): string {
    // 取指令前20个字符作为标识，去除非单词字符
    const safe = instruction.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 30);
    return `task_dynamic_${safe}_${Date.now()}`;
  }

  /** 从执行记录动态生成关键词 */
  private extractKeywords(instruction: string): string[] {
    // 提取指令中的有意义的词作为关键词
    const words = instruction.split(/[\s,，。.、！!？?；;：:]+/).filter(Boolean);
    // 去重并取前10个
    return [...new Set(words)].slice(0, 10);
  }

  /** 从执行记录生成操作手册 */
  private async generateManual(
    taskId: string,
    domain: TaskDomain,
    executionSuccess = true,
  ): Promise<OperationManual | null> {
    const task = await operationManualStore.getTask(taskId);

    const latestExec = await operationManualStore.getLatestExecution(domain);
    if (!latestExec || latestExec.operations.length === 0) {
      logger.warn('[OperationManual] 没有可用的执行记录');
      return null;
    }

    // 生成步骤：使用 VLM 的 thought（resultDescription）作为步骤描述
    const steps: ManualStep[] = latestExec.operations
      .filter((op) => op.status === 'success')
      .map((op, index) => {
        // 优先使用 VLM 的 thought 作为描述，其次用任务定义中的描述，最后用操作类型
        const description =
          op.resultDescription ||
          (task
            ? task.steps.find((s) => s.actionType === op.actionType)?.description
            : undefined) ||
          `${op.actionType} 操作`;

        return {
          order: index + 1,
          description,
          actionType: op.actionType,
          actionInputs: { ...op.actionInputs },
          waitAfterMs: 1500,
          requireVerification: false,
        };
      })
      .filter((step) => !['finished', 'call_user'].includes(step.actionType) && step.description);

    if (steps.length === 0) {
      logger.warn('[OperationManual] 没有有效的操作步骤');
      return null;
    }

    const manualName = task
      ? `${task.name} 操作手册`
      : `${latestExec.instruction.slice(0, 30)}... 操作手册`;
    const manualKeywords = task
      ? task.keywords
      : this.extractKeywords(latestExec.instruction);

    // 解析 prompt 步骤并分组 action
    const promptSteps = this.parsePromptSteps(latestExec.instruction);
    const stepActions = this.groupActionsByPromptStep(
      latestExec.operations,
      promptSteps,
    );

    const manual: OperationManual = {
      id: uuidv4(),
      name: manualName,
      domain,
      taskId,
      keywords: manualKeywords,
      steps,
      promptSteps,
      stepActions,
      createdAt: Date.now(),
      lastExecutedAt: latestExec.executedAt,
      successCount: executionSuccess ? 1 : 0,
      failureCount: executionSuccess ? 0 : 1,
      verified: executionSuccess,
      version: 1,
    };

    await operationManualStore.saveManual(manual);

    this.emitEvent({
      type: LayerEventType.EVOLUTION_LEARNED,
      timestamp: Date.now(),
      data: {
        manualId: manual.id,
        manualName: manual.name,
        stepCount: steps.length,
      },
    });

    this.emitStatus(
      'evolution',
      'end',
      `学习到新操作手册: ${manual.name} (${steps.length} 步)`,
    );

    return manual;
  }

  // ========== 进化层：执行回放 ==========

  /** 执行操作手册回放 */
  async replayManual(
    manual: OperationManual,
    onProgress?: ReplayCallback,
  ): Promise<{ success: boolean; progress: ReplayProgress }> {
    this.emitStatus(
      'evolution',
      'start',
      `开始回放: ${manual.name} (${manual.steps.length} 步)`,
    );

    this.emitEvent({
      type: LayerEventType.EVOLUTION_REPLAY,
      timestamp: Date.now(),
      data: {
        manualId: manual.id,
        manualName: manual.name,
        stepCount: manual.steps.length,
      },
    });

    if (onProgress) {
      replayEngine.setOnProgress(onProgress);
    }

    const result = await replayEngine.start(manual);

    if (result.success) {
      this.emitEvent({
        type: LayerEventType.EVOLUTION_COMPLETE,
        timestamp: Date.now(),
        data: {
          manualId: manual.id,
          elapsedMs: result.progress.elapsedMs,
        },
      });
      this.emitStatus('evolution', 'end', '回放完成');

      // 更新操作手册统计
      await operationManualStore.updateManual(manual.id, {
        lastExecutedAt: Date.now(),
        successCount: (manual.successCount || 0) + 1,
      });
    } else {
      this.emitEvent({
        type: LayerEventType.EVOLUTION_FALLBACK,
        timestamp: Date.now(),
        data: {
          manualId: manual.id,
          error: result.progress.error,
          currentStep: result.progress.currentStep,
        },
      });
      this.emitStatus('evolution', 'error', `回放失败: ${result.progress.error}`);
    }

    return result;
  }

  // ========== 主流程 ==========

  /**
   * 主流程：判断是否应该使用回放
   * - 如果匹配到操作手册 → 返回 manual 让调用方选择是否回放
   * - 如果未匹配 → 返回 null，调用方执行视觉模式
   */
  async decideExecution(instruction: string): Promise<{
    useReplay: boolean;
    manual?: OperationManual;
    matchResult: InstructionMatch;
  }> {
    this.emitStatus('cognition', 'start', `分析指令: ${instruction}`);

    const matchResult = await this.matchInstruction(instruction);

    if (matchResult.matched && matchResult.manual) {
      // 进化层可用 - 直接回放
      this.emitStatus(
        'cognition',
        'end',
        `命中操作手册，切换到进化层回放模式`,
      );
      return {
        useReplay: true,
        manual: matchResult.manual,
        matchResult,
      };
    }

    // 无匹配 - 使用认知层视觉模式
    this.emitStatus(
      'cognition',
      'end',
      `无匹配操作手册，使用视觉多模态模式`,
    );
    return {
      useReplay: false,
      matchResult,
    };
  }

  /** 获取所有操作手册 */
  async getAllManuals() {
    return operationManualStore.getAllManuals();
  }

  /** 获取所有执行记录 */
  async getAllExecutions() {
    return operationManualStore.getAllExecutions();
  }

  /** 删除操作手册 */
  async deleteManual(id: string) {
    return operationManualStore.deleteManual(id);
  }

  /** 获取当前操作手册 */
  getCurrentManual() {
    return this.currentManual;
  }
}

export const operationManualManager = OperationManualManager.getInstance();
