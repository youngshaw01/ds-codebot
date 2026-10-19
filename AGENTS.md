# AGENTS.md

> v3 入口。契约：`ai-engineering-standards` → `contract/harness-contract.md`（Layer 0）

## Project

- 机器配置：`.harness/project.yaml`
- 变更工作区：`.harness/workspace/changes/`（进行中）· `.harness/workspace/archive/`（已归档，M1–M6 retro）
- 领域知识：`docs/knowledge/`（架构与协议边界：`architecture.md`）· 项目特化规则：`docs/rules/`（含 `charter.md` 项目宪法与 `change-units.md` 逐刀协议）

## Rules

- 业务事实以代码与测试为准；勿将本文件当作需求文档。
- 工具规则扩展前须先修订 Layer 0 契约，禁止在项目内复制完整标准树。
- 变更产物写入所属 change 的 `artifacts/`，禁止散落 workspace 根。
- 本项目宪法（不可协商原则）见 [`docs/rules/charter.md`](docs/rules/charter.md)：不碰上游仓库、凭据只走环境变量、协议事实以 SDK 包为准、fail loud、wire 边界校验、测试等待被测路径。

## Workflow（变更单元）

1. （方向不明时）先写 `explore.md`：问题 / 选项 / 约束 / 待决问题过一遍，人拍板后再动笔
2. 创建 change：`{type}-{slug}-{NNN}/`，从标准库 `templates/change/` 起草 proposal + tasks；proposal 验收标准用 `AC-<n>` 编号（执行纪律见 `docs/rules/change-units.md`）
3. 最小改动实现，勾选 tasks
4. verify 记录构建/测试证据，人工核查逐条引用 AC 编号；未验证不得声称通过
5. 归档：移入 `archive/` 并加 `{YYYYMMDD}-` 前缀；补 `retro.md` 复盘
6. 有持久认知价值 → 合并进 `docs/knowledge/` 并登记"变更记录"

## 常用命令

- `npm run typecheck` · `npm test`（无 `DEEPSEEK_API_KEY` 时 live 测试自动 skip）
- `npm start`（CLI）· `npm run tui`（TUI）· `npm run feishu`（飞书 bot）· `npm run build:vscode`（VS Code 扩展）
- 校验本项目契约符合性：`node D:/ai/ai-engineering-standards/src/validate.mjs --project .`
