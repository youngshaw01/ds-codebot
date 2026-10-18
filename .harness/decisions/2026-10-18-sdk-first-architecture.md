# 进程外 SDK 驱动架构

Status: accepted

## Context

ds-codebot 要复用的 agent 能力（模型、工具、沙箱、审批、会话持久化）全部存在于 deepseek-harness。三条候选路线：(a) 外部进程通过 SDK 驱动 `dsh --profile sdk`；(b) 在 deepseek-harness 仓内新建 bundle/profile 做产品化；(c) 前端只对接 `dsh --profile acp` 标准协议。约束：学习期不想承担上游仓库的门禁成本（覆盖率、snapshot、Agent Notes），且需要同一核心未来挂多个前端。

## Decision

采用 (a)：BotCore 只做协议编排与前端渲染，通过 `@deepseek-ai/dsh-sdk-client` spawn 同版本 `dsh --profile sdk` 子进程；前端（TUI/飞书/VSCode）共享 BotCore，互相不知道协议细节。

## Alternatives

- **(b) 仓内 bundle**：放弃。需遵守上游全套约定（100% 单文件覆盖率、snapshot 测试、PR 流程），学习期成本过高；且概念上 ds-codebot 是消费者不是上游组件。
- **(c) ACP 优先**：放弃为主路线。ACP v1 恰好缺少审批应答路径（server→client requests 是 dead capability），且刻意不含 DSH 展示数据；但保留为 M4 之后 TUI/编辑器前端的备选后端，写成一个可选 frontend 后端而非架构基础。

## Consequences

- 收益：不碰上游仓库；前端可插拔；协议薄，测试可回放。
- 代价：放弃 turn 取消能力（协议无 cancel，只能关闭 runtime 进程，见 DESIGN.md §4.4）；审批必须预配置权限，无法在交互中协商；client 与运行时版本必须严格对齐，升级是耦合操作。
- 安全姿态由启动配置决定：权限预设 + 沙箱在 patch 层配好，运行时不再询问。

## Verification

- M1 验收（DESIGN.md §6）：CLI 连续对话 3 轮、Ctrl-C 触发安全 teardown、无 `DEEPSEEK_API_KEY` 时 e2e skip 而非误报失败。
- 协议行为变化时本记录与 DESIGN.md §4.4 同步复核。
