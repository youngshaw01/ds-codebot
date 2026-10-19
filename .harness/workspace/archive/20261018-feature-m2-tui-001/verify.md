# Verify: feature-m2-tui-001

> 迁移说明：本文件由 docs-harness-contract-adoption-001 从 retro（原 M2-review.md）提取重建。

## 验收标准核对

- AC-1 tool_call 过程可见 — **通过**。真实 key + 真实 dsh 运行时下 router 收到 tool-call 通知；TUI 渲染 `⚙ name(args)`。
- AC-2 切换目录后续聊连续 — **通过**。live 测试 `setCwd('..')` 后继续 prompt，回复非空。
- AC-3 turn 状态指示 — **通过**。状态栏 `● 运行中 / ○ 空闲`，正文 turn 开始/结束行。
- AC-4（执行标准）typecheck + 单测 — **通过**。21/21（含 2 个 live 用例）。
- AC-5（执行标准）真实运行冒烟 — **部分通过**。非 TTY 路径实测（渲染帧正确 + fail-loud）；TTY 交互路径待用户首跑（README 已载明）。

## 证据

- `npm test` 输出；提交 `b937548`。
- 复盘全文见同目录 [retro.md](retro.md)。
