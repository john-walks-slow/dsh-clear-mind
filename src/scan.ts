/**
 * mind_map survey: scan a session's model-visible surface into the data the
 * model needs to choose a clear_mind range.
 *
 * The scan is a pure read: log walk (turn attribution + tool-name resolution)
 * plus a surface pass (per-node role, heuristic tokens, one-line preview,
 * tool-pairing-valid boundaries, prior-checkpoint markers). Nothing here
 * mutates the session.
 */

import {
	Session,
	SessionSeq,
	deriveEventMessage,
	isSurfaceEvent
} from "@deepseek-ai/dsh-session";
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { compactCheckpointSource } from "@deepseek-ai/dsh-compaction";
import type { ContentBlock, Message } from "@deepseek-ai/dsh-llm";
import type { TokenMeasurement } from "@deepseek-ai/dsh-token-meter";

/** Narrow meter port so tests can run without the cordis service. */
export interface MeterPort {
	measure(session: Session): TokenMeasurement;
	estimateMessage(message: Message): number;
}

/** Per-node line of the mind surface. */
export interface SurveyNode {
	/** Durable seq of the surface event — the stable id clear_mind takes. */
	readonly seq: number;
	/** Owning turn from the log walk; null before any turn/start. */
	readonly turn: number | null;
	/** user / assistant / tool (tool = tool-result message). */
	readonly kind: "user" | "assistant" | "tool";
	/** Fixed-heuristic token price of the derived message. */
	readonly tokens: number;
	/** One-line preview of the content (bounded). */
	readonly preview: string;
	/** A cut immediately before this seq keeps tool-call/result pairing intact. */
	readonly validStart: boolean;
	/** A cut immediately after this seq keeps tool-call/result pairing intact. */
	readonly validEnd: boolean;
	/** The node is a prior compaction checkpoint. */
	readonly checkpoint: boolean;
	/** Tool-result only: the called tool's name, resolved from the log. */
	readonly toolName?: string;
	/** Tool-result only: the result carried an error. */
	readonly isError?: boolean;
}

/** One turn's surface span summary. */
export interface SurveyTurn {
	readonly turn: number;
	readonly startSeq: number;
	readonly endSeq: number;
	readonly nodes: number;
	readonly tokens: number;
	readonly firstUserPreview?: string;
}

/** The complete survey result (value shape of the mind_map tool). */
export interface Survey {
	readonly kind: "survey";
	readonly surfaceNodes: number;
	readonly surfaceTokens: number;
	/** Route-aware request pressure from the token meter. */
	readonly requestPressureTokens: number;
	/** Last surface seq a clear_mind end may legally use; absent when none. */
	readonly latestEndSeq?: number;
	readonly turns: SurveyTurn[];
	readonly nodes: SurveyNode[];
}

const PREVIEW_MAX = 48;

/** Collapse whitespace and cap to the preview budget. */
function toPreviewLine(text: string): string {
	const collapsed = text.trim().replace(/[\t\n\r]+/g, " ");
	if (collapsed.length === 0) return "";
	return collapsed.length <= PREVIEW_MAX ? collapsed : collapsed.slice(0, PREVIEW_MAX - 1) + "…";
}

/** Extract text from content blocks for preview purposes. */
function textOfBlocks(blocks: readonly ContentBlock[]): string {
	for (const block of blocks) {
		if (block.type === "text") return block.text;
	}
	return "";
}

/** Build the one-line preview for a derived message. */
function previewOfMessage(message: Message, toolNames: ReadonlyMap<string, string>): { preview: string; kind: "user" | "assistant" | "tool"; toolName?: string; isError?: boolean } {
	if (message.role === "user" && message.content.length > 0 && message.content[0].type === "tool-result") {
		const result = message.content[0];
		const preview = toPreviewLine(textOfBlocks(result.content));
		const name = toolNames.get(result.toolCallId);
		const prefix = (name !== undefined ? name : "tool") + (result.isError === true ? " ! " : ": ");
		return { preview: prefix + preview, kind: "tool", toolName: name, isError: result.isError === true };
	}
	if (message.role === "assistant") {
		const calls = message.content.filter((block): block is Extract<ContentBlock, { type: "tool-call" }> => block.type === "tool-call");
		if (calls.length > 0) return { preview: "→ " + calls.map((call) => call.name).join(", "), kind: "assistant" };
		return { preview: toPreviewLine(textOfBlocks(message.content)), kind: "assistant" };
	}
	return { preview: toPreviewLine(textOfBlocks(message.content)), kind: "user" };
}

/** Whether a user message source marks it as a compaction checkpoint. */
function isCheckpointSource(message: Message): boolean {
	const source = message.source as Record<string, unknown>;
	return source.kind === "plugin" && source.plugin === "compact" && typeof source.compactionId === "string";
}

/**
 * Scan one session's surface into a Survey.
 * @param session - live session to survey.
 * @param meter - token meter port (per-node heuristic prices, request pressure).
 * @returns the complete survey data.
 */
export function scanSurface(session: Session, meter: MeterPort): Survey {
	// Log walk: turn attribution per event and callId -> tool-name resolution.
	const turnsBySeq = new Map<number, number | null>();
	const toolNames = new Map<string, string>();
	let currentTurn: number | null = null;
	const total = session.seq;
	for (let seq = 0; seq < total; seq++) {
		const event = session.eventAt(SessionSeq(seq));
		if (event === undefined) continue;
		if (event.type === "turn/start") currentTurn = event.data.turn as number;
		else if (event.type === "turn/end") currentTurn = null;
		if (event.type === "assistant/message") {
			for (const block of (event.data.message as Message).content) {
				if (block.type === "tool-call") toolNames.set(block.id, block.name);
			}
		}
		if (isSurfaceEvent(event)) turnsBySeq.set(event.seq, currentTurn);
	}
	const measurement: TokenMeasurement = meter.measure(session);
	const heuristicBySeq = new Map<number, number>();
	for (const node of measurement.nodes) heuristicBySeq.set(node.seq, node.heuristicTokens);
	const nodes: SurveyNode[] = [];
	const surfaceNodes = session.surface.nodes as readonly number[];
	for (const seq of surfaceNodes) {
		const event = session.eventAt(SessionSeq(seq));
		if (event === undefined || !isSurfaceEvent(event)) continue;
		const message = deriveEventMessage(event);
		const tokens = message === null ? 0 : (heuristicBySeq.get(seq) ?? meter.estimateMessage(message));
		const shape = message === null ? { preview: "(empty)", kind: "assistant" as const } : previewOfMessage(message, toolNames);
		nodes.push({
			seq,
			turn: turnsBySeq.get(seq) ?? null,
			kind: shape.kind,
			tokens,
			preview: shape.preview,
			validStart: safeBalanced(() => toolPairingBalancedBefore(session, SessionSeq(seq))),
			validEnd: safeBalanced(() => toolPairingBalancedAfter(session, SessionSeq(seq))),
			checkpoint: message !== null && message.role === "user" && isCheckpointSource(message),
			...(shape.toolName !== undefined ? { toolName: shape.toolName } : {}),
			...(shape.isError !== undefined ? { isError: shape.isError } : {})
		});
	}
	// Turn summaries fold over the surfaced nodes in order (consecutive runs).
	const turnRuns: { turn: number; startSeq: number; endSeq: number; nodes: number; tokens: number; firstUserPreview?: string }[] = [];
	for (const node of nodes) {
		if (node.turn === null) continue;
		let bucket = turnRuns[turnRuns.length - 1];
		if (bucket === undefined || bucket.turn !== node.turn) {
			bucket = { turn: node.turn, startSeq: node.seq, endSeq: node.seq, nodes: 0, tokens: 0 };
			turnRuns.push(bucket);
		}
		bucket.endSeq = node.seq;
		bucket.nodes += 1;
		bucket.tokens += node.tokens;
		if (bucket.firstUserPreview === undefined && node.kind === "user" && !node.checkpoint) {
			bucket.firstUserPreview = node.preview;
		}
	}
	const turns: SurveyTurn[] = turnRuns.map((run) => ({ ...run }));
	let latestEndSeq: number | undefined;
	for (let index = nodes.length - 1; index >= 0; index--) {
		if (nodes[index].validEnd) {
			latestEndSeq = nodes[index].seq;
			break;
		}
	}
	return {
		kind: "survey",
		surfaceNodes: nodes.length,
		surfaceTokens: nodes.reduce((sum, node) => sum + node.tokens, 0),
		requestPressureTokens: measurement.totalTokens,
		...(latestEndSeq === undefined ? {} : { latestEndSeq }),
		turns,
		nodes
	};
}

/** Contain balance-helper failures (they throw on corrupt surfaces). */
function safeBalanced(check: () => boolean): boolean {
	try {
		return check();
	} catch {
		return false;
	}
}
