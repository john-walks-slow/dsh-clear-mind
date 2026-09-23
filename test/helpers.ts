/**
 * Test helpers: build real dsh sessions with realistic transcripts, plus a
 * heuristic meter replica whose estimator is used consistently for both the
 * measurement port and the assertions (the runtime always binds the platform's
 * ctx.tokenMeter; the replica only needs internal consistency for unit tests).
 */

import { Session, SessionSeq, deriveEventMessage } from "@deepseek-ai/dsh-session";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { AssistantMessage, ContentBlock, Message, ToolResultMessage } from "@deepseek-ai/dsh-llm";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import type { TokenMeasurement } from "@deepseek-ai/dsh-token-meter";
import type { MeterPort } from "../src/scan.js";

const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
const ROLE_OVERHEAD = 4;

/** Heuristic estimator replica (internally consistent; not the platform's). */
export function estimateBlocks(blocks: readonly ContentBlock[]): number {
	return blocks.reduce((sum, block) => {
		if (block.type === "text") return sum + Math.ceil(block.text.length / CHARS_PER_TOKEN);
		return sum + BLOCK_OVERHEAD;
	}, 0);
}

export function estimateMessage(message: Message): number {
	return ROLE_OVERHEAD + estimateBlocks(message.content);
}

/** Build a meter port over the replica estimator. */
export function replicaMeter(): MeterPort {
	return {
		estimateMessage,
		measure: (session: Session): TokenMeasurement => {
			const nodes = (session.surface.nodes as readonly number[]).map((seq) => {
				const event = session.eventAt(SessionSeq(seq));
				const message = event === undefined ? null : deriveEventMessage(event);
				const heuristicTokens = message === null ? 0 : estimateMessage(message);
				return { seq, tokens: heuristicTokens, heuristicTokens };
			});
			const surfaceTokens = nodes.reduce((sum, node) => sum + node.tokens, 0);
			return {
				logRevision: session.seq,
				baseline: { kind: "heuristic" },
				surfaceDeltaTokens: 0,
				totalTokens: surfaceTokens,
				surfaceTokens,
				nodes
			} as unknown as TokenMeasurement;
		}
	};
}

let callCounter = 0;
export function nextCallId(): string {
	callCounter += 1;
	return "call-" + callCounter;
}

export interface TranscriptStep {
	user?: string;
	calls?: { name: string; result: string; isError?: boolean; meta?: unknown; args?: string }[];
	text?: string;
}

/**
 * Append one scripted turn onto the session. Each turn is:
 * turn/start -> optional user message -> steps of (assistant tool-calls +
 * results) or (assistant text) -> turn/end.
 */
export function appendTurn(session: Session, turn: number, script: readonly TranscriptStep[]): void {
	session.append("turn/start", { turn });
	for (const step of script) {
		if (step.user !== undefined) {
			const message = createUserMessage({ content: [{ type: "text", text: step.user }], source: { kind: "user" } });
			session.append("user/message", message, { surfaceOp: "append" });
		}
		if (step.calls !== undefined && step.calls.length > 0) {
			const blocks: ContentBlock[] = step.calls.map((call) => ({
				type: "tool-call", id: ToolCallId(nextCallId()), name: call.name, arguments: call.args ?? "{}"
			}));
			const assistant = createAssistantMessage({ content: blocks, source: { provider: "test-provider", model: "test-model" } });
			session.append("assistant/message", { turn, step: 1, message: assistant, stream: [] }, { surfaceOp: "append" });
			for (let index = 0; index < step.calls.length; index++) {
				const call = step.calls[index];
				appendToolResult(session, turn, 1, assistant, index, call.result, { isError: call.isError, meta: call.meta });
			}
		}
		if (step.text !== undefined) {
			const assistant = createAssistantMessage({ content: [{ type: "text", text: step.text }], source: { provider: "test-provider", model: "test-model" } });
			session.append("assistant/message", { turn, step: 1, message: assistant, stream: [] }, { surfaceOp: "append" });
		}
	}
	session.append("turn/end", { turn, reason: { kind: "completed" } });
}

/** Append a bare assistant message carrying tool-calls but NO results yet (an in-flight step). */
export function appendOpenAssistant(session: Session, turn: number, calls: readonly { name: string }[]): AssistantMessage {
	const blocks: ContentBlock[] = calls.map((call) => ({ type: "tool-call", id: ToolCallId(nextCallId()), name: call.name, arguments: "{}" }));
	const assistant = createAssistantMessage({ content: blocks, source: { provider: "test-provider", model: "test-model" } });
	session.append("assistant/message", { turn, step: 2, message: assistant, stream: [] }, { surfaceOp: "append" });
	return assistant;
}

/** Append a tool/result answering one call of an existing assistant message. */
export function appendToolResult(session: Session, turn: number, step: number, assistant: AssistantMessage, index: number, result: string, options?: { isError?: boolean; meta?: unknown; sourceSeq?: number }): void {
	const message = createToolResultMessage({
		callId: (assistant.content[index] as { id: ReturnType<typeof ToolCallId> }).id,
		content: [{ type: "text", text: result }],
		isError: options?.isError === true
	});
	const data: { turn: number; step: number; message: ToolResultMessage; meta?: JsonValue } = { turn, step, message };
	if (options?.meta !== undefined) data.meta = options.meta as JsonValue;
	const sourceSeq = options?.sourceSeq !== undefined ? options.sourceSeq : lastAssistantSeq(session);
	session.append("tool/result", data, { surfaceOp: "append", sourceEventSeqs: [SessionSeq(sourceSeq)] });
}

/** Find the seq of the most recent assistant/message event (the in-flight step's producer). */
function lastAssistantSeq(session: Session): number {
	for (let seq = session.seq - 1; seq >= 0; seq--) {
		const event = session.eventAt(SessionSeq(seq));
		if (event !== undefined && event.type === "assistant/message") return seq;
	}
	throw new Error("assistant message not found in session log");
}

/** Collect all events of a session in order. */
export function eventsOf(session: Session): SessionEvent[] {
	const events: SessionEvent[] = [];
	for (let seq = 0; seq < session.seq; seq++) {
		const event = session.eventAt(SessionSeq(seq));
		if (event !== undefined) events.push(event);
	}
	return events;
}

/**
 * Assert the shadow-price protocol over the whole log (the invariant
 * foldSurfaceProjection enforces): every surface replace is immediately
 * preceded by its matching compaction/prune or compaction/summary event with
 * the exact range, and the armed claim's token count equals the summed
 * heuristic price of the shadowed nodes.
 */
export function assertShadowPriceProtocol(session: Session, estimate: (message: Message) => number): { replaces: number; armedTotal: number } {
	const events = eventsOf(session);
	let replaces = 0;
	let armedTotal = 0;
	for (let index = 0; index < events.length; index++) {
		const event = events[index];
		const op = (event as { surfaceOp?: { op?: string; startSeq?: number; endSeq?: number; start?: number; end?: number } }).surfaceOp;
		if (op === undefined || op.op !== "replace") continue;
		replaces += 1;
		const previous = events[index - 1];
		if (previous === undefined || (previous.type !== "compaction/prune" && previous.type !== "compaction/summary")) {
			throw new Error("replace at seq " + event.seq + " is not preceded by a shadow-price event");
		}
		const shadowedRange = (previous.data as { shadowedRange: { start: number; end: number } }).shadowedRange;
		const opStart = op.startSeq ?? op.start;
		const opEnd = op.endSeq ?? op.end;
		if (shadowedRange.start !== opStart || shadowedRange.end !== opEnd) {
			throw new Error("replace at seq " + event.seq + " range " + opStart + "-" + opEnd + " does not match armed claim " + shadowedRange.start + "-" + shadowedRange.end);
		}
		const shadowedSeqs = (previous.data as { shadowedSeqs: number[] }).shadowedSeqs;
		let expected = 0;
		for (const seq of shadowedSeqs) {
			const shadowedEvent = session.eventAt(SessionSeq(seq));
			if (shadowedEvent === undefined) throw new Error("shadowed seq " + seq + " missing");
			const message = deriveEventMessage(shadowedEvent);
			if (message !== null) expected += estimate(message);
		}
		const armed = (previous.data as { shadowedTokenCount: number }).shadowedTokenCount;
		if (armed !== expected) throw new Error("armed claim " + armed + " != summed heuristic price " + expected + " for replace at seq " + event.seq);
		armedTotal += armed;
	}
	return { replaces, armedTotal };
}

export { SessionSeq };
