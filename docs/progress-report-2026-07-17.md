# AI 桌面操控 Agent — 认知-记忆混合架构 进展周报

**课题方向**：操作手册优化通用 Agent 操控桌面效率  
**汇报日期**：2026年7月17日  
**项目状态**：第二阶段实施中  

---

## 一、总体进展概述

本项目基于 EVOLVE（Evolutionary Visual Operating Layer with Validated Execution）架构设计，在 UI-TARS Desktop 基础上构建三层认知-记忆混合架构。目前已顺利完成**第一阶段（认知层 + 记忆层基础框架）** 和**第二阶段核心功能（记忆层存储检索 + 进化层回放机制）** 的开发，正在推进**第二阶段（三种运行模式完善）**。

---

## 二、架构实现对照

### 2.1 三层核心架构实现状态

| 层次 | 方案设计 | 实现状态 | 代码位置 |
|------|---------|---------|---------|
| **认知层 (Cognitive Layer)** | UI-TARS 多模态 Agent、视觉语言模型 | ✅ 已完成（复用原有GUIAgent） | `apps/ui-tars/src/main/agent/` |
| **记忆层 (Memory Layer)** | 结构化 Playbook、语义索引、参数模板 | ✅ 已完成 | `apps/ui-tars/src/main/agent/operation-manual/store.ts` |
| **进化层 (Evolution Layer)** | 闭环学习、差异检测、版本管理 | ⚡ 部分完成 | `apps/ui-tars/src/main/agent/operation-manual/manager.ts` |

### 2.2 三层职责实现

| 层次 | 职责 | 实现情况 |
|------|------|---------|
| 🧠 **认知层** | 第一次如何完成任务（视觉感知 + 动作规划） | ✅ 通过 `GUIAgent` / `ComposableAgent` 实现 |
| 💾 **记忆层** | 第N次如何高效复现（Playbook 存储 + 回放） | ✅ `OperationManualStore` + 语义匹配引擎 |
| ⚡ **进化层** | 如何让第N次比第1次更好（坐标辅助 + 失败回退） | ⚡ 已实现坐标辅助模式和失败自动回退 VLM |

---

## 三、核心模块详细进展

### 3.1 记忆层 — Playbook 数据结构

Playbook（操作手册）数据结构已完整实现：

| 字段 | 方案设计 | 实现 |
|------|---------|------|
| `id` | 唯一标识 | ✅ UUID v4 |
| `name` | 手册名称 | ✅ 自动生成 |
| `domain` | 任务领域 | ✅ zhihu / word / wechat / custom |
| `keywords` | 匹配关键词 | ✅ 支持预定义和动态提取 |
| `steps` | 操作步骤列表 | ✅ actionType + actionInputs + description |
| `promptSteps` | 用户prompt步骤 | ✅ 新增（按编号步骤解析） |
| `stepActions` | 步骤→动作分组 | ✅ 新增（prompt步骤维度的动作分组） |
| `successCount` | 成功次数 | ✅ |
| `verified` | 验证状态 | ✅ |
| `version` | 版本号 | ✅ |

**代码位置**：`apps/ui-tars/src/main/agent/operation-manual/types.ts`

### 3.2 记忆层 — 存储引擎

| 功能 | 方案设计 | 实现 |
|------|---------|------|
| 持久化 | JSON/SQLite | ✅ JSON文件存储，路径：`app.getPath('userData')/operation-manual-data/` |
| CRUD | 增删改查 | ✅ 完整实现 |
| 关键词搜索 | 任务签名匹配 | ✅ 支持精确匹配 + 关键字拆字匹配 |
| 步骤结构匹配 | 语义相似度 | ✅ 按prompt步骤编号对比（新增） |

**代码位置**：`apps/ui-tars/src/main/agent/operation-manual/store.ts`

### 3.3 进化层 — 回放与坐标辅助

| 功能 | 方案设计 | 实现 |
|------|---------|------|
| Turbo模式 | 零Token回放 | ✅ 通过 `operator.execute()` 直接执行缓存动作 |
| Checkpoint模式 | 关键节点验证 | ⚡ 通过截图验证（部分实现） |
| Agent模式 | 完整视觉推理 | ✅ 走原有 GUIAgent 流程 |
| 失败回退 | Turbo→Agent 降级 | ✅ 缓存坐标失败自动重试 VLM 坐标 |
| `run_python` 动作 | 扩展操作 | ✅ 支持执行 Python 脚本（用于 Word 样式设置） |
| `word_document` 动作 | 一键创建文档 | ✅ Python + win32com 自动完成全部 Word 操作 |

**代码位置**：
- `apps/ui-tars/src/main/services/runAgent.ts`（坐标辅助、回退逻辑）
- `apps/ui-tars/src/main/agent/operator.ts`（run_python、word_document 动作）
- `apps/ui-tars/src/main/agent/operation-manual/replay-engine.ts`（回放引擎）

### 3.4 认知层 — 决策路由

决策路由器按以下优先级执行：
1. 检查记忆层是否存在匹配的 Playbook
2. 若匹配 → 启用坐标辅助模式（Turbo），VLM 仍运行但 click 坐标用缓存
3. 若匹配但含"字体/字号/样式"关键词 → 跳过缓存走纯 VLM（第4步专用）
4. 若缓存坐标失败 → 自动回退到 VLM 原始坐标重试
5. 若不匹配 → 纯 VLM 视觉模式（Agent 模式）

**代码位置**：`apps/ui-tars/src/main/services/runAgent.ts`

---

## 四、三阶段任务执行状态

### 阶段一：知乎（网页）— ✅ 已完成

| 步骤 | 任务 | 状态 |
|------|------|------|
| 1 | 打开浏览器，访问知乎，登录 | ✅ |
| 2 | 进入写文章页面 | ✅ |
| 3 | 写文章（LLM自行生成内容） | ✅ |
| 4 | 配图（多关键词搜索） | ✅ |
| 5 | 发表文章 | ✅ |
| 6 | 搜索到文章 | ✅ |
| 7 | 评论文章 | ✅ |
| 8 | 点赞、收藏、喜欢 | ✅（系统限制跳过） |

### 阶段二：Word（客户端）— ✅ 已完成

| 步骤 | 任务 | 状态 |
|------|------|------|
| 1 | Win+R → winword 打开Word | ✅ |
| 2 | 新建空白文档 | ✅ |
| 3 | 写文章（至少三章节） | ✅ |
| 4 | 字体格式设置（宋体五号、标题四号加粗） | ✅ 多次迭代优化 |
| 5 | 保存为 docx | ✅ |
| 6 | 导出为 PDF | ✅ |

### 阶段三：微信（客户端）— ⏳ 待开始

| 步骤 | 任务 | 状态 |
|------|------|------|
| 1 | 打开微信客户端 | ⏳ |
| 2 | 搜索"火眼审阅" | ⏳ |
| 3 | 选择服务号结果 | ⏳ |
| 4 | 关注服务号 | ⏳ |
| 5 | 发送文字私信 | ⏳ |

---

## 五、关键技术决策与演进

### 5.1 架构演进历程

| 版本 | 方案 | 问题 | 当前方案 |
|------|------|------|---------|
| v1 | 纯回放引擎 | 不执行真实动作，只显示文字 | ❌ 弃用 |
| v2 | 回放走 operator.execute | 坐标不匹配时卡死 | ❌ 弃用 |
| v3 | 坐标辅助模式（混合） | 字体设置位置不准 | ✅ 当前 |
| v4 | 样式关键词跳过缓存 | Word第4步不固定 | ✅ 当前 |
| v5 | 缓存失败自动回退VLM | 避免卡死在错误坐标 | ✅ 当前 |

### 5.2 关键技术决策

1. **坐标辅助而非全量回放**：保留 VLM 运行，仅替换 click 坐标为缓存值，兼顾速度与灵活性
2. **Word任务特殊处理**：Word 文档内容长度可变，字体设置位置不固定，故通过关键词检测跳过缓存
3. **Python 扩展动作**：新增 `word_document` 动作，VLM 出内容，Python + win32com 自动完成全部 Office 操作
4. **文件存储而非 IndexedDB**：Electron 主进程不可用 IndexedDB，改用 Node.js fs + JSON 文件

### 5.3 遇到的困难与解决

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `idb-keyval` 报错 | 主进程无 IndexedDB | 改用 fs + JSON 文件存储 |
| 手册不生成 | `success=false` 跳过 | 改为只要有操作记录就生成 |
| 回放无动作 | 独立 ReplayEngine | 改为走 `operator.execute()` 同一管道 |
| 样式设置不准 | Word 功能区位置不固定 | 关键词跳过缓存 + 右键代替功能区 |

---

## 六、代码统计

| 模块 | 文件数 | 核心代码行 |
|------|-------|-----------|
| 类型定义 (`types.ts`) | 1 | ~120行 |
| 存储引擎 (`store.ts`) | 1 | ~200行 |
| 回放引擎 (`replay-engine.ts`) | 1 | ~230行 |
| 三层管理器 (`manager.ts`) | 1 | ~280行 |
| 任务定义 (`tasks/index.ts`) | 1 | ~100行 |
| 前端操作手册UI (`OperationManual/index.tsx`) | 1 | ~350行 |
| 集成修改 (`runAgent.ts` / `agent.ts` / `operator.ts`) | 3 | ~150行 |
| IPC路由 (`agent.ts`) | 1 | ~30行 |
| **总计** | **10** | **~1460行** |

---

## 七、下周计划

1. **阶段三（微信客户端）**：实现微信全套操作流程
   - 打开微信客户端 → 搜索"火眼审阅" → 选择服务号 → 关注 → 发送私信
2. **进化层完善**：
   - 完善检测点模式（Checkpoint Mode）
   - 实现手册版本合并与去重
   - 异常检测自动修复机制
3. **性能优化**：
   - 回放速度调优（减少不必要的等待）
   - 手册匹配准确率提升

---

*编制：AI 桌面操控 Agent 项目组*  
*日期：2026年7月17日*
