# Verify: feature-m3-feishu-bot-001

> 迁移说明：本文件由 docs-harness-contract-adoption-001 从 retro（原 M3-review.md）提取重建。

## 验收标准核对

- AC-1 群内 @bot 执行编码任务 — **通过（内部全链路）**。真实 key + 真实运行时 + 假网关：两轮对话回复非空；未 @ 群消息零回复。真实飞书租户联调未做（无应用凭据）。
- AC-2 同群上下文连续 — **通过（强证据）**。第一轮"记住数字 42"，第二轮答出 42，证明同一 session 真实上下文。
- AC-3（执行标准）typecheck + 单测 — **通过**。41/41。
- AC-4（执行标准）入口冒烟 — **通过**。无 `FEISHU_APP_ID/SECRET` 时 fail-loud（明确指引 + RC=1）。

## 证据

- `npm test` 输出（含 key）；提交 `df2b5bb`。
- 复盘全文见同目录 [retro.md](retro.md)。
