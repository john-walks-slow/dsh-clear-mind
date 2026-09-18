/**
 * dsh-clear-mind configuration.
 *
 * Three groups of knobs:
 * - Compaction guards: stop degenerate calls (tiny clears, empty notes,
 *   huge dumps) without second-guessing a sane decision.
 * - Prompt overrides: free-text replacement for any prompt segment the
 *   plugin emits, globally (`playbook`) and per agent preset
 *   (`presetPlaybook`). An absent or blank field keeps the built-in text —
 *   no style presets, the operator writes the words.
 * - Proactive reminder: when to nudge the model toward clearing its mind
 *   before the platform's automatic compaction kicks in.
 */

import z from "@deepseek-ai/schemastery";
import type Schema from "@deepseek-ai/schemastery";

/** One free-text override for a single prompt segment. Blank/absent = keep built-in. */
export interface PlaybookOverride {
	readonly title?: string;
	readonly rangeGuide?: string;
	/** Multi-line: rendered verbatim, one output line per \n. */
	readonly notesGuide?: string;
	readonly selfCheck?: string;
	readonly callHint?: string;
	/** The "when to survey" paragraph inside the mind_map tool description. */
	readonly signals?: string;
	readonly reminderHead?: string;
	/** Multi-line: rendered verbatim, one output line per \n. */
	readonly reminder?: string;
}

/** The prompt segment names an override may replace. */
export const PLAYBOOK_OVERRIDE_KEYS = [
	"title", "rangeGuide", "notesGuide", "selfCheck", "callHint", "signals", "reminderHead", "reminder"
] as const;

export type PlaybookOverrideKey = (typeof PLAYBOOK_OVERRIDE_KEYS)[number];

/**
 * An override may name any subset of segments — schemastery keeps absent keys
 * absent, and resolveConfig sanitizes unknown/non-string values away, so the
 * schema is only declared at the partial type the runtime actually honors.
 */
const PlaybookOverrideSchema = z.object({
	title: z.string(),
	rangeGuide: z.string(),
	notesGuide: z.string(),
	selfCheck: z.string(),
	callHint: z.string(),
	signals: z.string(),
	reminderHead: z.string(),
	reminder: z.string()
}) as unknown as Schema<PlaybookOverride>;

export const Config = z.object({
	minClearTokens: z.number().step(1).min(1).default(1000),
	minNotesChars: z.number().step(1).min(1).default(200),
	maxNotesChars: z.number().step(1).min(1).default(16000),
	selfCollapse: z.boolean().default(true),
	playbook: PlaybookOverrideSchema.default({}),
	presetPlaybook: z.dict(PlaybookOverrideSchema).default({}),
	reminderEnabled: z.boolean().default(true),
	reminderThresholdRatio: z.number().min(0.01).max(1).default(0.70),
	reminderThresholdTokens: z.number().step(1).min(0).default(0),
	reminderThresholdSteps: z.number().step(1).min(1).default(100),
	reminderStepInterval: z.number().step(1).min(1).default(25)
});

export interface ClearMindConfig {
	readonly minClearTokens: number;
	readonly minNotesChars: number;
	readonly maxNotesChars: number;
	readonly selfCollapse: boolean;
	readonly playbook: PlaybookOverride;
	readonly presetPlaybook: Readonly<Record<string, PlaybookOverride>>;
	readonly reminderEnabled: boolean;
	readonly reminderThresholdRatio: number;
	readonly reminderThresholdTokens: number;
	readonly reminderThresholdSteps: number;
	readonly reminderStepInterval: number;
}

/** Keep only known string-valued keys from a raw override object. */
function sanitizeOverride(raw: unknown): PlaybookOverride {
	const out: Record<string, string> = {};
	if (raw !== undefined && typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
		for (const key of PLAYBOOK_OVERRIDE_KEYS) {
			const field = (raw as Record<string, unknown>)[key];
			if (typeof field === "string") out[key] = field;
		}
	}
	return out as PlaybookOverride;
}

export function resolveConfig(raw: Partial<ClearMindConfig> | Record<string, unknown> = {}): ClearMindConfig {
	const value = raw as Partial<Record<keyof ClearMindConfig, unknown>>;
	const positive = (input: unknown, fallback: number): number => {
		const parsed = typeof input === "number" ? input : fallback;
		if (!Number.isInteger(parsed) || parsed < 1) throw new Error("dsh-clear-mind config: thresholds must be positive integers");
		return parsed;
	};
	const nonNegative = (input: unknown, fallback: number): number => {
		const parsed = typeof input === "number" ? input : fallback;
		if (!Number.isInteger(parsed) || parsed < 0) throw new Error("dsh-clear-mind config: reminderThresholdTokens must be a non-negative integer");
		return parsed;
	};
	const ratio = (() => {
		const parsed = typeof value.reminderThresholdRatio === "number" ? value.reminderThresholdRatio : 0.70;
		if (!(parsed > 0 && parsed <= 1)) throw new Error("dsh-clear-mind config: reminderThresholdRatio must be in (0, 1]");
		return parsed;
	})();
	const minNotesChars = positive(value.minNotesChars, 200);
	const maxNotesChars = positive(value.maxNotesChars, 16000);
	if (minNotesChars >= maxNotesChars) throw new Error("dsh-clear-mind config: minNotesChars must be less than maxNotesChars");
	const presetPlaybook: Record<string, PlaybookOverride> = {};
	const rawPresets = value.presetPlaybook;
	if (rawPresets !== undefined && typeof rawPresets === "object" && rawPresets !== null && !Array.isArray(rawPresets)) {
		for (const [preset, override] of Object.entries(rawPresets)) {
			presetPlaybook[preset] = sanitizeOverride(override);
		}
	}
	return {
		minClearTokens: positive(value.minClearTokens, 1000),
		minNotesChars,
		maxNotesChars,
		selfCollapse: typeof value.selfCollapse === "boolean" ? value.selfCollapse : true,
		playbook: sanitizeOverride(value.playbook),
		presetPlaybook,
		reminderEnabled: typeof value.reminderEnabled === "boolean" ? value.reminderEnabled : true,
		reminderThresholdRatio: ratio,
		reminderThresholdTokens: nonNegative(value.reminderThresholdTokens, 0),
		reminderThresholdSteps: positive(value.reminderThresholdSteps, 100),
		reminderStepInterval: positive(value.reminderStepInterval, 25)
	};
}
