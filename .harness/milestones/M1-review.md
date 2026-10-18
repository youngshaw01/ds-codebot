# M1 复盘 — driver

日期：2026-10-18

## 验收标准逐条结论

| 标准（DESIGN.md §6） | 结论 | 证据 |
|---|---|---|
| CLI 连续对话 3 轮 | **通过** | key 补齐后实测：管道输入 3 轮，同一 session 连续回复 OK1/OK2/OK3，EOF 优雅退出 exit 0 |
| Ctrl-C 安全 teardown | 通过 | 冒烟实测：EOF 触发 `正在关闭 dsh 运行时…` 并 exit 0；SIGINT 走同一 `shutdown` 路径；`closing` 标志保证幂等 |
| e2e 无 key skip | 通过 | 无 key 时 `npm test` 输出 e2e `# SKIP`，不计失败；有 key 时 14/14 全过 |
| （协议执行标准）typecheck + 单测 | 通过 | `tsc --noEmit` 0 错误；13 项测试全过 |
| （协议执行标准）真实进程冒烟 | 超出预期通过 | dsh 子进程真实 spawn、`initialize` 握手成功、会话建立、优雅退出 exit 0 |

## What went well

- 版本对齐一次成功：`@deepseek-ai/dsh-sdk-client` 与 `@deepseek-ai/dsh` 同锁 `0.2.1-rc.2`；先查出 `0.0.1-rc.1` 存在 404 传递依赖（`dsh-agent-tool-mode` 未发布）再决策，没有盲改。
- 先读安装后的 `.d.ts` 再写代码：`RunResult`/`RunOptions`/错误类/SessionEvent 判别联合全部按真实签名对接，零 API 猜测。
- 无 key 冒烟即完成握手与会话创建：fail-loud 边界清晰（配置/版本错误在启动期，key 问题在请求期）。
- key 补齐后一次跑通 e2e 两轮 + CLI 三轮，session 一致性由运行时保证。

## What didn't go well

- 首版 tsconfig 漏 `allowImportingTsExtensions`，`.ts` 导入约定（AGENTS.md）在配置层就断了，typecheck 才发现。
- `tool/call` 事件名字段猜错一版（`event.name`，实际是 `event.data.name`）——类型系统立刻抓住，但说明"先查类型再写"要更彻底。
- 默认模型填错：`deepseek-v4-flash` 不是 catalog 里 V4.1 Flash 的条目（实际是 `deepseek-flash`）。
- 复盘缺陷 5（EOF 竞态）只有真实运行 CLI 才暴露：单测覆盖的模块没坏，坏在模块间时序。

## What to try differently（下一刀）

- 写代码前先把要消费的事件/通知字段从 `.d.ts` 里完整列出，再动手。
- M2 起，每个 CLI/TUI 交互路径必须有真实运行冒烟，不能只有模块单测。
- 模型/路由等外部事实以上游 catalog 源码为唯一来源，不凭命名推测。

## 缺陷清单

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | Ctrl-C/EOF 触发关闭时，进行中的 turn 抛 `TransportClosed` 会向用户打印误导性错误行 | 已修复：`src/index.ts` turn 处理器在 `closing` 时静默 |
| 2 | `0.0.1-rc.1` 依赖组合在 npm 上不可安装（404 传递依赖） | 已修复：package.json 锁 `0.2.1-rc.2` |
| 3 | README 快速开始仍为占位 | 已修复：写入真实三步用法 |
| 4 | AGENTS.md 测试命令写的是 `pnpm test`，本仓用 npm | 已修复：改为 `npm test` |
| 5 | **管道/非 TTY 输入 3 轮全部丢失**：`rl.on('close')`（stdin EOF）在 prompt 队列排空前触发关闭 | 已修复：`rl.on('close')` 改为先 `await queue` 排空再 `shutdown(0)`；修复后 3 轮实测通过 |
| 6 | 默认模型 `deepseek-v4-flash` 不是 catalog 中的 V4.1 Flash 条目 | 已修复：配置改为 `deepseek-flash`（对照上游 `models.ts`） |

## 已知限制（带入 M2）

- 协议无 wire cancel：Ctrl-C 关闭运行时会放弃进行中的 turn，无部分结果。
- M1 CLI 仅纯文本 stdin 交互，工具调用只做事后计数摘要，无流式展示（M2 范围）。

## 关键教训

- 缺陷 5 只有真实运行 CLI 才会暴露——单测覆盖的模块没坏，坏在模块之间的时序（readline close 与 promise 队列的竞态）。**M2 起，每个 CLI/TUI 交互路径必须有真实运行冒烟，不能只有模块单测。**
