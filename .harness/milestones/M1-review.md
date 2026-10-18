# M1 复盘 — driver

日期：2026-10-18

## 验收标准逐条结论

| 标准（DESIGN.md §6） | 结论 | 证据 |
|---|---|---|
| CLI 连续对话 3 轮 | 部分通过 | 串行化 prompt 队列已实现；无 `DEEPSEEK_API_KEY` 无法跑真实模型轮次，由 `tests/e2e.spec.ts` 在有 key 时验证（session 一致性 + 非空回复）。**已知限制：未在真实 key 下人工跑过 3 轮** |
| Ctrl-C 安全 teardown | 通过 | 冒烟实测：EOF 触发 `正在关闭 dsh 运行时…` 并 exit 0；SIGINT 走同一 `shutdown` 路径；`closing` 标志保证幂等 |
| e2e 无 key skip | 通过 | `npm test` 输出 e2e `# SKIP`，不计失败 |
| （协议执行标准）typecheck + 单测 | 通过 | `tsc --noEmit` 0 错误；13 项测试全过 |
| （协议执行标准）真实进程冒烟 | 超出预期通过 | `echo "" \| npx tsx src/index.ts`：dsh 子进程真实 spawn、`initialize` 握手成功、会话建立、优雅退出 exit 0 |

## What went well

- 版本对齐一次成功：`@deepseek-ai/dsh-sdk-client` 与 `@deepseek-ai/dsh` 同锁 `0.2.1-rc.2`；先查出 `0.0.1-rc.1` 存在 404 传递依赖（`dsh-agent-tool-mode` 未发布）再决策，没有盲改。
- 先读安装后的 `.d.ts` 再写代码：`RunResult`/`RunOptions`/错误类/SessionEvent 判别联合全部按真实签名对接，零 API 猜测。
- 冒烟测试跑出了比预期更强的信号：无 key 也能完成握手与会话创建，说明 fail-loud 边界清晰（配置/版本错误在启动期，key 问题在请求期）。

## What didn't go well

- 首版 tsconfig 漏 `allowImportingTsExtensions`，`.ts` 导入约定（AGENTS.md）在配置层就断了，typecheck 才发现。
- `tool/call` 事件名字段猜错一版（`event.name`，实际是 `event.data.name`）——类型系统立刻抓住，但说明"先查类型再写"要更彻底。
- 真实 3 轮对话未验证，M1 验收有一条停在"设计上通过"。

## What to try differently（下一刀）

- 写代码前先把要消费的事件/通知字段从 `.d.ts` 里完整列出，再动手。
- M2 开工前先把 M1 的 known limitation 补验：找一次有 key 的机会跑 `tests/e2e.spec.ts`；仍无 key 则保持 skip 并在 M2 复盘中复查。

## 缺陷清单

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | Ctrl-C/EOF 触发关闭时，进行中的 turn 抛 `TransportClosed` 会向用户打印误导性错误行 | 已修复：`src/index.ts` turn 处理器在 `closing` 时静默；typecheck + 13 项测试回归通过 |
| 2 | `0.0.1-rc.1` 依赖组合在 npm 上不可安装（404 传递依赖） | 已修复：package.json 锁 `0.2.1-rc.2`，`npm install` 成功 |
| 3 | README 快速开始仍为占位（"M1 完成后补充"） | 已修复：写入真实三步用法 |
| 4 | AGENTS.md 测试命令写的是 `pnpm test`，本仓用 npm | 已修复：改为 `npm test` |

## 已知限制（带入 M2）

- 协议无 wire cancel：Ctrl-C 关闭运行时会放弃进行中的 turn，无部分结果。
- 真实模型轮次未在 key 环境下验证（e2e 测试已就位，待 key）。
- M1 CLI 仅纯文本 stdin 交互，工具调用只做事后计数摘要，无流式展示（M2 范围）。
