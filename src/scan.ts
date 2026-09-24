/**
 * mind_map survey: scan a session's model-visible surface into the data the
 * model needs to choose a clear_mind range.
 *
 * The scan is a pure read: log walk (turn attribution + tool-name resolution)
 * plus a surface pass (per-node role, heuristic tokens, one-line preview,
 * tool-pairing-valid boundaries, prior-checkpoint markers). Nothing here
 * mutates the session.
 */

import { homedir } from "node:os";
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
	/** user / assistant / tool (tool = tool-result message) / system (system-prompt node). */
	readonly kind: "user" | "assistant" | "tool" | "system";
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
	/** Earliest seq inside this turn a clear may start at (the run head may be an unclearable system prompt); absent when none. */
	readonly firstStartSeq?: number;
	/** Latest seq inside this turn a clear may end at; absent when none. */
	readonly lastEndSeq?: number;
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
/** Tool-call hint lines carry the UI row summary, so they get more room. */
const CALL_HINT_MAX = 96;

/** Collapse whitespace and cap to the preview budget. */
function toPreviewLine(text: string): string {
	const collapsed = text.trim().replace(/[\t\n\r]+/g, " ");
	if (collapsed.length === 0) return "";
	return collapsed.length <= PREVIEW_MAX ? collapsed : collapsed.slice(0, PREVIEW_MAX - 1) + "…";
}

// The hint below mirrors how the web client derives an UNEXPANDED tool row's
// summary from the call arguments, so a map line and the row the user is
// looking at stay comparable. Value derivation mirrors toolRowModel's
// deriveSummary (bash shows its description rather than the command, read/edit
// the path, grep the pattern, web_search the joined queries); the derived
// summary then passes through the same relativizeToCwd + abbreviateHomePath
// pair the UI applies uniformly to every variant, so file paths show
// workspace-relative or `~`-abbreviated exactly like the row. Known, accepted
// divergences:
//  - BashRow renders its raw description without the path transforms (and an
//    error row renders the failure line instead); the map applies the
//    transforms uniformly and always shows the call-side summary — errors stay
//    on the tool-result node's "name !" prefix.
//  - Malformed or empty arguments degrade to the bare tool name (UI: raw JSON
//    head or callId), and previews keep the map's hard per-segment/line caps.
// Mirror source: dsh-client-ui-tool's client.js (toolRowModel, deriveSummary,
// relativizeToCwd, abbreviateHomePath) in the dsh checkout at
// /usr/lib/node_modules/@deepseek-ai/dsh — when dsh is upgraded, re-diff the
// tables and helpers below against that file.

type ToolVariant = "bash" | "read" | "search" | "write" | "edit" | "code" | "others";

/**
 * Session display context for the row-summary path transforms: the session's
 * workspace root (relativize paths under it) and the host account home
 * (abbreviate leftover POSIX home paths to `~`).
 */
interface RowDisplayContext {
	readonly cwd?: string;
	readonly home?: string;
}

/** Mirror of the web client's isWindowsStylePath. */
function isWindowsStylePath(value: string): boolean {
	return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
}

/** Mirror of the web client's relativizeToCwd: strip the workspace-root prefix. */
function relativizeToCwd(text: string, cwd: string | undefined): string {
	if (cwd === undefined || cwd === "") return text;
	const root = cwd.replace(/[/\\]+$/, "");
	if (text.startsWith(root + "/") || text.startsWith(root + "\\")) return text.slice(root.length + 1);
	return text;
}

/** Mirror of the web client's abbreviateHomePath: collapse the home prefix to `~`. */
function abbreviateHomePath(path: string, home: string | undefined): string {
	if (home === undefined || home === "") return path;
	if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path;
	const root = home.replace(/\/+$/, "");
	if (root === "" || root === "/") return path;
	if (path.replace(/\/+$/, "") === root) return "~";
	if (path.startsWith(root + "/")) return "~" + path.slice(root.length);
	return path;
}

/** Tool name → row variant (mirror of the web client's TOOL_VARIANTS). */
const TOOL_VARIANTS: Readonly<Record<string, ToolVariant>> = {
	bash: "bash",
	pwsh: "bash",
	read: "read",
	web_fetch: "read",
	cordis_package_inspect: "read",
	cordis_runtime_inspect: "read",
	web_search: "search",
	grep: "search",
	glob: "search",
	write: "write",
	edit: "edit",
	run_code: "code",
	cordis_run: "others",
	cordis_stop: "others",
	cordis_undefine: "others"
};

/** Summary key preference per variant (mirror of the web client's SUMMARY_KEYS). */
const SUMMARY_KEYS: Readonly<Record<ToolVariant, readonly string[]>> = {
	bash: ["description", "command"],
	read: ["path", "file_path", "url"],
	search: ["query", "pattern", "url"],
	write: ["path", "file_path"],
	edit: ["path", "file_path"],
	code: ["description"],
	others: []
};

/** First line only — a UI row summary never crosses a newline. */
function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return newline === -1 ? text : text.slice(0, newline);
}

/** The unexpanded-row summary the web client derives from one call's arguments. */
function rowSummary(variant: ToolVariant, args: Record<string, unknown>): string | undefined {
	if (variant === "search" && Array.isArray(args.queries)) {
		const queries = args.queries.filter((query): query is string => typeof query === "string" && query !== "");
		if (queries.length > 0) return queries.map(firstLine).join(", ");
	}
	for (const key of SUMMARY_KEYS[variant]) {
		const value = args[key];
		if (typeof value === "string" && value !== "") return firstLine(value);
	}
	for (const value of Object.values(args)) {
		if (typeof value === "string" && value !== "") return firstLine(value);
	}
	return undefined;
}

/**
 * One tool call as a map hint: name plus the same unexpanded-row summary the
 * user sees in the web UI, with the UI's path transforms (workspace
 * relativization + `~` abbreviation) applied. Malformed or empty arguments
 * degrade to the bare name — the map must never fail over a preview.
 */
function callHint(call: Extract<ContentBlock, { type: "tool-call" }>, display: RowDisplayContext): string {
	let parsed: Record<string, unknown> | null = null;
	if (typeof call.arguments === "string" && call.arguments.length > 0) {
		try {
			const value: unknown = JSON.parse(call.arguments);
			if (typeof value === "object" && value !== null) parsed = value as Record<string, unknown>;
		} catch {
			// Raw JSON string as produced by the model may be truncated — no hint.
		}
	}
	if (parsed !== null) {
		const raw = rowSummary(TOOL_VARIANTS[call.name] ?? "others", parsed);
		if (raw !== undefined) {
			const summary = toPreviewLine(abbreviateHomePath(relativizeToCwd(raw, display.cwd), display.home));
			if (summary !== "") return call.name + " · " + summary;
		}
	}
	return call.name;
}

/** Extract text from content blocks for preview purposes. */
function textOfBlocks(blocks: readonly ContentBlock[]): string {
	for (const block of blocks) {
		if (block.type === "text") return block.text;
	}
	return "";
}

/** Build the one-line preview for a derived message. */
function previewOfMessage(message: Message, toolNames: ReadonlyMap<string, string>, display: RowDisplayContext): { preview: string; kind: "user" | "assistant" | "tool"; toolName?: string; isError?: boolean } {
	if (message.role === "user" && message.content.length > 0 && message.content[0].type === "tool-result") {
		const result = message.content[0];
		const preview = toPreviewLine(textOfBlocks(result.content));
		const name = toolNames.get(result.toolCallId);
		const prefix = (name !== undefined ? name : "tool") + (result.isError === true ? " ! " : ": ");
		return { preview: prefix + preview, kind: "tool", toolName: name, isError: result.isError === true };
	}
	if (message.role === "assistant") {
		const calls = message.content.filter((block): block is Extract<ContentBlock, { type: "tool-call" }> => block.type === "tool-call");
		if (calls.length > 0) {
			const joined = calls.map((call) => callHint(call, display)).join(", ");
			return { preview: joined.length <= CALL_HINT_MAX ? "→ " + joined : "→ " + joined.slice(0, CALL_HINT_MAX - 1) + "…", kind: "assistant" };
		}
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
 * Whether surface node 0 is the platform-protected system prompt head.
 *
 * The engine's assertSystemHeadRewrite (dsh-session surface.js) only admits a
 * `system/message` replacement over exactly that node; a clear_mind range may
 * never cover it, so the survey's validStart and the commit's boundary flags
 * and "first" resolution all treat it as an untouchable prefix.
 */
export function isSystemHead(session: Session, surface: readonly number[]): boolean {
	if (surface.length === 0) return false;
	const head = session.eventAt(SessionSeq(surface[0]));
	return head?.type === "system/message";
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
	// Row-display context mirrors what the web client passes its tool rows:
	// the session's workspace root and the host account home.
	const display: RowDisplayContext = { cwd: session.header.cwd, home: homedir() };
	const heuristicBySeq = new Map<number, number>();
	for (const node of measurement.nodes) heuristicBySeq.set(node.seq, node.heuristicTokens);
	const nodes: SurveyNode[] = [];
	const surfaceNodes = session.surface.nodes as readonly number[];
	const systemHead = isSystemHead(session, surfaceNodes);
	for (const [position, seq] of surfaceNodes.entries()) {
		const event = session.eventAt(SessionSeq(seq));
		if (event === undefined || !isSurfaceEvent(event)) continue;
		const message = deriveEventMessage(event);
		const tokens = message === null ? 0 : (heuristicBySeq.get(seq) ?? meter.estimateMessage(message));
		const shape: { preview: string; kind: SurveyNode["kind"]; toolName?: string; isError?: boolean } =
			event.type === "system/message"
				? { preview: message === null ? "(no system prompt)" : toPreviewLine(textOfBlocks(message.content)), kind: "system" }
				: message === null
					? { preview: "(empty)", kind: "assistant" }
					: previewOfMessage(message, toolNames, display);
		nodes.push({
			seq,
			turn: turnsBySeq.get(seq) ?? null,
			kind: shape.kind,
			tokens,
			preview: shape.preview,
			// Surface position 0 holding a system/message is the engine-protected
			// system prompt: a replace starting there is rejected outright, so it
			// is never offered as a range start.
			validStart: position === 0 && systemHead ? false : safeBalanced(() => toolPairingBalancedBefore(session, SessionSeq(seq))),
			validEnd: safeBalanced(() => toolPairingBalancedAfter(session, SessionSeq(seq))),
			checkpoint: message !== null && message.role === "user" && isCheckpointSource(message),
			...(shape.toolName !== undefined ? { toolName: shape.toolName } : {}),
			...(shape.isError !== undefined ? { isError: shape.isError } : {})
		});
	}
	// Turn summaries fold over the surfaced nodes in order (consecutive runs).
	const turnRuns: { turn: number; startSeq: number; endSeq: number; nodes: number; tokens: number; firstStartSeq?: number; lastEndSeq?: number; firstUserPreview?: string }[] = [];
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
		// Boundary seqs the aggregated turn line may offer: a run whose head is
		// the system prompt (validStart false) must not advertise that head.
		if (node.validStart && bucket.firstStartSeq === undefined) bucket.firstStartSeq = node.seq;
		if (node.validEnd) bucket.lastEndSeq = node.seq;
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
