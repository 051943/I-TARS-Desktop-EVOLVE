/**
 * 操作手册三层架构 - 主入口
 * 
 * 导出所有核心模块，供外部集成
 */

export {
  OperationManualManager,
  operationManualManager,
} from './manager';
export {
  OperationManualStore,
  operationManualStore,
} from './store';
export {
  ReplayEngine,
  replayEngine,
} from './replay-engine';
export {
  TaskDomain,
  ReplayStatus,
  LayerEventType,
} from './types';
export type {
  OperationManual,
  ManualStep,
  ExecutionRecord,
  OperationRecord,
  TaskDefinition,
  TaskStep,
  ReplayProgress,
  InstructionMatch,
  LayerEvent,
} from './types';
export {
  initTaskDefinitions,
  getAllTaskDefinitions,
  getTasksByDomain,
} from './tasks';
