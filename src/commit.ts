/**
 * clear_mind commit: validate a chosen surface range and transact it into a
 * model-written checkpoint.
 *
 * The transaction mirrors the platform engine's compaction bracket exactly —
 * compaction/start, compaction/summary (shadow-price armed), replacement
 * user/message via surfaceOp.replace, compaction/end — appended synchronously
 * with no awaits in between, so no concurrent producer can interleave and the
 * lock is never observable. Ranges are surface-POSITION spans (indexOf
 * semantics, like the engine's validateSurfaceRegion): after any prior
 * replacement, surface seqs are non-monotonic, so seq values are identities,
 * never interval arithmetic.
 *
 * Failure discipline mirrors the engine too: once compaction/start lands, any
 * later failure makes exactly one best-effort compaction/end {error} attempt
 * so an unclosed bracket can never poison the turn or the reload seed.
 *
 * Validation failures throw Error with actionable messages: the model sees
 * them as isError tool results and can correct its next call.
 */

import {
	Session,
	SessionSeq
} from "@deepseek-ai/dsh-session";
import { CompactionId, compactCheckpointSource, toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, Message } from "@deepseek-ai/dsh-llm";
import type { TokenMeasurement } from "@deepseek-ai/dsh-token-meter";
import { randomUUID } from "node:crypto";
import type { ClearMindConfig } from "./config.js";
import type { MeterPort } from "./scan.js";

/** Range endpoints as the model expresses them: a surface seq or a sentinel. */
export type RangeEndpoint = number | "first" | "latest";

/** Successful commit report (value shape of the clear_mind tool). */
export interface ClearCommit {
	readonly kind: "cleared";
	readonly clearedNodes: number;
	readonly clearedTokens: number;
	readonly checkpointSeq: number;
	readonly surfaceTokensBefore: number;
	readonly surfaceTokensAfter: number;
	readonly selfCollapse: boolean;
}

export interface CommitDeps {
	readonly session: Session;
	readonly meter: MeterPort;
	readonly config: ClearMindConfig;
	/** Routed provider/model that authored the notes (this very model call). */
	readonly route: { readonly provider: string; readonly model: string };
}

const CHECKPOINT_PREAMBLE =
	"This checkpoint condenses an earlier span of the conversation (clear-mind). " +
	"Treat the notes below as established background and build on them without restating. " +
	"Continue directly from the messages that follow.";

/** Resolve a range endpoint against the current surface. */
function resolveEndpoint(endpoint: RangeEndpoint, side: "start" | "end", surface: readonly number[], latestEndSeq: number | undefined): number {
	if (endpoint === "first") {
		if (surface.length === 0) throw new Error("clear_mind: the surface is empty — nothing to clear.");
		return surface[0];
	}
	if (endpoint === "latest") {
		if (latestEndSeq === undefined) throw new Error("clear_mind: no clearable boundary before the current step — nothing to clear yet.");
		return latestEndSeq;
	}
	if (!Number.isInteger(endpoint) || endpoint < 0) throw new Error("clear_mind: " + side + " must be a surface seq (see mind_map), 'first', or 'latest'.");
	if (!surface.includes(endpoint)) throw new Error("clear_mind: seq " + endpoint + " is not on the current surface. Call mind_map for the current seq map.");
	return endpoint;
}

/** Nearest valid boundary seqs around a rejected position, for actionable errors. */
function nearestBoundaries(nodes: readonly { seq: number; validStart: boolean; validEnd: boolean }[], aroundIndex: number): string {
	const seqs: number[] = [];
	for (let offset = 1; offset <= 3 && seqs.length < 3; offset++) {
		for (const index of [aroundIndex - offset, aroundIndex + offset]) {
			const node = nodes[index];
			if (node === undefined) continue;
			if (node.validStart || node.validEnd) seqs.push(node.seq);
		}
	}
	return seqs.length === 0 ? "" : " Nearest valid boundaries: " + seqs.slice(0, 3).join(", ") + ".";
}

/** Fold balance states over the surface once (index-aligned with surface.nodes). */
function boundaryFlags(session: Session, surface: readonly number[]): { seq: number; validStart: boolean; validEnd: boolean }[] {
	return surface.map((seq) => ({
		seq,
		validStart: safe(() => toolPairingBalancedBefore(session, SessionSeq(seq))),
		validEnd: safe(() => toolPairingBalancedAfter(session, SessionSeq(seq)))
	}));
}

function safe(check: () => boolean): boolean {
	try {
		return check();
	} catch {
		return false;
	}
}

/** Walk the log backward for the open turn number; null between turns. */
function currentOpenTurn(session: Session): number | null {
	for (let seq = session.seq - 1; seq >= 0; seq--) {
		const event = session.eventAt(SessionSeq(seq));
		if (event === undefined) continue;
		if (event.type === "turn/start") return event.data.turn as number;
		if (event.type === "turn/end") return null;
	}
	return null;
}

/** Mirror the engine's lock rule: unmatched compaction/start after the latest end-seed is live. */
function compactionLockHeld(session: Session): boolean {
	let unmatchedStartSeq: number | undefined;
	let stateKnown = false;
	let latestEndSeedSeq: number | undefined;
	for (let seq = session.seq - 1; seq >= 0; seq--) {
		const event = session.eventAt(SessionSeq(seq));
		if (event === undefined) continue;
		if (latestEndSeedSeq === undefined && event.type === "session/end-seed") latestEndSeedSeq = event.seq;
		if (!stateKnown) {
			if (event.type === "compaction/start") {
				unmatchedStartSeq = event.seq;
				stateKnown = true;
			} else if (event.type === "compaction/end") stateKnown = true;
		}
		if (stateKnown && latestEndSeedSeq !== undefined) break;
	}
	if (unmatchedStartSeq === undefined) return false;
	return latestEndSeedSeq === undefined || unmatchedStartSeq > latestEndSeedSeq;
}

/** Heuristic price of the whole surface, derived from a measurement. */
function surfaceTokensOf(measurement: TokenMeasurement): number {
	return measurement.nodes.reduce((sum, node) => sum + node.heuristicTokens, 0);
}

/** Render an error chain like the engine's compaction/end error field. */
function errorChainText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * Validate and commit one clear_mind transaction.
 * @param deps - session, meter, config, route.
 * @param start - range start: seq, "first".
 * @param end - range end: seq, "latest" (everything before the current step).
 * @param notes - the model-written checkpoint notes.
 * @returns the commit report.
 * @throws Error with an actionable message when validation fails.
 */
export function commitClearMind(deps: CommitDeps, start: RangeEndpoint, end: RangeEndpoint, rawNotes: string): ClearCommit {
	const { session, meter, config } = deps;
	const notes = rawNotes.trim();
	const surface = session.surface.nodes as readonly number[];
	const flags = boundaryFlags(session, surface);
	const latestEnd = (() => {
		for (let index = flags.length - 1; index >= 0; index--) {
			if (flags[index].validEnd) return flags[index].seq;
		}
		return undefined;
	})();
	const startSeq = resolveEndpoint(start, "start", surface, latestEnd);
	const endSeq = resolveEndpoint(end, "end", surface, latestEnd);
	const startIdx = surface.indexOf(startSeq);
	const endIdx = surface.indexOf(endSeq);
	if (startIdx === -1 || endIdx === -1) throw new Error("clear_mind: seq boundaries vanished from the surface between resolution and validation — call mind_map again.");
	if (startIdx > endIdx) throw new Error("clear_mind: start seq " + startSeq + " (position " + startIdx + ") comes after end seq " + endSeq + " (position " + endIdx + ") on the surface.");
	if (!flags[startIdx].validStart) throw new Error("clear_mind: a range may not start at seq " + startSeq + " — it would split a tool-call/result pair." + nearestBoundaries(flags, startIdx));
	if (!flags[endIdx].validEnd) throw new Error("clear_mind: a range may not end at seq " + endSeq + " — it would split a tool-call/result pair or the step is still open." + nearestBoundaries(flags, endIdx));
	const shadowedSeqs = surface.slice(startIdx, endIdx + 1);
	if (notes.length < config.minNotesChars) throw new Error("clear_mind: notes are too short (" + notes.length + " chars < " + config.minNotesChars + "). Distill what future-you needs: user intent verbatim, key facts/paths/ids, abandoned paths and why, open threads, next action.");
	if (notes.length > config.maxNotesChars) throw new Error("clear_mind: notes are too long (" + notes.length + " chars > " + config.maxNotesChars + "). A checkpoint is a handover document, not a transcript — keep what future-you needs, drop the rest.");
	const before = meter.measure(session);
	const selected = before.nodes.filter((node) => shadowedSeqs.includes(node.seq));
	if (selected.length !== shadowedSeqs.length) throw new Error("clear_mind: the selected span changed under the survey — call mind_map again and retry.");
	const shadowedTokenCount = selected.reduce((sum, node) => sum + node.heuristicTokens, 0);
	if (shadowedTokenCount < config.minClearTokens) throw new Error("clear_mind: the range only weighs ~" + shadowedTokenCount + " tokens (< " + config.minClearTokens + "). Not worth a checkpoint — wait until more has accumulated or widen the range.");
	const summaryBlocks: ContentBlock[] = [{ type: "text", text: notes }];
	const compactionId = CompactionId(randomUUID());
	const checkpointMessage = frameCheckpointMessage(compactionId, notes);
	// The engine's size discipline: route-priced shadowed tokens when a route
	// has priced the span, heuristic otherwise — identical to compactSurfaceRegion.
	// DELIBERATE DIVERGENCE: compactSurfaceRegion compares purely route-priced
	// totals and rejects when the route priced nothing; we fall back to the
	// heuristic so clear_mind still works on unpriced routes. Do not "fix" this
	// to match the engine without checking unpriced-route behavior.
	const shadowedRouteTokenCount = selected.reduce((sum, node) => sum + node.tokens, 0);
	const referenceTokens = shadowedRouteTokenCount > 0 ? shadowedRouteTokenCount : shadowedTokenCount;
	const framedTokens = meter.estimateMessage(checkpointMessage);
	if (framedTokens >= referenceTokens) throw new Error("clear_mind: the framed checkpoint (~" + framedTokens + " tokens) would not be smaller than the cleared span (~" + referenceTokens + " tokens). Shorten the notes or widen the range.");
	const turn = currentOpenTurn(session);
	if (turn === null) throw new Error("clear_mind: no open turn — the tool must run inside an active turn.");
	if (compactionLockHeld(session)) throw new Error("clear_mind: another compaction is in progress. Retry after it completes.");
	const lifecycle = { compactionId, turn };
	const surfaceTokensBefore = surfaceTokensOf(before);
	let checkpointEventSeq = -1;
	try {
		const startEvent = session.append("compaction/start", lifecycle);
		const summaryEvent = session.append("compaction/summary", {
			compactionId,
			summary: summaryBlocks,
			rawOutput: summaryBlocks,
			shadowedRange: { start: SessionSeq(startSeq), end: SessionSeq(endSeq) },
			shadowedSeqs: shadowedSeqs.map((seq) => SessionSeq(seq)),
			shadowedTokenCount,
			provider: deps.route.provider,
			model: deps.route.model
		});
		const checkpointEvent = session.append("user/message", checkpointMessage, {
			surfaceOp: { op: "replace", start: SessionSeq(startSeq), end: SessionSeq(endSeq) },
			sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs.map((seq) => SessionSeq(seq))]
		});
		checkpointEventSeq = checkpointEvent.seq;
		session.append("compaction/end", lifecycle);
	} catch (error) {
		// Fail-closed: exactly one best-effort close so no unclosed bracket survives.
		try {
			session.append("compaction/end", { ...lifecycle, error: errorChainText(error) });
		} catch {
			// Even the close failed. If the failure was before the checkpoint append,
			// the surface is untouched and the log stays replayable; if the checkpoint
			// replace landed but compaction/end threw, the bracket is unclosed and the
			// session is unrecoverable — the same cliff the engine's commit stage has.
			// Surfacing the original error is all that is left either way.
		}
		throw error;
	}
	const surfaceTokensAfter = surfaceTokensOf(meter.measure(session));
	return {
		kind: "cleared",
		clearedNodes: shadowedSeqs.length,
		clearedTokens: shadowedTokenCount,
		checkpointSeq: checkpointEventSeq,
		surfaceTokensBefore,
		surfaceTokensAfter,
		selfCollapse: config.selfCollapse
	};
}

/** Frame the checkpoint message exactly as the commit transaction appends it. */
export function frameCheckpointMessage(compactionId: CompactionId, notes: string): ReturnType<typeof createUserMessage> {
	return createUserMessage({
		content: [
			{ type: "text", text: CHECKPOINT_PREAMBLE },
			{ type: "text", text: "<compacted-summary>" + "\n" + notes.trim() + "\n" + "</compacted-summary>" }
		],
		// The SAME compactionId the transaction's start/summary/end events carry —
		// the GUI aggregates compaction rows by matching source.compactionId
		// against event.data.compactionId, so a fresh id here would orphan the row.
		source: compactCheckpointSource(compactionId)
	});
}

/** Exposed for tests: derive the checkpoint message size the same way commit does. */
export function framedCheckpointTokens(meter: MeterPort, notes: string): number {
	return meter.estimateMessage(frameCheckpointMessage(CompactionId(randomUUID()), notes));
}

export type { Message };
