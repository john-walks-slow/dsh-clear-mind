/**
 * The clear-mind prompt texts, in two curated tones.
 *
 * "engineering" is the original dense operator register (seq discipline,
 * verbatim preservation, a ## notes template). "natural" says the same things
 * conversationally — no template headings, no jargon — for presets like
 * roleplay where the engineering register breaks the fiction.
 *
 * Which set a session sees is resolved once per agent registration from the
 * session's durable `agentPreset` header + the style config, so a preset's
 * tone is stable for the session's lifetime while staying configurable from
 * the settings page for sessions created later.
 */

import type { ClearMindConfig, PlaybookStyle } from "./config.js";

/** One complete prompt text set: the playbook the map returns and the nudge text. */
export interface PlaybookPrompts {
	/** Section header shown at the top of the playbook block. */
	readonly title: string;
	/** How to choose the range to clear. */
	readonly rangeGuide: string;
	/** What the checkpoint notes should contain (one entry per rendered line). */
	readonly notesGuide: readonly string[];
	/** The pre-commit anti-loss check. */
	readonly selfCheck: string;
	/** How to issue multiple clears. */
	readonly callHint: string;
	/** The "when to survey" paragraph inside the mind_map tool description. */
	readonly signals: string;
	/** First body line of the proactive reminder. */
	readonly reminderHead: string;
	/** Remaining body lines of the proactive reminder (reasons are data-driven). */
	readonly reminder: readonly string[];
}

const ENGINEERING: PlaybookPrompts = {
	title: "— clear-mind playbook —",
	rangeGuide: "选区间：清「已完成的旧阶段」或「可收敛支线/弯路」；至少保留最近 1-2 个回合原文（进行中的工作需 verbatim）；区间内的旧检查点 ◆ 必须吸收进新 notes。区间清理后，未来的你将只能看到 notes。请确保 notes中记录了该区间内对未来可能有用的全部信息，宁滥勿缺。",
	notesGuide: [
		"notes 参考模板：",
		"  ## 任务与用户意图（关键处引用原话）",
		"  ## 关键事实与决策（文件路径、命令、版本号、id、数据——逐字保留）",
		"  ## 已放弃的路径（什么失败了、为什么、别再试）",
		"  ## 未决事项",
		"  ## 下一步（引用用户最近的指令）"
	],
	selfCheck: "提交前自检（防丢）：每个未完成要求都在？后续要用的路径/标识符/数字都逐字在？用户说过的「不要做 X」类约束都在？有耐久价值的情报先外化到 todo/记忆/文件——检查点只服务本次会话。",
	callHint: "调用：要清多段时，可在同一条消息连发多次 clear_mind，各段互不重叠即可。",
	signals: "该梳理的信号（满足其一）：① 同一问题已试 ≥2 次失败方案即将换方向；② 一段探索/调研结束且结论明确；③ 用户改了方向、旧工作可归档；④ 发现自己在往回翻旧消息重新定位自己；⑤ 子任务完成、切换下一个；⑥ token 压力上升但未到自动压缩阈值——主动清优于被动等（自动压缩只保最近尾巴，你保语义边界）。不宜在上下文还短、工具链中间马上要用刚产生的结果、或区间内还有未外化的关键信息时清。",
	reminderHead: "[Context / Step Alert] 当前会话已达到主动清理检查点：",
	reminder: [
		"- 建议：长上下文或单轮过多 Step 容易累积过时试错过程与冗余工具输出，分散注意力并增加推理成本。",
		"- 行动指引：先调用 mind_map 审视当前上下文表面，然后将已完成阶段/可收敛支线通过 clear_mind 压缩为检查点，剔除噪音留下有用信息。若手头工作尚未完成，先把这一阶段的工作做完再清理即可。"
	]
};

const NATURAL: PlaybookPrompts = {
	title: "— 清理指引 —",
	rangeGuide: "可以把已经告一段落的旧阶段、或者已经走完的弯路从上下文里请出去，最近一两个回合还在进行中的对话保持原样就好。如果这段区间里有过以前的清理笔记（◆ 标记），把里面的要点并进这次的笔记。清理之后，未来的你只能靠这份笔记回忆这段时间——所以宁可多记一点，也别弄丢将来可能用到的信息。",
	notesGuide: [
		"笔记大致讲清楚这几件事：一开始想做成什么（用户的关键原话值得记下来）、现在已经知道了什么（路径、数字、约定这些细节原样保留）、哪些路走不通别再试、还有什么没做完、接下来打算做什么。"
	],
	selfCheck: "收尾前扫一眼：没做完的事都记了吗？后面还要用的路径、数字、约定都在吗？用户交代过的「不要做 X」之类的要求还在吗？有长期价值的东西先存进文件或记忆里，这份笔记只负责这次对话。",
	callHint: "如果想清理的部分分好几段，就在同一条消息里多调几次 clear_mind，各段不重叠即可。",
	signals: "这些时刻值得停下来梳理一下：同一个问题反复尝试没有进展、准备换思路；一段探索或调研告一段落；用户换了新方向、旧的工作可以收尾；你发现自己在往回翻聊天记录找回状态；一个子任务做完要开下一个；或者对话变长、开始显得臃肿——与其等系统自动压缩（它只会留下最近的尾巴），不如趁早自己把有价值的东西记成笔记。对话刚开头、或手头的工具结果还没消化完的时候，先别急着清。",
	reminderHead: "上下文维护提醒：这场对话已经积累了不少——",
	reminder: [
		"- 有空时先调用 mind_map 看看全貌，把告一段落的部分整理成笔记、用 clear_mind 清掉。",
		"- 正在做的事不受影响；如果手头这一步还没做完，先做完再整理也没关系。"
	]
};

/** The curated text set for a style. */
export function playbookFor(style: PlaybookStyle): PlaybookPrompts {
	return style === "natural" ? NATURAL : ENGINEERING;
}

/**
 * Resolve the prompt set for a session: the preset's override wins, then the
 * global default. An unknown preset id falls back to the global default.
 */
export function resolvePlaybook(
	config: Pick<ClearMindConfig, "playbookStyle" | "presetPlaybookStyle">,
	presetId: string | undefined
): PlaybookPrompts {
	const style = (presetId !== undefined ? config.presetPlaybookStyle[presetId] : undefined) ?? config.playbookStyle;
	return playbookFor(style);
}
