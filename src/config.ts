/**
 * dsh-clear-mind configuration.
 *
 * All knobs are advisory guards around the model's own compaction decisions:
 * they stop degenerate calls (tiny clears, empty notes, huge dumps) without
 * second-guessing a sane decision.
 */

import z from "@deepseek-ai/schemastery";

export const Config = z.object({
	minClearTokens: z.number().step(1).min(1).default(1000),
	minNotesChars: z.number().step(1).min(1).default(200),
	maxNotesChars: z.number().step(1).min(1).default(16000),
	selfCollapse: z.boolean().default(true)
});

export interface ClearMindConfig {
	readonly minClearTokens: number;
	readonly minNotesChars: number;
	readonly maxNotesChars: number;
	readonly selfCollapse: boolean;
}

export function resolveConfig(raw: Record<string, unknown> = {}): ClearMindConfig {
	const value = raw as Partial<Record<keyof ClearMindConfig, unknown>>;
	const positive = (input: unknown, fallback: number): number => {
		const parsed = typeof input === "number" ? input : fallback;
		if (!Number.isInteger(parsed) || parsed < 1) throw new Error("dsh-clear-mind config: thresholds must be positive integers");
		return parsed;
	};
	const minNotesChars = positive(value.minNotesChars, 200);
	const maxNotesChars = positive(value.maxNotesChars, 16000);
	if (minNotesChars >= maxNotesChars) throw new Error("dsh-clear-mind config: minNotesChars must be less than maxNotesChars");
	return {
		minClearTokens: positive(value.minClearTokens, 1000),
		minNotesChars,
		maxNotesChars,
		selfCollapse: typeof value.selfCollapse === "boolean" ? value.selfCollapse : true
	};
}
