# AGENTS.md — ds-codebot 常驻规则

本文件是本仓库的 standing orders：每条规则一至三行，细节链接到其唯一归属文档。新增规则先判断归属层级，禁止在多处复述同一事实。

## 目录边界

- `.harness/` 只放规范、设计与决策文档，禁止放可执行代码；索引见 [.harness/README.md](.harness/README.md)。
- `src/` 是唯一代码目录；`state/` 是运行时状态，已 gitignore，禁止手写或提交。

## 协议事实的唯一来源

- SDK 协议行为（方法、通知、错误）以 `@deepseek-ai/dsh-sdk-protocol` / `@deepseek-ai/dsh-sdk-client` 包内 README 与类型为准，禁止凭记忆写协议；行为变化时同步更新 [.harness/DESIGN.md](.harness/DESIGN.md) 对应章节。
- deepseek-harness 的行为以其仓库文档为准；本仓库不 fork、不修改其源码，如需自定义运行时行为只能通过 profile + patch 叠加（[DESIGN.md §1](.harness/DESIGN.md)）。

## 版本对齐

- client 与运行时必须同版本：升级时同步升级 package.json 中 `@deepseek-ai/dsh-sdk-*` 与 `@deepseek-ai/dsh`，版本不匹配属于 `SdkProtocolError` 处理范畴（[DESIGN.md §4.5](.harness/DESIGN.md)）。

## 安全

- 任何 secret（API key、飞书 appSecret）只走环境变量或运行时凭据，禁止写入配置文件、测试快照与 git；`.env*` 已 gitignore。

## 决策记录

- 影响结构或协议的长期决策（为什么、放弃了什么、后果）写成决策记录放 `.harness/decisions/`，规则见 [decisions/README.md](.harness/decisions/README.md)；机械性改动豁免。代码变更同 PR 更新受影响的既有记录，不新建重复记录。

## 测试

- 协议层（`runtime.ts`/`router.ts`）必须有测试：e2e 无 `DEEPSEEK_API_KEY` 时 skip；事件路由用录制的 `session.event` JSONL 回放断言（[DESIGN.md §7](.harness/DESIGN.md)）。

## 提交

- commit message 用 `type: 摘要`（type ∈ docs/feat/fix/chore/refactor/test）；一个提交一件事；推送前本地 `pnpm test`（若存在）通过。

## 文档

- 文档只描述当前状态，历史留在 commit 与决策记录里；README 与 `.harness/` 的变更随对应代码变更同 PR 提交。
