/**
 * Self-collapse: after a successful clear_mind, the assistant message carrying
 * the call (with the full notes duplicated in its arguments) and the tool
 * result stay on the surface as dead weight. At the next step boundary the
 * pair is replaced with a one-line visible tombstone — a plugin-authored
 * user-role notice, the same replacement shape the compaction engine itself
 * uses — so the model sees that the clear happened (and where the checkpoint
 * lives) while the multi-kilobyte call+result echo disappears. Pairing stays
 * balanced and the change is observable, never silent.
 *
 * Detection is stateless: every agent/pre-step scans the surface for
 * assistant/message events whose tool-calls are ALL clear_mind and whose
 * matching tool/result events follow contiguously, all successful. Mixed
 * batches (clear_mind alongside other tools) are skipped: the sibling results
 * may never have been seen yet, and the skill teaches solo clear_mind calls.
 */

import { Session, SessionSeq, deriveEventMessage } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, Message } from "@deepseek-ai/dsh-llm";
import type { MeterPort } from "./scan.js";

/** One clear_mind call+results run scheduled to collapse. */
export interface CollapsePlan {
	/** Surface seq of the assistant/message carrying the clear_mind calls. */
	readonly assistantSeq: number;
	/** Surface seqs of the matching tool/result events, in surface order. */
	readonly resultSeqs: readonly number[];
	/** Commit stats read from the tool/result meta (when present). */
	readonly stats?: { readonly clearedNodes: number; readonly clearedTokens: number; readonly checkpointSeq: number };
	/** Fixed-heuristic price of the shadowed nodes (shadow-price protocol). */
	readonly shadowedTokenCount: number;
}

const CLEAR_MIND_TOOL = "clear_mind";
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

/** Read the clear_mind commit stats a tool/result persisted in its meta. */
function statsOfMeta(meta: unknown): CollapsePlan["stats"] {
	if (typeof meta !== "object" || meta === null) return undefined;
	const record = meta as Record<string, unknown>;
	const clearedNodes = record.clearedNodes;
	const clearedTokens = record.clearedTokens;
	const checkpointSeq = record.checkpointSeq;
	if (typeof clearedNodes !== "number" || typeof clearedTokens !== "number" || typeof checkpointSeq !== "number") return undefined;
	return { clearedNodes, clearedTokens, checkpointSeq };
}

/**
 * Scan the surface for collapsible clear_mind runs.
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
		if (calls.length === 0 || calls.some((call) => call.name !== CLEAR_MIND_TOOL)) continue;
		const pending = new Set(calls.map((call) => call.id));
		let stats: CollapsePlan["stats"];
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
			if (stats === undefined) stats = statsOfMeta(resultData.meta);
			cursor += 1;
		}
		if (resultSeqs.length !== calls.length) continue;
		const shadowed = [seq, ...resultSeqs];
		let shadowedTokenCount = 0;
		for (const shadowedSeq of shadowed) {
			const shadowedEvent = session.eventAt(SessionSeq(shadowedSeq));
			const message = shadowedEvent === undefined ? null : deriveEventMessage(shadowedEvent);
			if (message !== null) shadowedTokenCount += meter.estimateMessage(message);
		}
		plans.push({
			assistantSeq: seq,
			resultSeqs,
			...(stats === undefined ? {} : { stats }),
			shadowedTokenCount
		});
		index = cursor - 1;
	}
	return plans;
}

/** Build the tombstone line that replaces the run. */
export function tombstoneText(stats: CollapsePlan["stats"]): string {
	if (stats === undefined) {
		return "clear-mind: checkpoint committed; this call and its result were folded away. See the <compacted-summary> checkpoint earlier in the conversation.";
	}
	return "clear-mind: cleared " + stats.clearedNodes + " messages (~" + stats.clearedTokens + " tokens) into checkpoint seq " + stats.checkpointSeq + "; this call and its result were folded away. See the <compacted-summary> checkpoint earlier in the conversation.";
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
	const tombstone = session.append("user/message", createUserMessage({
		content: [{ type: "text", text: tombstoneText(plan.stats) }],
		source: {
			kind: "plugin",
			plugin: CLEAR_MIND_PLUGIN,
			form: "notice",
			summary: "clear-mind self-collapse tombstone (one line)"
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

/** Exposed for tests: the tool name collapse recognizes. */
export function collapseToolName(): string {
	return CLEAR_MIND_TOOL;
}
