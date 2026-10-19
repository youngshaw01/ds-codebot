# Verify: feature-m5-incremental-snapshot-001

> 迁移说明：本文件由 docs-harness-contract-adoption-001 从 retro（原 M5-review.md）提取重建。

## 验收标准核对

- AC-1 无变化的轮次零新增读取 — **通过**。单测：二次 capture 后 `readCount` 不变；多轮场景再 capture 无新增读取。
- AC-2 stat 伪装不变时复用基线 — **通过**。等长改写 + mtime 整秒还原 → 不触发读取、内容保持基线旧值。
- AC-3 变更/新增/删除检测 — **通过**。单测覆盖三种 kind 与 diff 列表正确性。
- AC-4 ignoreDirs/maxFileBytes 语义不回退 — **通过**。node_modules 跳过、超大文件进 skipped 且不读内容。
- AC-5 与 M4 行为兼容 — **通过**。live-vscode 带 key：agent 建 `proof.txt` → turn-diff 正确上报。

## 证据

- 单测 7/7；提交 `ce5a55a`。
- 复盘全文见同目录 [retro.md](retro.md)。
