# Verify: feature-m4-vscode-extension-001

> 迁移说明：本文件由 docs-harness-contract-adoption-001 从 retro（原 M4-review.md）提取重建。

## 验收标准核对

- AC-1 工作区会话绑定 — **通过（内部全链路）**。真实 key + 真实运行时 + 假 vscode API：`open()` 后 registry 建立 folder.uri → session 绑定并推送 meta。
- AC-2 diff 展示 — **通过**。live 测试 agent 创建 `proof.txt` → `turn-diff` 上报 added + unified patch；单测覆盖 modified/added/deleted。
- AC-3（执行标准）typecheck + 单测 — **通过**。非 live 51/51；live 全过。
- AC-4（执行标准）真实宿主冒烟 — **未做**。本机未安装 VS Code；README 已载明首跑步骤，待用户在装有 VS Code 的机器执行。

## 证据

- `npm test` 输出；esbuild 打包实测（288ms）；提交 `d709f89`。
- 复盘全文见同目录 [retro.md](retro.md)。
