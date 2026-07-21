/**
 * 记忆层 - 操作手册存储服务
 *
 * 使用 Node.js fs 模块 + JSON 文件持久化存储操作手册和执行记录
 * (Electron 主进程不可使用 IndexedDB, 使用文件系统代替)
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { logger } from '@main/logger';
import {
  OperationManual,
  ExecutionRecord,
  TaskDefinition,
  TaskDomain,
} from './types';

const STORAGE_DIR = path.join(app.getPath('userData'), 'operation-manual-data');
const MANUALS_FILE = path.join(STORAGE_DIR, 'manuals.json');
const EXECUTIONS_FILE = path.join(STORAGE_DIR, 'executions.json');
const TASKS_FILE = path.join(STORAGE_DIR, 'tasks.json');

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string): Record<string, T> {
  try {
    ensureStorageDir();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, T>;
  } catch (err) {
    logger.error(`[OperationManual] 读取文件失败 ${filePath}:`, err);
    return {};
  }
}

function writeJsonFile<T>(filePath: string, data: Record<string, T>): void {
  try {
    ensureStorageDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`[OperationManual] 写入文件失败 ${filePath}:`, err);
  }
}

export class OperationManualStore {
  private static instance: OperationManualStore;

  static getInstance(): OperationManualStore {
    if (!OperationManualStore.instance) {
      OperationManualStore.instance = new OperationManualStore();
    }
    return OperationManualStore.instance;
  }

  // ========== 操作手册 CRUD ==========

  /** 保存操作手册 */
  async saveManual(manual: OperationManual): Promise<void> {
    const now = Date.now();
    const record = {
      ...manual,
      lastExecutedAt: manual.lastExecutedAt || now,
      updatedAt: now,
    };
    const all = readJsonFile<OperationManual>(MANUALS_FILE);
    all[manual.id] = record;
    writeJsonFile(MANUALS_FILE, all);
    logger.info(`[OperationManual] 保存操作手册: ${manual.name} (${manual.id})`);
  }

  /** 获取所有操作手册 */
  async getAllManuals(): Promise<OperationManual[]> {
    const items = readJsonFile<OperationManual>(MANUALS_FILE);
    return Object.values(items);
  }

  /** 按领域获取操作手册 */
  async getManualsByDomain(domain: TaskDomain): Promise<OperationManual[]> {
    const all = await this.getAllManuals();
    return all.filter((m) => m.domain === domain);
  }

  /** 获取单个操作手册 */
  async getManual(id: string): Promise<OperationManual | undefined> {
    const all = readJsonFile<OperationManual>(MANUALS_FILE);
    return all[id];
  }

  /** 删除操作手册 */
  async deleteManual(id: string): Promise<boolean> {
    const all = readJsonFile<OperationManual>(MANUALS_FILE);
    if (!all[id]) return false;
    delete all[id];
    writeJsonFile(MANUALS_FILE, all);
    logger.info(`[OperationManual] 删除操作手册: ${id}`);
    return true;
  }

  /** 更新操作手册 */
  async updateManual(
    id: string,
    updates: Partial<OperationManual>,
  ): Promise<OperationManual | null> {
    const all = readJsonFile<OperationManual>(MANUALS_FILE);
    const manual = all[id];
    if (!manual) return null;
    const updated = { ...manual, ...updates, updatedAt: Date.now() };
    all[id] = updated;
    writeJsonFile(MANUALS_FILE, all);
    return updated;
  }

  // ========== 执行记录 CRUD ==========

  /** 保存执行记录 */
  async saveExecution(record: ExecutionRecord): Promise<void> {
    const all = readJsonFile<ExecutionRecord>(EXECUTIONS_FILE);
    all[record.id] = record;
    writeJsonFile(EXECUTIONS_FILE, all);
    logger.info(`[OperationManual] 保存执行记录: ${record.id}`);
  }

  /** 获取领域的最新执行记录 */
  async getLatestExecution(domain: TaskDomain): Promise<ExecutionRecord | undefined> {
    const all = await this.getAllExecutions();
    const domainExecs = all
      .filter((e) => e.domain === domain && e.success)
      .sort((a, b) => b.executedAt - a.executedAt);
    return domainExecs[0];
  }

  /** 获取所有执行记录 */
  async getAllExecutions(): Promise<ExecutionRecord[]> {
    const items = readJsonFile<ExecutionRecord>(EXECUTIONS_FILE);
    return Object.values(items);
  }

  /** 获取任务的执行记录 */
  async getExecutionsByTask(taskId: string): Promise<ExecutionRecord[]> {
    const all = await this.getAllExecutions();
    return all
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => b.executedAt - a.executedAt);
  }

  // ========== 任务定义 CRUD ==========

  /** 保存任务定义 */
  async saveTask(task: TaskDefinition): Promise<void> {
    const all = readJsonFile<TaskDefinition>(TASKS_FILE);
    all[task.id] = task;
    writeJsonFile(TASKS_FILE, all);
  }

  /** 获取所有任务定义 */
  async getAllTasks(): Promise<TaskDefinition[]> {
    const items = readJsonFile<TaskDefinition>(TASKS_FILE);
    return Object.values(items);
  }

  /** 获取任务定义 */
  async getTask(id: string): Promise<TaskDefinition | undefined> {
    const all = readJsonFile<TaskDefinition>(TASKS_FILE);
    return all[id];
  }

  // ========== 关键词匹配 ==========

  /** 将指令拆分成单个有意义的词（中文/英文） */
  private tokenize(text: string): string[] {
    // 先按常见分隔符拆分
    const parts = text.split(/[\s,，。.、！!？?；;：:()（）【】\[\]""'']+/).filter(Boolean);
    const tokens: string[] = [];
    for (const part of parts) {
      // 中文：拆成单个汉字（过滤掉纯数字和太短的）
      // 英文：保留原词
      const hasChinese = /[\u4e00-\u9fff]/.test(part);
      if (hasChinese) {
        // 中文按字符拆，但保留2字以上的有意义的词
        const chars = part.split('');
        for (let i = 0; i < chars.length - 1; i++) {
          const bigram = chars[i] + chars[i + 1];
          if (/[\u4e00-\u9fff]/.test(chars[i]) && /[\u4e00-\u9fff]/.test(chars[i + 1])) {
            tokens.push(bigram);
          }
        }
        // 也加入整词
        tokens.push(part);
      } else {
        // 英文词直接加入
        if (part.length >= 2) tokens.push(part.toLowerCase());
      }
    }
    return [...new Set(tokens)];
  }

  /** 从指令中提取步骤描述（按编号步骤或段落拆分） */
  private extractInstructionSteps(instruction: string): string[] {
    const steps: string[] = [];

    // 匹配中文编号：第1步/第一步/Step 1/1.
    const patterns = [
      /第[一二三四五六七八九十\d]+步[：:]\s*([^\n]+)/g,
      /Step\s+\d+[:.\s]+([^\n]+)/gi,
      /^(\d+)[.、．\s]+([^\n]+)/gm,
    ];

    for (const pattern of patterns) {
      const matches = instruction.matchAll(pattern);
      const found: string[] = [];
      for (const m of matches) {
        const desc = m[m.length - 1]?.trim();
        if (desc && desc.length > 3) found.push(desc.toLowerCase());
      }
      if (found.length >= 2) {
        steps.push(...found);
        return steps;
      }
    }

    // 没有编号步骤，返回空
    return steps;
  }

  /** 比较两个步骤序列的匹配度 */
  private matchStepSequences(
    instructionSteps: string[],
    manualSteps: string[],
  ): { matchCount: number; totalSteps: number } {
    if (instructionSteps.length === 0 || manualSteps.length === 0) {
      return { matchCount: 0, totalSteps: manualSteps.length };
    }

    let matchCount = 0;
    const minLen = Math.min(instructionSteps.length, manualSteps.length);

    for (let i = 0; i < minLen; i++) {
      const instStep = instructionSteps[i];
      const manualStep = manualSteps[i];

      // 检查 manual step 的关键词是否在 instruction step 中
      const manualTokens = this.tokenize(manualStep);
      let stepMatches = 0;
      for (const token of manualTokens) {
        if (token.length >= 2 && instStep.includes(token)) {
          stepMatches++;
        }
      }

      // 如果该步骤匹配到至少一个关键词，认为该步骤匹配
      if (stepMatches > 0) {
        matchCount++;
      }
    }

    return { matchCount, totalSteps: manualSteps.length };
  }

  /** 根据指令搜索匹配的操作手册（增强版：支持步骤结构匹配 + 关键词匹配） */
  async searchManuals(instruction: string): Promise<
    Array<{ manual: OperationManual; score: number; stepMatchScore: number }>
  > {
    const all = await this.getAllManuals();
    const lowerInstruction = instruction.toLowerCase();
    const instructionSteps = this.extractInstructionSteps(instruction);

    const scored = all
      .map((manual) => {
        let score = 0;

        // ===== 第一部分：关键词匹配 =====
        // 1. 精确关键词匹配
        for (const keyword of manual.keywords) {
          if (lowerInstruction.includes(keyword.toLowerCase())) {
            score += 2;
          }
        }
        // 2. 关键词拆字匹配
        for (const keyword of manual.keywords) {
          const kwLower = keyword.toLowerCase();
          if (/[\u4e00-\u9fff]/.test(kwLower)) {
            for (const char of kwLower) {
              if (
                /[\u4e00-\u9fff]/.test(char) &&
                lowerInstruction.includes(char)
              ) {
                score += 0.5;
              }
            }
          }
        }
        // 3. 手册名称匹配
        const nameTokens = this.tokenize(manual.name);
        for (const token of nameTokens) {
          if (lowerInstruction.includes(token.toLowerCase())) {
            score += 1;
          }
        }
        // 4. 域名匹配
        if (lowerInstruction.includes(manual.domain)) {
          score += 2;
        }

        // ===== 第二部分：步骤结构匹配 =====
        let stepMatchScore = 0;
        if (instructionSteps.length > 0 && manual.promptSteps?.length > 0) {
          const { matchCount, totalSteps } = this.matchStepSequences(
            instructionSteps,
            manual.promptSteps,
          );
          // 步骤匹配得分：匹配的步骤数 / 总步骤数，归一化到 0-10
          stepMatchScore = totalSteps > 0 ? (matchCount / totalSteps) * 10 : 0;
          // 步骤匹配的额外加分
          if (matchCount > 0) {
            score += stepMatchScore;
          }
        }

        return { manual, score, stepMatchScore };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored;
  }

  /** 检查指令是否匹配操作手册 (增强匹配：关键词 + 步骤结构) */
  async matchInstruction(instruction: string): Promise<{
    matched: boolean;
    manual?: OperationManual;
    confidence: number;
    matchType: 'keyword' | 'step' | 'none';
  }> {
    const scored = await this.searchManuals(instruction);

    if (scored.length === 0) {
      return { matched: false, confidence: 0, matchType: 'none' };
    }

    const bestMatch = scored[0];
    const lowerInstruction = instruction.toLowerCase();
    const instructionSteps = this.extractInstructionSteps(instruction);

    // 关键词匹配计算
    let matchedKeywords = 0;
    for (const keyword of bestMatch.manual.keywords) {
      if (lowerInstruction.includes(keyword.toLowerCase())) {
        matchedKeywords++;
      }
    }

    const keywordConfidence =
      bestMatch.manual.keywords.length > 0
        ? matchedKeywords / bestMatch.manual.keywords.length
        : 0;

    // 步骤结构匹配计算
    let stepConfidence = 0;
    let matchedByStep = false;
    if (
      instructionSteps.length > 0 &&
      bestMatch.manual.promptSteps?.length > 0
    ) {
      const { matchCount, totalSteps } = this.matchStepSequences(
        instructionSteps,
        bestMatch.manual.promptSteps,
      );
      stepConfidence = totalSteps > 0 ? matchCount / totalSteps : 0;
      // 如果超过一半的步骤匹配，认为是步骤结构匹配
      matchedByStep = totalSteps > 0 && matchCount >= Math.ceil(totalSteps / 2);
    }

    // 综合判定：步骤结构匹配 OR 关键词匹配
    const confidence = Math.max(keywordConfidence, stepConfidence);
    const matched = matchedByStep || matchedKeywords > 0;
    const matchType =
      matchedByStep ? 'step' : matchedKeywords > 0 ? 'keyword' : 'none';

    return {
      matched,
      manual: bestMatch.manual,
      confidence: Math.round(confidence * 100) / 100,
      matchType,
    };
  }
}

export const operationManualStore = OperationManualStore.getInstance();
