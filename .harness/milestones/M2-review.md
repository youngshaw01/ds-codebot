# M2 复盘 — TUI

日期：2026-10-18

## 验收标准逐条结论

| 标准（DESIGN.md §6） | 结论 | 证据 |
|---|---|---|
| tool_call 过程可见 | **通过** | `tests/live-events.spec.ts`（真实 key）：真实运行时的 `tool-call` 通知经 EventRouter 转为 UI 事件；TUI 渲染 `⚙ name(args)` 行 |
| 切换目录后续聊连续 | **通过** | live 测试 `setCwd('..')` 后继续 prompt，回复非空；TUI `/cwd` 走同一路径 |
| turn 状态指示 | **通过** | 状态栏 `● 运行中 / ○ 空闲`（session.status + turn/start/end 驱动），smoke 帧中可见；正文有 `── turn 开始/结束 ──` |
| （执行标准）typecheck + 单测 | **通过** | `tsc --noEmit` 0 错误；21/21 通过（含 2 个 live 用例） |
| （执行标准）真实运行冒烟 | 部分通过 | 非 TTY 路径实测（渲染帧正确 + fail-loud 退出）；**TTY 交互路径本环境无 TTY 无法自动冒烟**，构成合成为验证（router/runtime 均 live 测过，TUI 仅渲染与输入装配未在 TTY 实测） |

## 设计修正（记录备查）

- **SDK 协议只交付已提交的 session 事件，不暴露 live token 流**。因此 M2 的"流式渲染"实际粒度为**提交事件级**：assistant 消息在 step 提交时整条出现，tool_call 在调用提交时出现。这不是缺陷，是协议边界；DESIGN.md §6 的"流式渲染"按此理解。

## What went well

- EventRouter 单测用回放通知覆盖了全部分支（含过滤、校验失败、未知方法）。
- 冒烟测试在第一轮就抓到 ink 的 raw mode 崩溃——如果只跑单测，这个缺陷会活到用户手上。
- ink 帧渲染（标题栏/正文/输入框/帮助）一次通过。

## What didn't go well

- 读了三遍 ink 文档才确认 v5 没有 `isRawModeSupported` 导出；且 `ink-text-input` 内部也会无条件启用 raw mode——第三方副作用必须读源码，不能凭文档印象。
- App 首版把 UiEvent handler 直接传给 notification 订阅（类型不匹配），typecheck 拦下。
- 非 TTY 挂死问题先以"gating"缓解、再以"fail-loud"根治，中间多绕了一步。

## What to try differently（M3）

- 接入第三方 UI 组件前，先在源码里确认其副作用（raw mode、stdin 占用）。
- M3 飞书接入同样先做"真实通道冒烟"再接内部逻辑。

## 缺陷清单

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | App 把 `(UiEvent) => void` 传给期望 `(HarnessNotification) => void` 的订阅 | 已修复：`useMemo` 装配 EventRouter 后转发 dispatch；typecheck + 21 项回归通过 |
| 2 | live 测试订阅前未 `start()` | 已修复：测试显式 `await pool.start()` |
| 3 | 非 TTY 下 ink / ink-text-input 无条件启用 raw mode → 挂载即崩 | 已修复：Composer 非 interactive 不挂 TextInput；App useInput isActive 门控 |
| 4 | 非 TTY 且 stdin 永不关闭时进程永久挂住 | 已修复：`main.tsx` 启动期 TTY 门控，非 TTY fail-loud（打印指引、exit 1、不启动运行时）；已实测立即退出 |
| 5 | raw mode 下 Ctrl-D 不产生 stdin EOF | 已修复：useInput 增补 `ctrl+d → quit` |

## 已知限制（带入 M3）

- TTY 交互路径未在本环境自动冒烟（无 TTY）；用户首次在真实终端跑 `npm run tui` 即为该路径的手工冒烟，README 已写明。
- 正文不滚动（ink 无虚拟滚动），长会话输出会超出屏幕——M3 前加简单截断。
- subagent 通知暂不渲染（EventRouter 显式忽略）。
