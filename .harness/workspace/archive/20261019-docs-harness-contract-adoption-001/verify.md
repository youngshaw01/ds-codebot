# Verify: docs-harness-contract-adoption-001

## 验收标准核对（逐条引用 proposal AC）

- AC-1 `validate` 非 strict 与 strict 均 ok — **通过**。`node D:/ai/ai-engineering-standards/src/validate.mjs --project D:/ai/ds-codebot --strict --report text` → `findings: 0 error(s), 0 warning(s); result: PASS (strict)`；`--garden` → `no gaps`。
- AC-2 存量文档全部在新落位且内容无损 — **通过**。`git mv` 保留历史：DESIGN.md → `docs/knowledge/architecture.md`；decisions/（2 文件）→ `docs/knowledge/decisions/`；milestones/README.md → `docs/rules/change-units.md`；M1–M6 复盘 → `archive/2026{1018,1019}-feature-m{1..6}-*/retro.md`；均为 rename（100% 内容保持）。
- AC-3 `AGENTS.md` ≤120 行且为薄指针 — **通过**。重写后 39 行；指向 project.yaml / workspace / knowledge / rules / charter；不含契约全文、不含 project.yaml 字段表。
- AC-4 知识文件均含"变更记录"、changes/ 根无散落文件 — **通过**。knowledge/architecture.md、knowledge/README.md、knowledge/decisions/{README,2026-10-18-*}.md、rules/README.md、rules/change-units.md、rules/charter.md 均已含；changes/ 根仅有本 change 目录。
- AC-5 归档 change 目录命名合规 — **通过**。`{YYYYMMDD}-` 前缀 + type ∈ {feature, docs}；每个归档目录补齐 retro.md + verify.md（strict 的 `ARCHIVE_MISSING_VERIFY` 归零）。

## 附加验证

- `npm run typecheck` 0 错误（src/tests 注释引用批量更新后）。
- `npm test` 69/69（无 key）。
- README.md 旧路径引用已全部更新；`src/`、`tests/` 中 17 处 `DESIGN.md` 注释引用已改为新路径。

## 证据文件

- validate 输出（上文）；`git status` rename 记录；上述文件系统内容。
