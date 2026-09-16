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
 * Plus a step-boundary self-collapse that folds each clear_mind call+result
 * into a one-line tombstone once the checkpoint has landed, and a proactive
 * reminder that nudges the model when the context grows long or a turn runs
 * too many steps. The clear-mind playbook (when to clear, how to pick a
 * range and write the notes) is folded into the mind_map tool description
 * and result so no separate skill needs to be read first.
 *
 * Human-side history is never touched: the append-only log is the source of
 * truth and the GUI transcript renders append-origin events, so every clear
 * stays fully reviewable and reversible by the human.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { Config, resolveConfig } from "./config.js";
import type { ClearMindConfig } from "./config.js";
import type { MeterPort } from "./scan.js";
import { mindMapTool, clearMindTool } from "./tools.js";
import { collapseClearMindRuns } from "./collapse.js";
import { evaluateReminder, buildReminderMessage } from "./reminder.js";
import type { AgentReminderState, ModelInfoPort } from "./reminder.js";

export const name = "dsh-clear-mind";
export const inject = ["tools", "tokenMeter", "agents", "llm"];
export { Config };

export function apply(ctx: Context, config: Record<string, unknown> = {}) {
	const resolved = resolveConfig(config);
	const meter: MeterPort = {
		measure: (session) => ctx.tokenMeter.measure(session),
		estimateMessage: (message) => ctx.tokenMeter.estimateMessage(message)
	};
	const modelInfo: ModelInfoPort = {
		resolveContextWindow: async (provider, model, signal) => {
			try {
				const info = await ctx.llm.resolveModelInfo(provider, model, signal);
				return info?.context?.contextWindow;
			} catch {
				return undefined;
			}
		}
	};
	const reminderStates = new WeakMap<Agent, AgentReminderState>();

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

	// Optional settings namespace registration: lets the Web UI read and
	// hot-edit every config knob without a restart. Degrades to a logged
	// no-op on headless profiles that lack a settings service.
	const settings = ctx.get("settings", false);
	if (settings !== undefined && typeof (settings as { register?: unknown }).register === "function") {
		try {
			const scope = (settings as { register: (ns: string, schema: unknown, opts?: unknown) => { watch: (cb: (next: ClearMindConfig) => void) => () => void; get: () => ClearMindConfig } }).register("clear-mind", Config, { base: resolved });
			scope.watch((next: ClearMindConfig) => {
				try {
					Object.assign(resolved, resolveConfig(next));
					ctx.logger.info("dsh-clear-mind: settings hot-applied");
				} catch (error) {
					// Cross-field validation can reject a user save (e.g.
					// minNotesChars >= maxNotesChars). Keep the previous live
					// config so the runtime never drifts from a consistent state;
					// the settings UI surfaces its own cross-field error.
					ctx.logger.warn("dsh-clear-mind: settings update rejected (" + (error instanceof Error ? error.message : String(error)) + "); keeping previous live config");
				}
			});
			Object.assign(resolved, resolveConfig(scope.get()));
			ctx.logger.info("dsh-clear-mind: settings namespace `clear-mind` registered; hot-reload enabled");
		} catch (error) {
			ctx.logger.warn("dsh-clear-mind: settings registration failed (" + (error instanceof Error ? error.message : String(error)) + ")");
		}
	} else {
		ctx.logger.info("dsh-clear-mind: no settings service composed; configuration UI and hot-reload disabled");
	}

	// Self-collapse + proactive reminder at the step boundary. The self-collapse
	// runs BEFORE next() (it mutates the surface the downstream listeners see);
	// the reminder runs AFTER next() (it folds its message into the enter
	// decision the loop is about to execute).
	ctx.on("agent/pre-step", async (
		payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
		next: () => Promise<PreStepDecision>
	): Promise<PreStepDecision> => {
		// Self-collapse: fold every completed clear_mind call+result pair.
		if (resolved.selfCollapse && registered.has(payload.agent)) {
			try {
				collapseClearMindRuns(payload.agent.session, meter);
			} catch (error) {
				ctx.logger.warn("dsh-clear-mind: self-collapse skipped (" + (error instanceof Error ? error.message : String(error)) + ")");
			}
		}
		const decision = await next();
		if (decision.kind === "reject" || payload.signal.aborted) return decision;
		if (!registered.has(payload.agent)) return decision;
		// Proactive reminder: nudge the model when context is long or a turn
		// has run too many steps.
		try {
			const trigger = await evaluateReminder(
				resolved, payload.agent, meter, modelInfo,
				payload.turn, payload.step, payload.signal, reminderStates
			);
			if (trigger !== null) {
				return { ...decision, messages: [...decision.messages, buildReminderMessage(trigger)] };
			}
		} catch (error) {
			ctx.logger.warn("dsh-clear-mind: reminder evaluation skipped (" + (error instanceof Error ? error.message : String(error)) + ")");
		}
		return decision;
	});

	ctx.logger.info("dsh-clear-mind: registered mind_map + clear_mind for root agents; clear-mind playbook folded into mind_map");
}
