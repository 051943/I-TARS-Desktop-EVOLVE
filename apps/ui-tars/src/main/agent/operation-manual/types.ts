/**
 * 操作手册三层架构 - 类型定义
 * 
 * 三层架构：
 * 1. 认知层 (Cognition Layer) - 视觉多模态Agent
 * 2. 记忆层 (Memory Layer) - 操作记录存储
 * 3. 进化层 (Evolution Layer) - 操作回放
 */

// ========== 任务分类 ==========

/** 任务领域分类 */
export enum TaskDomain {
  ZHIHU = 'zhihu',       // 知乎（网页）
  WORD = 'word',         // Word（客户端）
  WECHAT = 'wechat',     // 微信（客户端）
  CUSTOM = 'custom',     // 自定义/未预定义的任务
}

/** 任务操作步骤定义 - 描述一个完整的操作流 */
export interface TaskStep {
  /** 步骤唯一标识 */
  id: string;
  /** 步骤序号 */
  order: number;
  /** 步骤描述 */
  description: string;
  /** 预期的操作类型 */
  actionType: string;
  /** 步骤依赖 - 前置步骤ID列表 */
  dependsOn: string[];
}

/** 任务定义 */
export interface TaskDefinition {
  /** 任务ID */
  id: string;
  /** 所属领域 */
  domain: TaskDomain;
  /** 任务名称 */
  name: string;
  /** 任务描述 */
  description: string;
  /** 匹配关键词 - 用于判断输入指令是否匹配该任务 */
  keywords: string[];
  /** 任务步骤序列 */
  steps: TaskStep[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 执行次数 */
  executionCount: number;
}

// ========== 操作记录 ==========

/** 单步操作记录 */
export interface OperationRecord {
  /** 操作序号 */
  stepIndex: number;
  /** 操作类型 (click, type, scroll, hotkey, wait, finished, etc.) */
  actionType: string;
  /** 操作输入参数 */
  actionInputs: Record<string, unknown>;
  /** 操作时的屏幕上下文 */
  screenContext?: {
    width: number;
    height: number;
    scaleFactor: number;
  };
  /** 操作耗时 (ms) */
  duration: number;
  /** 操作时间戳 */
  timestamp: number;
  /** 操作结果状态 */
  status: 'success' | 'failed' | 'skipped';
  /** 操作后的页面/应用状态描述 */
  resultDescription?: string;
  /** 操作时的页面URL（浏览器任务） */
  url?: string;
}

/** 完整的一次执行记录 */
export interface ExecutionRecord {
  /** 执行记录ID */
  id: string;
  /** 关联的任务定义ID */
  taskId: string;
  /** 任务领域 */
  domain: TaskDomain;
  /** 执行时间 */
  executedAt: number;
  /** 执行耗时 (ms) */
  totalDuration: number;
  /** 操作步骤列表 */
  operations: OperationRecord[];
  /** 用户原始指令 */
  instruction: string;
  /** 是否成功完成 */
  success: boolean;
  /** 错误信息 */
  errorMessage?: string;
}

// ========== 操作手册 ==========

/** 操作手册 - 经过验证的可回放操作序列 */
export interface OperationManual {
  /** 手册唯一ID */
  id: string;
  /** 手册名称 */
  name: string;
  /** 所属领域 */
  domain: TaskDomain;
  /** 任务定义ID */
  taskId: string;
  /** 匹配指令的关键词列表 */
  keywords: string[];
  /** 操作步骤列表（平铺的所有action） */
  steps: ManualStep[];
  /** ===== 新增：按用户prompt步骤分组的动作序列 ===== */
  /** 用户原始 prompt 拆解出的步骤描述列表 */
  promptSteps: string[];
  /** 每个 prompt 步骤对应的 action 序列（按步骤分组） */
  stepActions: StepActionGroup[];
  /** 创建时间 */
  createdAt: number;
  /** 最后执行时间 */
  lastExecutedAt: number;
  /** 执行成功次数 */
  successCount: number;
  /** 执行失败次数 */
  failureCount: number;
  /** 是否已验证可用 */
  verified: boolean;
  /** 版本号 */
  version: number;
}

/** 每一步 prompt 对应的 action 组 */
export interface StepActionGroup {
  /** prompt 步骤描述（如 "打开Edge浏览器，访问 zhihu.com"） */
  promptStep: string;
  /** 该步骤包含的 action 序列 */
  actions: ManualStep[];
}

/** 手册中的单步操作 */
export interface ManualStep {
  /** 步骤序号 */
  order: number;
  /** 步骤描述 */
  description: string;
  /** 操作类型 */
  actionType: string;
  /** 操作参数 */
  actionInputs: Record<string, unknown>;
  /** 等待时间(ms) - 执行此步骤后等待的时间 */
  waitAfterMs: number;
  /** 是否需要截图验证 */
  requireVerification: boolean;
}

// ========== 回放 ==========

/** 回放执行状态 */
export enum ReplayStatus {
  IDLE = 'idle',
  PLAYING = 'playing',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  FALLBACK = 'fallback', // 回放失败，回退到视觉模式
}

/** 回放进度 */
export interface ReplayProgress {
  /** 回放状态 */
  status: ReplayStatus;
  /** 当前执行到的步骤索引 */
  currentStep: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 当前步骤描述 */
  currentDescription: string;
  /** 错误信息 */
  error?: string;
  /** 已执行时间 (ms) */
  elapsedMs: number;
}

// ========== 指令匹配 ==========

/** 指令匹配结果 */
export interface InstructionMatch {
  /** 是否匹配到操作手册 */
  matched: boolean;
  /** 匹配到的操作手册 */
  manual?: OperationManual;
  /** 匹配置信度 (0-1) */
  confidence: number;
  /** 匹配方式: keyword(关键词) | step(步骤结构) | none(无匹配) */
  matchType?: 'keyword' | 'step' | 'none';
}

// ========== 三层架构事件 ==========

/** 三层架构事件类型 */
export enum LayerEventType {
  /** 认知层: 开始视觉识别 */
  COGNITION_START = 'cognition:start',
  /** 认知层: 视觉识别完成 */
  COGNITION_COMPLETE = 'cognition:complete',
  /** 记忆层: 开始记录 */
  MEMORY_RECORDING = 'memory:recording',
  /** 记忆层: 记录完成 */
  MEMORY_RECORDED = 'memory:recorded',
  /** 记忆层: 匹配到操作手册 */
  MEMORY_MATCHED = 'memory:matched',
  /** 记忆层: 未匹配到操作手册 */
  MEMORY_NO_MATCH = 'memory:no_match',
  /** 进化层: 开始回放 */
  EVOLUTION_REPLAY = 'evolution:replay',
  /** 进化层: 回放完成 */
  EVOLUTION_COMPLETE = 'evolution:complete',
  /** 进化层: 回放失败，回退 */
  EVOLUTION_FALLBACK = 'evolution:fallback',
  /** 进化层: 学习新操作序列 */
  EVOLUTION_LEARNED = 'evolution:learned',
}

/** 三层架构事件 */
export interface LayerEvent {
  type: LayerEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}
