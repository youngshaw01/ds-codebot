# rules/ — 项目特化规则索引

描述"必须怎么做"，且为**本项目特有**的内容。

- 通用工程规则**不落项目**：引用 ai-engineering-standards / 全局规则；AI 规则适配层只做薄指针（≤60 行）。
- 禁止复制标准库规则树（红线 1）。

## 文件索引

| 文件 | 摘要 |
| --- | --- |
| [charter.md](charter.md) | 项目宪法：不可协商原则（不碰上游、凭据只走环境变量、协议事实以 SDK 包为准、版本对齐、fail loud、wire 边界校验、测试等待被测路径） |
| [change-units.md](change-units.md) | 变更单元执行规则：逐刀协议、SMARTER 验收、防陷阱；历史 M1–M6 归档轨迹索引 |

## 与契约的关系

本目录是 Layer 0 契约（`ai-engineering-standards/contract/harness-contract.md`）的项目特化执行层；契约修改不在本项目内进行。

## 变更记录

| 日期 | 来源 change-id | 摘要 |
| --- | --- | --- |
| 2026-10-19 | bootstrap | 初始化 rules 索引（adopt 模板） |
| 2026-10-19 | docs-harness-contract-adoption-001 | 写入 charter.md 与 change-units.md，登记真实索引 |
