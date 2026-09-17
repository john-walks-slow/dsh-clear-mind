/**
 * Self-collapse: after a successful clear_mind (or after a mind_map survey has
 * been consumed by subsequent steps), the assistant message carrying the call
 * and its tool results stay on the surface as dead weight. At the next step
 * boundary the pair is replaced with a one-line visible tombstone — a plugin-authored
 * user-role notice, the same replacement shape the compaction engine itself
 * uses — so the multi-kilobyte survey / call+result echo disappears while
 * keeping the conversation clean and paired. Pairing stays balanced and the
 * change is observable, never silent.
 *
 * Detection is stateless: every agent/pre-step scans the surface for
 * assistant/message events whose tool-calls are ALL clear_mind (or ALL mind_map)
 * and whose matching tool/result events follow contiguously, all successful.
 * A multi-segment batch (several clear_mind calls in one message) collapses into
 * ONE tombstone whose stats aggregate every result's commit report.
 * For mind_map, collapse is deferred until subsequent events appear on the surface
 * so the model can read the survey in the immediately following step.
 * Mixed batches (clear_mind/mind_map alongside other tools) are skipped: the sibling
 * results may never have been seen yet, and the mind_map playbook teaches solo calls.
 */

import { Session, SessionSeq, deriveEventMessage } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, Message } from "@deepseek-ai/dsh-llm";
import type { MeterPort } from "./scan.js";

/** One clear_mind or mind_map call+results run scheduled to collapse. */
export interface CollapsePlan {
	/** Which tool was called. */
	readonly toolName: "clear_mind" | "mind_map";
	/** Surface seq of the assistant/message carrying the clear_mind/mind_map calls. */
	readonly assistantSeq: number;
	/** Surface seqs of the matching tool/result events, in surface order. */
	readonly resultSeqs: readonly number[];
	/** Commit stats aggregated across the batch's tool/results (when present). */
	readonly stats?: { readonly clearedNodes: number; readonly clearedTokens: number; readonly checkpointSeqs: readonly number[] };
	/** Fixed-heuristic price of the shadowed nodes (shadow-price protocol). */
	readonly shadowedTokenCount: number;
}

const CLEAR_MIND_TOOL = "clear_mind";
const MIND_MAP_TOOL = "mind_map";
const CLEAR_MIND_PLUGIN = "dsh-clear-mind";

interface ToolCallShape { type: string; id: string; name: string }

function isToolCallBlock(block: ContentBlock): block is ToolCallShape & ContentBlock {
	return (block as { type?: string }).type === "tool-call";
}

function toolCallsOf(message: Message): ToolCallShape[] {
	return message.content.filter(isToolCallBlock);
}

function toolResultBlock(message: Message): { toolCallId?: string; isError?: boolean } | undefined {
	const first = message.content[0] as { type?: string; toolCallId?: string; isError?: boolean } | undefined;
	if (first === undefined || first.type !== "tool-result") return undefined;
	return first;
}

/** Read the clear_mind commit stats one tool/result persisted in its meta. */
function statsOfMeta(meta: unknown): { clearedNodes: number; clearedTokens: number; checkpointSeq: number } | undefined {
	if (typeof meta !== "object" || meta === null) return undefined;
	const record = meta as Record<string, unknown>;
	const clearedNodes = record.clearedNodes;
	const clearedTokens = record.clearedTokens;
	const checkpointSeq = record.checkpointSeq;
	if (typeof clearedNodes !== "number" || typeof clearedTokens !== "number" || typeof checkpointSeq !== "number") return undefined;
	return { clearedNodes, clearedTokens, checkpointSeq };
}

/** Aggregate per-result commit stats into one batch-level report. */
function aggregateStats(stats: readonly { clearedNodes: number; clearedTokens: number; checkpointSeq: number }[]): { clearedNodes: number; clearedTokens: number; checkpointSeqs: number[] } | undefined {
	if (stats.length === 0) return undefined;
	return {
		clearedNodes: stats.reduce((sum, stat) => sum + stat.clearedNodes, 0),
		clearedTokens: stats.reduce((sum, stat) => sum + stat.clearedTokens, 0),
		checkpointSeqs: stats.map((stat) => stat.checkpointSeq)
	};
}

/**
 * Scan the surface for collapsible clear_mind or consumed mind_map runs.
 * @param session - live session.
 * @param meter - token meter port for shadow pricing.
 * @returns collapse plans; empty when nothing qualifies.
 */
export function planCollapses(session: Session, meter: MeterPort): CollapsePlan[] {
	const surface = session.surface.nodes as readonly number[];
	const plans: CollapsePlan[] = [];
	for (let index = 0; index < surface.length; index++) {
		const seq = surface[index];
		const event = session.eventAt(SessionSeq(seq));
		if (event === undefined || event.type !== "assistant/message") continue;
		const data = event.data as { turn: number; step: number; message: Message; meta?: unknown };
		const calls = toolCallsOf(data.message);
		if (calls.length === 0) continue;
		let toolName: "clear_mind" | "mind_map" | undefined;
		if (calls.every((call) => call.name === CLEAR_MIND_TOOL)) {
			toolName = "clear_mind";
		} else if (calls.every((call) => call.name === MIND_MAP_TOOL)) {
			toolName = "mind_map";
		} else {
			continue;
		}
		const pending = new Set(calls.map((call) => call.id));
		const statList: { clearedNodes: number; clearedTokens: number; checkpointSeq: number }[] = [];
		const resultSeqs: number[] = [];
		let cursor = index + 1;
		while (cursor < surface.length) {
			const resultSeq = surface[cursor];
			const resultEvent = session.eventAt(SessionSeq(resultSeq));
			if (resultEvent === undefined || resultEvent.type !== "tool/result") break;
			const resultData = resultEvent.data as { message: Message; error?: unknown; meta?: unknown };
			const block = toolResultBlock(resultData.message);
			if (block === undefined || block.toolCallId === undefined || !pending.has(block.toolCallId)) break;
			if (resultData.error !== undefined || block.isError === true) break;
			pending.delete(block.toolCallId);
			resultSeqs.push(resultSeq);
			const stat = statsOfMeta(resultData.meta);
			if (stat !== undefined) statList.push(stat);
			cursor += 1;
		}
		if (resultSeqs.length !== calls.length) continue;
		// For mind_map: do not collapse if it is at the trailing edge of the surface.
		// The model must be given the chance to inspect the survey in the immediately following step.
		if (toolName === "mind_map" && cursor >= surface.length) continue;

		const shadowed = [seq, ...resultSeqs];
		let shadowedTokenCount = 0;
		for (const shadowedSeq of shadowed) {
			const shadowedEvent = session.eventAt(SessionSeq(shadowedSeq));
			const message = shadowedEvent === undefined ? null : deriveEventMessage(shadowedEvent);
			if (message !== null) shadowedTokenCount += meter.estimateMessage(message);
		}
		const stats = aggregateStats(statList);
		plans.push({
			toolName,
			assistantSeq: seq,
			resultSeqs,
			...(stats === undefined ? {} : { stats }),
			shadowedTokenCount
		});
		index = cursor - 1;
	}
	return plans;
}

/** Build the tombstone line that replaces a clear_mind run (one call or a multi-segment batch). */
export function tombstoneText(stats: CollapsePlan["stats"]): string {
	if (stats === undefined) {
		return "clear-mind: checkpoint committed; this call and its result were folded away. See the <compacted-summary> checkpoint earlier in the conversation.";
	}
	const single = stats.checkpointSeqs.length === 1;
	const target = single
		? "checkpoint seq " + stats.checkpointSeqs[0]
		: "checkpoints seq " + stats.checkpointSeqs.join(", ");
	const pair = single ? "this call and its result were folded away" : "this call and its results were folded away";
	return "clear-mind: cleared " + stats.clearedNodes + " messages (~" + stats.clearedTokens + " tokens) into " + target + "; " + pair + ". See the <compacted-summary> checkpoint" + (single ? "" : "s") + " earlier in the conversation.";
}

/** Build the tombstone line that replaces a mind_map survey run. */
export function mindMapTombstoneText(): string {
	return "clear-mind: mind_map survey completed; this call and its result were folded away.";
}

/**
 * Apply one collapse: compaction/prune shadow-price event, then the visible
 * tombstone assistant/message replacing the whole run.
 * @param session - live session.
 * @param plan - the run to collapse.
 * @returns the tombstone event's seq.
 */
export function applyCollapse(session: Session, plan: CollapsePlan): number {
	const lastSeq = plan.resultSeqs[plan.resultSeqs.length - 1];
	const shadowed = [plan.assistantSeq, ...plan.resultSeqs];
	const pruneEvent = session.append("compaction/prune", {
		shadowedRange: { start: SessionSeq(plan.assistantSeq), end: SessionSeq(lastSeq) },
		shadowedSeqs: shadowed.map((seq) => SessionSeq(seq)),
		shadowedTokenCount: plan.shadowedTokenCount
	});
	// The replacement is a plugin-authored user-role notice — the same shape
	// the compaction engine uses for checkpoint replacements. It must NOT be an
	// assistant/message: the token meter requires every assistant/message to
	// fall inside a step/start..step/end window, and plugin appends between
	// steps would poison the meter replay for the whole session.
	const text = plan.toolName === "mind_map" ? mindMapTombstoneText() : tombstoneText(plan.stats);
	const summary = plan.toolName === "mind_map"
		? "mind_map self-collapse tombstone (one line)"
		: "clear-mind self-collapse tombstone (one line)";
	const tombstone = session.append("user/message", createUserMessage({
		content: [{ type: "text", text }],
		source: {
			kind: "plugin",
			plugin: CLEAR_MIND_PLUGIN,
			form: "notice",
			summary
		}
	}), {
		surfaceOp: { op: "replace", start: SessionSeq(plan.assistantSeq), end: SessionSeq(lastSeq) },
		sourceEventSeqs: [pruneEvent.seq, ...shadowed.map((seq) => SessionSeq(seq))]
	});
	return tombstone.seq;
}

/** Convenience: plan and apply every pending collapse for one session. */
export function collapseClearMindRuns(session: Session, meter: MeterPort): number[] {
	return planCollapses(session, meter).map((plan) => applyCollapse(session, plan));
}

/** Exposed for tests: the tool names collapse recognizes. */
export function collapseToolNames(): readonly string[] {
	return [CLEAR_MIND_TOOL, MIND_MAP_TOOL];
}

/** Exposed for backwards-compatibility in tests. */
export function collapseToolName(): string {
	return CLEAR_MIND_TOOL;
}
