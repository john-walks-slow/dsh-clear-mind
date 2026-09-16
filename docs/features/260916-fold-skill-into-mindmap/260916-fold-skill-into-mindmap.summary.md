# 把 clear-mind 技能折叠进 mind_map — 总结

## 背景

每次清空前，模型都要先读 `clear-mind` 技能、再调 `mind_map`——两轮工具调用。技能内容（何时清、怎么选区间、怎么写 notes）其实只在清空那一刻需要，却以「技能目录条目 + 按需读取」的形式常驻。

用户决定：备分技能 → 删除 → 把最佳实践直接融进 `mind_map` 的 description（何时清）与返回（怎么清），省一轮技能读取。

## 关键事实

- 技能是**运行时注册**的（`src/skill.ts` → `ctx.skills.register({ source: "runtime" })`），**从不落盘** `~/.agents/skills/`——所以「从 .agents/skills 删掉」实际是从插件代码移除注册，无文件系统残留。
- 技能原文逐字备份在 `clear-mind-skill.backup.md`（退役不移除历史）。

## 改动

- **`src/tools.ts`**：
  - `mind_map` description 增加「该梳理的信号」①–⑥（同一问题试 ≥2 次失败、探索结束结论明确、用户改方向、往回翻旧消息、子任务完成、token 压力升未到自动压缩）+「不宜」场景；注明返回内附 playbook。
  - `clear_mind` description 删去「Read the clear-mind skill」、改为指向 `mind_map` 返回的 playbook；`notes` 参数描述同步改为「template + self-check are in the mind_map result」。
- **`src/render.ts`**：`renderSurvey` 在存在可清理终点时，末尾追加「clear-mind playbook」段——选区间（清旧阶段/失败弯路、保留近 1-2 回合 verbatim、◆ 必吸收）、notes 模板（任务意图/关键事实/已放弃路径/未决/下一步）、提交前自检（防丢 + 先外化）、调用规则（单独一条消息只调 clear_mind，混用会无法折叠）、安全声明（毫秒级、人类侧原文可查）、清后重述目标、被压缩指令性文字不进 notes。playbook 随 map 一起在下一步自动折叠。
- **`src/reminder.ts`**：主动提醒文案删除「根据 clear-mind 技能」，改为「mind_map 返回内附 clear-mind 操作指引」。
- **`src/index.ts`**：移除 `ctx.skills.register`、`CLEAR_MIND_SKILL` import、`type {} from "@deepseek-ai/dsh-skill"` 增强、`inject` 中的 `"skills"`；更新头部注释与启动日志。
- **`src/skill.ts`**：删除。
- **`package.json`**：description 同步描述更新（不再提 skill）。
- **`AGENTS.md`**：地图/职责段同步（移除 skill.ts、注明 playbook 落在 tools/render、index 无技能注册）。
- **`test/scan.test.ts`**：renderSurvey 测试钉住 playbook 关键行（`clear-mind playbook` / `已放弃的路径` / `clear_mind 单独一条消息`）。

## 取舍

- per-request 成本：技能目录条目（~80 tok/turn）消失，`mind_map` description 增长约 +120 tok/turn（信号常驻），净 +~40 tok/turn；换来每次清空省一轮技能读取调用。信号常驻是用户明确接受的取舍。
- playbook 只在 `mind_map` 返回出现（且仅当存在可清理终点），随调用自动折叠——既不在每次请求常驻，又恰好在需要时可见，并随 map 一起回收。
- 语言：机械描述保持英文（与既有风格一致），最佳实践保留中文（技能原文语言、用户环境中文优先、模型处理无碍）。
- `@deepseek-ai/dsh-skill` 仍是 package.json 的 devDependency（移除需 `npm install` 触发 link-package 坑；保留为未用 devDep 零运行时风险）。

## 验证

`npm run check` / `npm test`（44/44）/ `npm run build` 通过。实机验证见 `260916-fold-skill-into-mindmap.validation.md`（需重启 dsh：技能目录不再列 clear-mind、mind_map 描述含信号、返回含 playbook、提醒文案不再提技能）。
