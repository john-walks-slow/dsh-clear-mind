/**
 * dsh-clear-mind — model-autonomous context compaction for DeepSeek Harness.
 *
 * Two exclusive tools for every ROOT agent:
 *   - mind_map: survey the agent's own model-visible surface (seqs, roles,
 *     token weights, valid clear boundaries, prior checkpoints).
 *   - clear_mind: replace a chosen surface span with a checkpoint the model
 *     itself distills, through the platform's native compaction transaction
 *     (start / summary / replace / end) so the GUI, token meter, and future
 *     auto-compactions all understand it.
 * Plus the clear-mind runtime skill teaching WHEN and HOW to clear, and a
 * step-boundary self-collapse that folds each clear_mind call+result into a
 * one-line tombstone once the checkpoint has landed.
 *
 * Human-side history is never touched: the append-only log is the source of
 * truth and the GUI transcript renders append-origin events, so every clear
 * stays fully reviewable and reversible by the human.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
// Type-only: pulls the ctx.skills Context augmentation into the compile without
// emitting a runtime import (dsh-skill stays a devDependency).
import type {} from "@deepseek-ai/dsh-skill";
import { Config, resolveConfig } from "./config.js";
import type { MeterPort } from "./scan.js";
import { mindMapTool, clearMindTool } from "./tools.js";
import { CLEAR_MIND_SKILL } from "./skill.js";
import { collapseClearMindRuns } from "./collapse.js";

export const name = "dsh-clear-mind";
export const inject = ["tools", "tokenMeter", "skills", "agents"];
export { Config };

export function apply(ctx: Context, config: Record<string, unknown> = {}) {
	const resolved = resolveConfig(config);
	const meter: MeterPort = {
		measure: (session) => ctx.tokenMeter.measure(session),
		estimateMessage: (message) => ctx.tokenMeter.estimateMessage(message)
	};

	// Register both tools on every root agent exactly once. Subagents keep the
	// platform's automatic compaction only — their context is short-lived by
	// design and scoped delegation should not rewrite its own history.
	const registered = new WeakSet<Agent>();
	const registerOne = (agent: Agent) => {
		if (registered.has(agent)) return;
		if (!ctx.agents.roots().includes(agent)) return;
		registered.add(agent);
		agent.ctx.tools.register(mindMapTool(meter));
		agent.ctx.tools.register(clearMindTool(meter, resolved));
	};
	ctx.on("agent/created", ({ agent }: { agent: Agent }) => {
		registerOne(agent);
	});
	for (const existing of ctx.agents.roots()) {
		registerOne(existing);
	}

	// The clear-mind skill: catalog-level teaching for when and how to clear.
	ctx.skills.register({
		name: CLEAR_MIND_SKILL.name,
		description: CLEAR_MIND_SKILL.description,
		whenToUse: CLEAR_MIND_SKILL.whenToUse,
		content: CLEAR_MIND_SKILL.content,
		source: "runtime"
	});

	// Self-collapse at the next step boundary: fold every completed clear_mind
	// call+result pair into a one-line tombstone (guarded, stateless scan).
	ctx.on("agent/pre-step", async (
		payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
		next: () => Promise<PreStepDecision>
	): Promise<PreStepDecision> => {
		// Only registered root agents can ever carry a clear_mind call; skipping
		// everyone else keeps the per-step scan off subagents entirely.
		if (resolved.selfCollapse && registered.has(payload.agent)) {
			try {
				collapseClearMindRuns(payload.agent.session, meter);
			} catch (error) {
				ctx.logger.warn("dsh-clear-mind: self-collapse skipped (" + (error instanceof Error ? error.message : String(error)) + ")");
			}
		}
		return next();
	});

	ctx.logger.info("dsh-clear-mind: registered mind_map + clear_mind for root agents; skill clear-mind available");
}
