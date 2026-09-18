/**
 * The clear-mind prompt texts.
 *
 * DEFAULT_PLAYBOOK is the built-in wording (the original dense operator
 * register). Every segment can be replaced by the operator through the
 * `playbook` (global) and `presetPlaybook` (per agent preset id) config
 * maps — blank or absent fields keep the built-in text, so a preset can
 * override just one segment (say, drop the ## notes template) without
 * rewriting the rest.
 *
 * Which override applies is resolved once per agent registration from the
 * session's durable `agentPreset` header, so a preset's wording is stable
 * for the session's lifetime while staying configurable for sessions
 * created later.
 */

import type { ClearMindConfig, PlaybookOverride, PlaybookOverrideKey } from "./config.js";

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

export const DEFAULT_PLAYBOOK: PlaybookPrompts = {
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

/** A blank or whitespace-only override never replaces the built-in text. */
function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim() !== "") return value;
	}
	return undefined;
}

function multiline(text: string): string[] {
	return text.split("\n");
}

/**
 * Resolve the prompt set for a session: the preset's override wins field by
 * field, then the global override, then the built-in text. An unknown preset
 * id simply has no override of its own.
 */
export function resolvePlaybook(
	config: Pick<ClearMindConfig, "playbook" | "presetPlaybook">,
	presetId: string | undefined
): PlaybookPrompts {
	const preset: PlaybookOverride = presetId !== undefined ? config.presetPlaybook[presetId] ?? {} : {};
	const global: PlaybookOverride = config.playbook;
	const pick = (key: Exclude<PlaybookOverrideKey, "notesGuide" | "reminder">): string =>
		firstNonEmpty([preset[key], global[key]]) ?? DEFAULT_PLAYBOOK[key];
	const pickLines = (key: "notesGuide" | "reminder"): readonly string[] => {
		const override = firstNonEmpty([preset[key], global[key]]);
		return override !== undefined ? multiline(override) : DEFAULT_PLAYBOOK[key];
	};
	return {
		title: pick("title"),
		rangeGuide: pick("rangeGuide"),
		notesGuide: pickLines("notesGuide"),
		selfCheck: pick("selfCheck"),
		callHint: pick("callHint"),
		signals: pick("signals"),
		reminderHead: pick("reminderHead"),
		reminder: pickLines("reminder")
	};
}
