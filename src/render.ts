/**
 * Survey text rendering — the model-facing mind_map content.
 *
 * One line per surface node grouped by turn:
 *   ▸ 12 ◂ user  1.2k "fix the build error…"
 * where ▸ marks a valid range start, ◂ a valid range end, ◆ a prior checkpoint.
 *
 * Seqs are surface-position identities, NOT numeric intervals: after any
 * replacement lands, the map is non-monotonic in seq. The header says so.
 *
 * Volume guard: only the most recent RENDER_NODE_LIMIT nodes get individual
 * lines; older turns collapse to one line each (still carrying the seqs and
 * weights needed to choose boundaries — validity is re-checked at commit).
 */

import type { Survey, SurveyNode } from "./scan.js";

const RENDER_NODE_LIMIT = 140;

function formatTokens(tokens: number): string {
	if (tokens >= 10000) return (tokens / 1000).toFixed(1) + "k";
	if (tokens >= 1000) return (tokens / 1000).toFixed(2) + "k";
	return String(tokens);
}

function nodeLine(node: SurveyNode): string {
	const start = node.validStart ? "▸" : " ";
	const end = node.validEnd ? "◂" : " ";
	const checkpoint = node.checkpoint ? "◆" : " ";
	const preview = node.preview === "" ? "" : " " + JSON.stringify(node.preview);
	return " " + start + " " + String(node.seq).padStart(4) + " " + end + " " + checkpoint + node.kind.padEnd(9) + formatTokens(node.tokens).padStart(6) + preview;
}

/** One-line summary for a turn whose nodes are aggregated away. */
function turnLine(turn: { turn: number; startSeq: number; endSeq: number; nodes: number; tokens: number; firstUserPreview?: string }): string {
	const label = turn.firstUserPreview === undefined ? "" : " — " + turn.firstUserPreview;
	return " ▸ " + String(turn.startSeq).padStart(4) + " ◂        turn     " + formatTokens(turn.tokens).padStart(6) + "  [" + turn.nodes + " nodes]" + label;
}

/** Render the survey as the mind_map tool's model-facing content. */
export function renderSurvey(survey: Survey): string {
	const lines: string[] = [];
	lines.push(
		"Mind surface: " + survey.surfaceNodes + " nodes, ~" + formatTokens(survey.surfaceTokens) +
		" tokens; request pressure ~" + formatTokens(survey.requestPressureTokens) + " tokens."
	);
	lines.push("Seqs are ids in surface order (the list is NOT numeric-sorted after any clear/compaction) — use them as identities, not as an interval.");
	if (survey.latestEndSeq === undefined) {
		lines.push("No clearable boundary before the current step yet — nothing to clear.");
	} else {
		lines.push("Range boundaries are marked ▸ (may start a clear) and ◂ (may end a clear); ◆ marks a prior checkpoint. Latest clearable end: seq " + survey.latestEndSeq + ".");
	}
	const detailedFrom = survey.nodes.length > RENDER_NODE_LIMIT
		? survey.nodes.length - RENDER_NODE_LIMIT
		: 0;
	if (detailedFrom > 0) {
		lines.push("");
		lines.push("(" + detailedFrom + " older nodes aggregated per turn below; boundary seqs remain valid — commit re-checks them.)");
	}
	// Walk turns and nodes in lockstep: aggregated turns print one line,
	// detailed spans print the turn header then per-node lines.
	let turnIndex = 0;
	let previousTurn: number | null = null;
	for (let index = 0; index < survey.nodes.length; index++) {
		const node = survey.nodes[index];
		const isDetailed = index >= detailedFrom;
		if (node.turn !== previousTurn) {
			// A node attributed to no turn (log prefix before any turn/start, or a
			// scan gap) prints no header and, crucially, does NOT advance the
			// turn-run pointer — advancing on null would skip the next real turn's
			// header entirely.
			if (node.turn !== null) {
				// Advance the turn-run pointer to the run starting at this node.
				while (turnIndex < survey.turns.length && survey.turns[turnIndex].turn !== node.turn) turnIndex += 1;
				const run = survey.turns[turnIndex];
				if (run !== undefined) {
					if (!isDetailed) {
						lines.push("");
						lines.push("turn " + run.turn + " · " + turnLine(run));
					} else {
						const label = run.firstUserPreview === undefined ? "" : " — " + run.firstUserPreview;
						lines.push("");
						lines.push("turn " + run.turn + " · seqs " + run.startSeq + "-" + run.endSeq + " · " + run.nodes + " nodes · ~" + formatTokens(run.tokens) + " tok" + label);
					}
				}
			} else if (isDetailed) {
				lines.push("");
				lines.push("(pre-turn nodes)");
			}
			previousTurn = node.turn;
		}
		if (isDetailed) lines.push(nodeLine(node));
	}
	// The clear-mind playbook: how to pick the range and write the notes.
	// Folded here (instead of a separate skill the model must read first) so
	// the guidance appears exactly when the map is consulted and self-erases
	// with it at the next step boundary. Only shown when a clear is actionable.
	if (survey.latestEndSeq !== undefined) {
		lines.push("");
		lines.push("— clear-mind playbook —");
		lines.push("选区间：清「已完成的旧阶段」或「可收敛支线/弯路」；至少保留最近 1-2 个回合原文（进行中的工作需 verbatim）；区间内的旧检查点 ◆ 必须吸收进新 notes。区间清理后，未来的你将只能看到 notes。请确保 notes中记录了该区间内对未来可能有用的全部信息，宁滥勿缺。");
		lines.push("notes 参考模板：");
		lines.push("  ## 任务与用户意图（关键处引用原话）");
		lines.push("  ## 关键事实与决策（文件路径、命令、版本号、id、数据——逐字保留）");
		lines.push("  ## 已放弃的路径（什么失败了、为什么、别再试）");
		lines.push("  ## 未决事项");
		lines.push("  ## 下一步（引用用户最近的指令）");
		lines.push("提交前自检（防丢）：每个未完成要求都在？后续要用的路径/标识符/数字都逐字在？用户说过的「不要做 X」类约束都在？有耐久价值的情报先外化到 todo/记忆/文件——检查点只服务本次会话。");
		lines.push("调用：要清多段时，可在同一条消息连发多次 clear_mind，各段互不重叠即可。");
	}
	return lines.join("\n");
}
