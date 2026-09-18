# 260918 按 agent preset 区分 clear-mind 提示词风格 — 实施记录

## 实施（完成）

- `src/config.ts`：`PlaybookStyle` 类型；`playbookStyle`（默认 engineering）、`presetPlaybookStyle`（dict，按 preset id 覆盖）两项配置；resolveConfig 严格校验值。
- `src/prompts.ts`（新）：ENGINEERING（原文本逐字迁移）与 NATURAL（口语化、无 `##` 模板）两套 PlaybookPrompts；`playbookFor(style)` / `resolvePlaybook(config, presetId)`（preset 覆盖 → 全局默认）。
- `src/render.ts`：renderSurvey 增加可选 prompts 参数，playbook 段由文案集驱动；默认 engineering 与旧行为逐字一致。
- `src/tools.ts`：mindMapTool(meter, prompts)，description 信号段取 `prompts.signals`；notes 参数描述 "template" → "guidance"。
- `src/reminder.ts`：renderReminderText/buildReminderMessage 接受 prompts（默认 engineering），提醒正文按风格取词；reasons 行保持数据驱动。
- `src/index.ts`：registerOne 按 `agent.session.header.agentPreset` 解析风格闭包进 mind_map 工具；pre-step reminder 触发时按 preset 现场解析（吃热更新）。
- `test/prompts.test.ts`（新，7 例）：resolveConfig 默认值/严格校验、resolvePlaybook 三级回退、engineering 逐字回归、natural 无模板断言、mind_map description 信号段切换、reminder 文案切换。
- README.md / README.en.md：配置段 + 「提示词风格（按 preset 区分）」说明。

## 语义决策

- preset 对 session 是 durable 的（session header `agentPreset`，实测 e2e session log 带有该字段），故 mind_map 工具的文案在 agent 注册时解析并固化；reminder 在触发时现场解析。配置改动对之后创建的会话生效。
- 未走 preset yml 组装行方案（需 sidecar 插件 + realm 隔离防双注册，成本高）；配置放 settings namespace `clear-mind`，设置页可编辑。
- 地图协议语义行（seq 非单调警告、边界标记说明）不随风格变化——那是模型正确操作工具的必需信息。

## 验证

- `npm run check` ✅；`npm test` 54/54 ✅；`npm run build` ✅；`node --check lib/client.js` ✅。
- e2e（4188，独立 DSH_HOME）重启加载新构建：进程存活、GUI 303、无 plugin tree failed to load。
- 真实平台数据核验：e2e session log header 携带 `"agentPreset":"standard"`，证明 `session.header.agentPreset` 访问路径有效。
- 待用户实机确认：重启线上 4175 后，roleplay/agent preset 会话调 mind_map 应返回「— 清理指引 —」自然风格文案（需先在设置页配置 `presetPlaybookStyle`）。
