# Verify: feature-m6-snapshot-enhancements-001

> 迁移说明：本文件由 docs-harness-contract-adoption-001 从 retro（原 M6-review.md）提取重建。

## 验收标准核对

- AC-1 M6.1 快照持久化 — **通过**。5 项单测：重启后已有文件零读取仅读新文件、gzip magic 与无 tmp 残留、损坏冷启动、root 不匹配丢弃、skipped 跨重启。
- AC-2 M6.2 内容哈希 — **通过**。3 项单测：touch 触发重读但 diff 为空、真实变化正常更新、跨重启哈希抑制假阳性。
- AC-3 M6.3 文件监听 — **通过**。2 项单测：等大小 + mtime 还原的改写（M5 必漏）被监听捕获；ignoreDirs 无脏标记。
- AC-4 全量与回归 — **通过**。typecheck 0 错误；无 key 全量 69/69；live-vscode 带 key 1/1（M6 全路径真实运行）。

## 证据

- `npm test` 输出；提交 `a205124`。
- 复盘全文见同目录 [retro.md](retro.md)。
