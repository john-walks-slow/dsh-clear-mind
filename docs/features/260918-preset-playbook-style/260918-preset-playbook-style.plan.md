# 260918 按 agent preset 区分 clear-mind 提示词风格

## 需求

用户希望 agent / roleplay 等 preset 下，clear-mind 返回的提示词不那么技术化、不要工程化的 `##` 模板样例。

## 现状与结论

- playbook / mind_map 描述 / reminder 文案硬编码于 render.ts / tools.ts / reminder.ts，config 仅阈值参数，无按 preset 区分能力。
- 可行方案：session header 自带 durable `agentPreset`（`agent.session.header.agentPreset`），插件按 agent 注册工具时即可解析 preset。
- 选型：在插件 config（settings namespace `clear-mind`）中加 `playbookStyle`（全局默认）+ `presetPlaybookStyle`（按 preset id 覆盖），内置 engineering（现文本，逐字保留）与 natural（口语化、无模板）两套文案。不走 preset yml 组装行（需 sidecar 插件 + realm 隔离，成本高收益低）。

## 设计

- `src/config.ts`：新增 `PlaybookStyle = "engineering" | "natural"`；`playbookStyle` 默认 engineering；`presetPlaybookStyle` 为 dict，resolveConfig 校验值合法。
- `src/prompts.ts`（新）：`PlaybookPrompts`（title/rangeGuide/notesGuide/selfCheck/callHint/signals/reminderHead/reminder）+ ENGINEERING/NATURAL 两套常量 + `resolvePlaybook(config, presetId)`。
- `src/render.ts`：`renderSurvey(survey, prompts)`，playbook 段由 prompts 驱动；默认 engineering 与现文本逐字一致。
- `src/tools.ts`：`mindMapTool(meter, prompts)`，描述中的信号段取 prompts.signals。
- `src/reminder.ts`：`renderReminderText(trigger, prompts)`，提醒正文按风格取词。
- `src/index.ts`：registerOne 按 `agent.session.header.agentPreset` 解析 prompts 并闭包进工具；pre-step reminder 同样按 preset 解析。
- 语义：prompt 风格在 agent 注册时固化（preset 对 session 是 durable 的，中途不变）；改配置影响之后创建的 session。

## 验证

- `npm run check` + `npm test`（新增 test/prompts.test.ts：resolvePlaybook 分支、resolveConfig 校验、两种风格 render/reminder 文本断言、engineering 回归）。
- `npm run build` 后在 e2e 实例（4188）加载验证，不动线上 4175。
