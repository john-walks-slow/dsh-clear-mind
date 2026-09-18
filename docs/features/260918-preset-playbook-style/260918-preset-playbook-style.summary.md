# 260918 按 agent preset 自定义 clear-mind 提示词 — 实施记录

## rev2（最终形态）：自由文本逐段覆盖

用户否决了预制风格枚举（rev1 的 `playbookStyle: engineering|natural`），要求直接自定义覆盖提示词。rev2 设计：

- **8 个段位全部开放为自由文本**：`title` / `rangeGuide` / `notesGuide`（多行按 `\n` 分行）/ `selfCheck` / `callHint` / `signals`（mind_map 描述信号段）/ `reminderHead` / `reminder`（多行）。
- **配置形态**：`playbook`（全局覆盖）+ `presetPlaybook`（按 agent preset id 覆盖，如 `{ roleplay: {...} }`），逐段合并优先级 **preset > 全局 > 内置**；空白/缺省段保留内置文案，可只改想改的段。
- **内置文案**：`DEFAULT_PLAYBOOK`（原 engineering 文本逐字保留），不是预制风格，只是零配置时的缺省行为；有逐字回归测试。
- **解析时机**：mind_map 工具文案在 agent 注册时按 `agent.session.header.agentPreset`（durable）解析并闭包；reminder 在触发时现场解析。
- 实现要点：`PlaybookOverrideSchema` 声明为 `Schema<PlaybookOverride>`（schemastery 对象缺键保持缺省，类型层面用 cast 对齐 partial 语义）；`resolveConfig.sanitizeOverride` 只保留已知字符串键；`resolvePlaybook` 用 `pick`（单行）与 `pickLines`（多行）避免 union cast。
- 中途有另一 agent 的并行修改（全局-only 变体）混入工作区，已按本设计重写覆盖；其无关 issue 文档（docs/issues/260918-session-create-text-split/）未动。

## rev1（已被 rev2 取代，存档）

曾实现 `playbookStyle`（engineering|natural 枚举）+ `presetPlaybookStyle`（preset id → 风格）双层配置，内置 engineering/natural 两套文案。用户反馈「不希望给几种预制，希望直接自定义覆盖」，rev2 移除枚举与内置 natural 集。

## 验证

- `npm run check` + `npm test` 54/54 ✅（prompts.test.ts：sanitize、三级合并、多行拆分、内置逐字回归、renderSurvey/mind_map/reminder 消费端）
- `npm run build` ✅；`node --check lib/client.js` ✅
- e2e（4188，独立 DSH_HOME）重启加载新构建：进程存活、GUI 正常、无 plugin tree failed to load
- 真实平台数据核验：e2e session log header 携带 `"agentPreset":"standard"`，`session.header.agentPreset` 访问路径有效
- 待用户实机确认：重启线上 4175 后，roleplay/agent preset 会话调 mind_map 应返回自定义文案（本机已预配 agent/roleplay 两 preset 的自然风格覆盖，见 rev2 之后的运维记录）
