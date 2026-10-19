# decisions/ — 决策记录

记录影响本仓库结构或协议的长期决策：**为什么这样定、放弃了什么、后果与验证方式**。代码与 DESIGN.md 承载"是什么"，这里承载"为什么"。

## 何时写

- 新增/改变：架构路线、协议使用方式、目录结构、外部依赖策略、安全姿态。
- 豁免：机械性改动、本地 UI 调整、bug 修复（除非修复本身推翻了一个已记录决策）。

## 格式与命名

- 文件名：`yyyy-mm-dd-短标题.md`，日期为首次提出日。
- 文件头两行固定：

```md
# <标题>

Status: proposed | accepted | superseded by [<新记录>](<相对链接>)
```

- 必选章节：`Context`（背景与约束）、`Decision`（决定了什么）、`Alternatives`（考虑过并放弃的选项及原因）、`Consequences`（后果，含付出的代价）、`Verification`（如何验证决策成立）。
- 被取代时旧记录改 `Status: superseded by ...` 并保留，不删除；记录间用相对链接互链。

## 登记

新记录须在 [`docs/knowledge/README.md`](../README.md) 的索引中登记。

## 变更记录

| 日期 | 来源 change-id | 摘要 |
| --- | --- | --- |
| 2026-10-18 | bootstrap | 决策记录规则建立（.harness/decisions/ 原名） |
| 2026-10-19 | docs-harness-contract-adoption-001 | 迁移至 docs/knowledge/decisions/ |
