# Verify: feature-m1-driver-001

> 迁移说明：本文件由 docs-harness-contract-adoption-001 从 retro（原 M1-review.md）提取重建；证据以 retro 与 VCS 历史为准。

## 验收标准核对

- AC-1 CLI 连续对话 3 轮 — **通过**。key 补齐后实测：管道输入 3 轮同一 session 回复 OK1/OK2/OK3，EOF 优雅退出 exit 0。
- AC-2 Ctrl-C 安全 teardown — **通过**。冒烟实测 EOF/SIGINT 走同一 shutdown 路径，`closing` 标志幂等，exit 0。
- AC-3 e2e 无 `DEEPSEEK_API_KEY` 时 skip 不算失败 — **通过**。无 key `npm test` 13 项全过、e2e `# SKIP`。
- AC-4（执行标准）typecheck + 单测 — **通过**。`tsc --noEmit` 0 错误；13/13。
- AC-5（执行标准）真实进程冒烟 — **通过（超出预期）**。dsh 子进程真实 spawn、initialize 握手成功、建会话、优雅退出。

## 证据

- `npm test` 输出（含 key：e2e 14/14）；`git log` 提交 `a418599`、`69ebdf0`（EOF 竞态修复）。
- 复盘全文见同目录 [retro.md](retro.md)。
