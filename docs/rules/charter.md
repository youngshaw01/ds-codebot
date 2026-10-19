# charter — ds-codebot 项目宪法

一次定义、跨 change 稳定的**不可协商原则**。与 `docs/rules/` 其他规则冲突时以本文件为准。修改本文件视为契约级决策，须人工确认并在变更记录登记。

## 原则

1. **不碰上游仓库**：不改、不 fork deepseek-harness；自定义运行时行为只能通过 profile + patch 叠加。ds-codebot 是消费者，不是上游组件。
2. **凭据只走环境变量**：任何 secret（`DEEPSEEK_API_KEY`、`FEISHU_APP_ID/SECRET`）禁止写入配置文件、测试快照与 git；`.env*` 已 gitignore。
3. **协议事实以 SDK 包为准**：`@deepseek-ai/dsh-sdk-protocol` / `@deepseek-ai/dsh-sdk-client` 的类型与 README 是 wire 行为的唯一来源；禁止凭记忆实现协议；对接任何第三方 API 前先通读其 `.d.ts`。
4. **版本对齐**：SDK client 与 dsh 运行时必须同版本（`package.json` 成对升级）。
5. **fail loud**：配置/路由/版本错误必须在启动期显式失败；禁止带病进入运行期、禁止静默跳过缺失依赖。
6. **wire 边界必须校验**：webview 入站消息、飞书事件等外部输入先解析校验再分发；禁新增 `as unknown as` 断言。
7. **测试必须等待被测路径**：禁止 `void` 桥接后立即断言；e2e 无 key 时 skip 不算失败；每个交互路径要有真实运行冒烟。
8. **秘密与状态不进 git**：`state/`、`dist-vscode/`、冒烟输出一律 gitignore。

## 技术禁区

- 不在项目内复制标准库契约/规则树（Layer 0 红线 1）。
- 不做审批交互 UI：wire 不支持 server→client 请求，权限在启动配置预置。
- 不为了测试向产品加隐藏入口。

## 变更记录

| 日期 | 来源 change-id | 摘要 |
| --- | --- | --- |
| 2026-10-19 | docs-harness-contract-adoption-001 | 从既有 AGENTS.md 规则蒸馏为项目宪法 |
