/**
 * dsh-clear-mind configuration.
 *
 * Two groups of knobs:
 * - Compaction guards: stop degenerate calls (tiny clears, empty notes,
 *   huge dumps) without second-guessing a sane decision.
 * - Proactive reminder: when to nudge the model toward clearing its mind
 *   before the platform's automatic compaction kicks in.
 */

import z from "@deepseek-ai/schemastery";

export const Config = z.object({
	minClearTokens: z.number().step(1).min(1).default(1000),
	minNotesChars: z.number().step(1).min(1).default(200),
	maxNotesChars: z.number().step(1).min(1).default(16000),
	selfCollapse: z.boolean().default(true),
	reminderEnabled: z.boolean().default(true),
	reminderThresholdRatio: z.number().min(0.01).max(1).default(0.70),
	reminderThresholdTokens: z.number().step(1).min(0).default(0),
	reminderThresholdSteps: z.number().step(1).min(1).default(40),
	reminderStepInterval: z.number().step(1).min(1).default(10)
});

export interface ClearMindConfig {
	readonly minClearTokens: number;
	readonly minNotesChars: number;
	readonly maxNotesChars: number;
	readonly selfCollapse: boolean;
	readonly reminderEnabled: boolean;
	readonly reminderThresholdRatio: number;
	readonly reminderThresholdTokens: number;
	readonly reminderThresholdSteps: number;
	readonly reminderStepInterval: number;
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
	return {
		minClearTokens: positive(value.minClearTokens, 1000),
		minNotesChars,
		maxNotesChars,
		selfCollapse: typeof value.selfCollapse === "boolean" ? value.selfCollapse : true,
		reminderEnabled: typeof value.reminderEnabled === "boolean" ? value.reminderEnabled : true,
		reminderThresholdRatio: ratio,
		reminderThresholdTokens: nonNegative(value.reminderThresholdTokens, 0),
		reminderThresholdSteps: positive(value.reminderThresholdSteps, 40),
		reminderStepInterval: positive(value.reminderStepInterval, 10)
	};
}
