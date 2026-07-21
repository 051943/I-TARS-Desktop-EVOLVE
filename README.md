# I-TARS-Desktop-EVOLVE

**认知-记忆混合架构 · 进化式桌面自动化系统**

基于 UI-TARS Desktop 构建的三层架构（认知层 + 记忆层 + 进化层），让通用 Agent 在执行任务的同时将操作序列沉淀为可复用的操作手册，后续执行相同任务时优先调用手册实现零成本回放。

## 快速开始

```bash
git clone https://github.com/051943/I-TARS-Desktop-EVOLVE.git
cd I-TARS-Desktop-EVOLVE
pnpm install
cd apps/ui-tars
pnpm run dev
```

## 三层架构

| 层次 | 职责 | 技术 |
|------|------|------|
| 🧠 **认知层** | 视觉感知、动作规划 | UI-TARS 多模态 Agent |
| 💾 **记忆层** | 操作知识存储、快速检索、精确回放 | 结构化 Playbook + 语义索引 |
| ⚡ **进化层** | 手册优化、异常处理、坐标辅助 | 闭环学习 + 失败自动回退 VLM |

## 三阶段任务

| 阶段 | 任务 | 状态 |
|------|------|------|
| 一 | 知乎（网页）登录 → 写文章 → 配图 → 发布 → 评论 → 点赞收藏 | ✅ |
| 二 | Word（客户端）打开 → 写文章 → 样式设置 → 保存 → 导出 PDF | ✅ |
| 三 | 微信（客户端）打开 → 搜索服务号 → 关注 → 发送私信 | ⏳ |

## 项目结构

```
apps/ui-tars/src/main/agent/
  ├── operation-manual/       # 三层架构核心
  │   ├── types.ts            # 类型定义
  │   ├── store.ts            # 记忆层 - JSON文件存储
  │   ├── replay-engine.ts    # 进化层 - 回放引擎
  │   ├── manager.ts          # 三层管理器
  │   └── tasks/              # 三阶段任务定义
  ├── operator.ts             # 扩展动作 (run_python / word_document)
  └── prompts.ts              # 系统提示词
```

## License

本项目基于 [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop) 进行二次开发。
