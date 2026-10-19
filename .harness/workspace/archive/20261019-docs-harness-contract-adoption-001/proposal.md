# Proposal: docs-harness-contract-adoption-001

## Why

`D:/ai/ai-engineering-standards`（Harness Contract v3.1.0）定义了 Agent 接入项目的可验证最小形状。ds-codebot 现有的 `.harness/`（DESIGN.md / decisions/ / milestones/）先于该契约存在，结构与标准布局不一致，也无法被标准库校验器验证。本变更把项目接入契约，并将存量文档迁移到标准落位。

## What Changes

- 生成标准骨架：`.harness/project.yaml`（schemaVersion 3.0.0）、`.harness/workspace/{changes,archive}/`、`docs/knowledge/README.md`、`docs/rules/README.md`（`adopt` 保守写入，冲突跳过）。
- 重写 `AGENTS.md` 为薄入口（≤120 行，指向 project.yaml / 工作流 / knowledge / rules / charter）。
- 存量迁移：
  - `.harness/DESIGN.md` → `docs/knowledge/architecture.md`
  - `.harness/decisions/*` → `docs/knowledge/decisions/*`（补"变更记录"小节）
  - `.harness/milestones/README.md`（逐刀协议）→ `docs/rules/change-units.md`
  - `.harness/milestones/M{1..6}-review.md` → `.harness/workspace/archive/{日期}-feature-m{1..6}-*-001/retro.md`
- 新增 `docs/rules/charter.md`（项目宪法：从既有 AGENTS.md 规则蒸馏不可协商原则）。
- `node src/validate.mjs --project D:/ai/ds-codebot [--strict]` 零 error 零 warning。

## Out of Scope

- 业务源码与测试不动；M1–M6 的事实内容不改写，只迁移落位。
- 不引入标准库未契约化的目录（governance/knowledge 镜像等红线 1）。

## 验收标准

- AC-1 `validate` 非 strict 与 strict 均 ok（errors=0 且 strict 下 warnings=0）。
- AC-2 存量文档全部在新落位存在且内容无损（DESIGN/decisions/M1–M6 复盘/逐刀协议）。
- AC-3 `AGENTS.md` ≤120 行且为薄指针（不含契约全文、不含 project.yaml 字段表）。
- AC-4 知识文件（`docs/knowledge/**/*.md`）均含"变更记录"小节；`.harness/workspace/changes/` 根无散落文件。
- AC-5 归档 change 目录命名合规（`{YYYYMMDD}-` 前缀 + type 合法）。

## Impact

- Agent 入口从自建规范切换到 Layer 0 契约；后续所有变更走 `workspace/changes/` 变更单元工作流。
- 历史 M1–M6 复盘转为归档 retro，可追溯链条：archive ⇄ knowledge 变更记录 ⇄ VCS。
