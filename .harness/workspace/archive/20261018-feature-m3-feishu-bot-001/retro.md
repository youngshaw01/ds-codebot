# M3 复盘 — 飞书 bot

日期：2026-10-18

## 验收标准逐条结论

| 标准（DESIGN.md §6） | 结论 | 证据 |
|---|---|---|
| 群内 @bot 执行编码任务 | **通过（内部全链路）** | `tests/live-feishu.spec.ts`（真实 key + 真实 dsh 运行时 + 假网关）：群内 @bot 两轮对话，回复非空；未 @ 群消息零回复。**真实飞书租户联调未做（无应用凭据）**——见"验证边界" |
| 同群上下文连续 | **通过（强证据）** | live 测试第一轮“记住数字 42”，第二轮答出 42——证明两轮落在同一 session 的真实上下文上；映射复用另有 9 项 bot 单测覆盖 |
| （执行标准）typecheck + 单测 | **通过** | `tsc --noEmit` 0 错误；41/41 通过 |
| （执行标准）入口冒烟 | **通过** | 无 `FEISHU_APP_ID/SECRET` 时 fail-loud（明确指引 + RC=1），不启动运行时 |

## 验证边界（诚实声明）

- **已真实验证**：registry 持久化、bot 全部交互逻辑（@过滤/队列/命令/错误/截断）、真实运行时经 bot 路径的两轮对话与上下文连续性、wire 事件解析（`parseMessageEvent` 单测）、入口 fail-loud。
- **未验证**：与飞书开放平台的真实长连接（无应用凭据）。`LarkGateway` 只做了类型级对接与 `parseMessageEvent` 边界测试；`ws.start()`/`message.create` 的真实调用路径需要一次租户联调——**用户首跑 `npm run feishu` 即该路径的手工冒烟**，README 已列前置步骤。

## What went well

- 三层切分（gateway 接口 / bot 核心 / Lark 实现）让全部内部逻辑用假网关测透，真实租户缺失不阻塞开发。
- "记住 42 再问"的连续性断言比查映射表强得多：直接证明真实 session 上下文。
- `RuntimePool` 多会话化只加默认参数，M1 CLI 与 M2 TUI 零改动且回归全绿。

## What didn't go well

- live 测试首版用"fire-and-forget handler + 断言回复"制造竞态，且曾因测试文件自身缺陷导致挂起被误判为"运行时挂死"——调试绕了远路。教训：**测试必须 await 被测路径，不能经过 void 桥接**。
- 长任务测试在前台会被工具的空闲超时杀掉，后来用 Start-Process + 文件重定向才稳定——这是工具链限制，已固有化到流程。

## What to try differently（M4）

- 涉及真实运行时的测试统一走文件重定向 + 显式超时的跑法。
- M4 先做一次飞书租户联调（用户提供凭据后），再动 VS Code。

## 缺陷清单

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | registry `parseBindings` 用 `as SessionBinding` 裸断言（违反仓库规则且 TS 拒绝） | 已修复：显式构造对象 |
| 2 | live-feishu 测试经 `void this.handle()` 间接层，断言与回复竞态 | 已修复：测试直接 `await bot.handle()` |
| 3 | bot 曾设计 transport 错误时 unbind | 已修复：运行时断开是进程级事件，保留绑定 + 提示重启 bot 进程 |
| 4 | 测试里索引访问未过 `noUncheckedIndexedAccess` | 已修复：解构 + assert.ok 收窄 |

## 已知限制（带入 M4）

- dsh 运行时断开后 bot 不会自愈：需重启 bot 进程（会话历史保留，自动重建运行时列为后续候选）。
- 飞书侧只处理文本消息；图片/文件/富文本未接入。
- 未做 per-chat 并发上限保护（FIFO 队列无 depth 上限）。
