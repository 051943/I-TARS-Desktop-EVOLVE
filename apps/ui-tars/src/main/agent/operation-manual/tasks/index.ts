/**
 * 任务定义注册中心
 * 
 * 集中管理所有阶段的任务定义
 * - 阶段一：知乎（网页）
 * - 阶段二：Word（客户端）
 * - 阶段三：微信（客户端）
 */

import { TaskDefinition, TaskDomain, TaskStep } from '../types';
import { operationManualStore } from '../store';
import { logger } from '@main/logger';

// ========== 阶段一：知乎 ==========

const zhihuSteps: TaskStep[] = [
  { id: 'zhihu-login', order: 1, description: '打开知乎并登录', actionType: 'navigate', dependsOn: [] },
  { id: 'zhihu-write-article', order: 2, description: '进入写文章页面', actionType: 'click', dependsOn: ['zhihu-login'] },
  { id: 'zhihu-input-title', order: 3, description: '输入文章标题', actionType: 'type', dependsOn: ['zhihu-write-article'] },
  { id: 'zhihu-input-content', order: 4, description: '输入文章内容', actionType: 'type', dependsOn: ['zhihu-input-title'] },
  { id: 'zhihu-generate-image', order: 5, description: '生成配图（文生图/Canvas/SVG）', actionType: 'click', dependsOn: ['zhihu-input-content'] },
  { id: 'zhihu-publish', order: 6, description: '发表文章', actionType: 'click', dependsOn: ['zhihu-generate-image'] },
  { id: 'zhihu-search-article', order: 7, description: '搜索到这篇文章', actionType: 'type', dependsOn: ['zhihu-publish'] },
  { id: 'zhihu-comment', order: 8, description: '评论这篇文章', actionType: 'type', dependsOn: ['zhihu-search-article'] },
  { id: 'zhihu-like-favorite', order: 9, description: '点赞、收藏、喜欢', actionType: 'click', dependsOn: ['zhihu-comment'] },
];

// ========== 阶段二：Word ==========

const wordSteps: TaskStep[] = [
  { id: 'word-open-client', order: 1, description: '打开Word客户端', actionType: 'click', dependsOn: [] },
  { id: 'word-new-document', order: 2, description: '新建空白文档', actionType: 'click', dependsOn: ['word-open-client'] },
  { id: 'word-write-content', order: 3, description: '写入文章内容', actionType: 'type', dependsOn: ['word-new-document'] },
  { id: 'word-format-styles', order: 4, description: '设置样式格式（标题/字体/序号等）', actionType: 'click', dependsOn: ['word-write-content'] },
  { id: 'word-save', order: 5, description: '保存文档', actionType: 'hotkey', dependsOn: ['word-format-styles'] },
  { id: 'word-export-pdf', order: 6, description: '导出为PDF文件', actionType: 'click', dependsOn: ['word-save'] },
];

// ========== 阶段三：微信 ==========

const wechatSteps: TaskStep[] = [
  { id: 'wechat-open-client', order: 1, description: '打开微信客户端', actionType: 'click', dependsOn: [] },
  { id: 'wechat-search', order: 2, description: '搜索"火眼审阅"', actionType: 'type', dependsOn: ['wechat-open-client'] },
  { id: 'wechat-select-service', order: 3, description: '选择类型为服务号的结果', actionType: 'click', dependsOn: ['wechat-search'] },
  { id: 'wechat-follow', order: 4, description: '关注该服务号', actionType: 'click', dependsOn: ['wechat-select-service'] },
  { id: 'wechat-send-message', order: 5, description: '发送一段文字私信', actionType: 'type', dependsOn: ['wechat-follow'] },
];

// ========== 任务定义集 ==========

const allTasks: TaskDefinition[] = [
  {
    id: 'zhihu-full-workflow',
    domain: TaskDomain.ZHIHU,
    name: '知乎完整工作流',
    description: '登录知乎 → 写文章 → 生成配图 → 发表 → 搜索 → 评论 → 点赞收藏',
    keywords: ['知乎', 'zhihu', '写文章', '登录', '发表文章', '配图'],
    steps: zhihuSteps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    executionCount: 0,
  },
  {
    id: 'word-document-workflow',
    domain: TaskDomain.WORD,
    name: 'Word文档工作流',
    description: '打开Word → 新建文档 → 写文章 → 设置样式 → 保存 → 导出PDF',
    keywords: ['word', 'Word', '文档', '文字', '保存', 'pdf', '导出'],
    steps: wordSteps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    executionCount: 0,
  },
  {
    id: 'wechat-follow-service',
    domain: TaskDomain.WECHAT,
    name: '微信关注服务号工作流',
    description: '打开微信 → 搜索火眼审阅 → 选择服务号 → 关注 → 发送私信',
    keywords: ['微信', 'wechat', '火眼审阅', '服务号', '关注', '私信'],
    steps: wechatSteps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    executionCount: 0,
  },
];

/** 初始化任务定义到存储 */
export async function initTaskDefinitions(): Promise<void> {
  logger.info('[TaskDefinitions] 初始化任务定义...');
  for (const task of allTasks) {
    await operationManualStore.saveTask(task);
    logger.info(`[TaskDefinitions] 已注册任务: ${task.name} (${task.id})`);
  }
  logger.info(`[TaskDefinitions] 初始化完成，共 ${allTasks.length} 个任务`);
}

/** 获取所有任务定义 */
export function getAllTaskDefinitions(): TaskDefinition[] {
  return allTasks;
}

/** 根据领域获取任务定义 */
export function getTasksByDomain(domain: TaskDomain): TaskDefinition[] {
  return allTasks.filter((t) => t.domain === domain);
}
