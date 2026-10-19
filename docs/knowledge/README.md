# knowledge/ — 领域知识索引

描述系统"是什么"：架构、协议边界、决策理由。规则类内容（"必须怎么做"）放 [`../rules/`](../rules/)。

## 文件索引

| 文件 | 摘要 | 状态 |
| --- | --- | --- |
| [architecture.md](architecture.md) | 总体架构：BotCore 编排层、四前端、SDK 协议边界、模块契约、M1–M6 设计决策 | 活跃 |
| [decisions/](decisions/) | 决策记录：为什么这样定、放弃了什么（ADR 风格） | 活跃 |
| [decisions/2026-10-18-sdk-first-architecture.md](decisions/2026-10-18-sdk-first-architecture.md) | 进程外 SDK 驱动架构（放弃仓内 bundle / ACP 主线的理由与代价） | accepted |

## 约定

- 每篇文档尾部维护"变更记录"：`| 日期 | 来源 change-id | 摘要 |`；初始梳理来源记 `bootstrap`。
- 知识回流：change 归档时把已验证认知合并进对应文档并登记一行。

## 变更记录

| 日期 | 来源 change-id | 摘要 |
| --- | --- | --- |
| 2026-10-19 | bootstrap | 初始化 knowledge 索引（adopt 模板） |
| 2026-10-19 | docs-harness-contract-adoption-001 | 迁入 architecture.md 与 decisions/，登记真实索引 |
