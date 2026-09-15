/**
 * Tool layer: mind_map (survey) and clear_mind (commit) definitions.
 *
 * Both tools are exclusive (no isConcurrencySafe): surveys should observe a
 * settled surface, and commits mutate it. Validation failures throw Error so
 * the model receives an isError result it can act on; successful values follow
 * the declared output schemas.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { scanSurface } from "./scan.js";
import type { MeterPort, Survey } from "./scan.js";
import { renderSurvey } from "./render.js";
import { commitClearMind } from "./commit.js";
import { tryAgentRoute } from "./route.js";
import type { ClearMindConfig } from "./config.js";

/** Resolve the durable provider/model route, throwing when none is on record. */
function requireRoute(agent: Agent): { provider: string; model: string } {
	const route = tryAgentRoute(agent);
	if (route === undefined) throw new Error("clear_mind: the session has no routed provider/model on record.");
	return route;
}

function requireAgent(agent: Agent | undefined): Agent {
	if (agent === undefined) throw new Error("clear_mind: no agent is attached to this execution.");
	return agent;
}

/** Build the mind_map tool definition bound to a meter port. */
export function mindMapTool(meter: MeterPort) {
	return defineTool({
		name: "mind_map",
		description:
			"Survey your own context surface: every model-visible message with its stable seq id, role, token weight, and a one-line preview, grouped by turn. Valid clear_mind range boundaries are marked. Call this first when planning a clear_mind — pick start/end seqs from this map. Takes no arguments.",
		parameters: {},
		output: {
			schema: {
				type: "object", additionalProperties: false,
				properties: {
					kind: { type: "string", const: "survey", required: true },
					surfaceNodes: { type: "integer", required: true },
					surfaceTokens: { type: "integer", required: true },
					requestPressureTokens: { type: "integer", required: true },
					latestEndSeq: { type: "integer" },
					turns: {
						type: "array", required: true,
						items: {
							type: "object", additionalProperties: false,
							properties: {
								turn: { type: "integer", required: true },
								startSeq: { type: "integer", required: true },
								endSeq: { type: "integer", required: true },
								nodes: { type: "integer", required: true },
								tokens: { type: "integer", required: true },
								firstUserPreview: { type: "string" }
							}
						}
					},
					nodes: {
						type: "array", required: true,
						items: {
							type: "object", additionalProperties: false,
							properties: {
								seq: { type: "integer", required: true },
								turn: { oneOf: [{ type: "integer" }, { type: "null" }], required: true },
								kind: { type: "string", enum: ["user", "assistant", "tool"], required: true },
								tokens: { type: "integer", required: true },
								preview: { type: "string", required: true },
								validStart: { type: "boolean", required: true },
								validEnd: { type: "boolean", required: true },
								checkpoint: { type: "boolean", required: true },
								toolName: { type: "string" },
								isError: { type: "boolean" }
							}
						}
					}
				}
			},
			render: (_args, value: Survey): ContentBlock[] => [
				{ type: "text", text: renderSurvey(value) }
			]
		},
		presentCall: () => ({ card: "generic", title: "Survey context surface", kind: "read" }),
		async execute(_args, exec) {
			const agent = requireAgent(exec.agent);
			return scanSurface(agent.session, meter);
		}
	});
}

/** Build the clear_mind tool definition bound to a meter port and config. */
export function clearMindTool(meter: MeterPort, config: ClearMindConfig) {
	return defineTool({
		name: "clear_mind",
		description:
			"Clear your mind: replace a range of your own conversation history with a distilled checkpoint you write, freeing context and attention. First call mind_map to get seq ids. Args: start (seq or 'first'), end (seq or 'latest' = everything before the current step), notes (the checkpoint: user intent verbatim, key facts/paths/ids, abandoned paths and why, open threads, next action — absorb any prior checkpoints inside the range). Keep recent in-flight turns verbatim; clear completed or abandoned phases. This call and its result self-erase at the next step boundary; the human-side history stays untouched. Read the clear-mind skill for the full workflow.",
		parameters: {
			start: {
				oneOf: [{ type: "integer" }, { type: "string", const: "first" }],
				required: true,
				description: "Range start: a surface seq from mind_map, or 'first'."
			},
			end: {
				oneOf: [{ type: "integer" }, { type: "string", const: "latest" }],
				required: true,
				description: "Range end: a surface seq from mind_map, or 'latest' (everything before the current step)."
			},
			notes: {
				type: "string", required: true,
				description: "The checkpoint notes future-you needs (see the clear-mind skill template)."
			}
		},
		output: {
			schema: {
				type: "object", additionalProperties: false,
				properties: {
					kind: { type: "string", const: "cleared", required: true },
					clearedNodes: { type: "integer", required: true },
					clearedTokens: { type: "integer", required: true },
					checkpointSeq: { type: "integer", required: true },
					surfaceTokensBefore: { type: "integer", required: true },
					surfaceTokensAfter: { type: "integer", required: true },
					selfCollapse: { type: "boolean", required: true }
				}
			},
			render: (_args, value): ContentBlock[] => [
				{
					type: "text",
					text:
						"Cleared " + value.clearedNodes + " messages (~" + value.clearedTokens + " tokens) into checkpoint seq " + value.checkpointSeq + ". " +
						"Surface: ~" + value.surfaceTokensBefore + " → ~" + value.surfaceTokensAfter + " tokens. " +
						(value.selfCollapse
							? "Your clear_mind call and this result fold into a one-line tombstone at the next step boundary; the checkpoint now stands for the cleared span. "
						: "") +
						"Reorient briefly (goal, constraints, next step), then continue."
				}
			],
			presentationMeta: (_args, value) => ({
				clearedNodes: value.clearedNodes,
				clearedTokens: value.clearedTokens,
				checkpointSeq: value.checkpointSeq
			})
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Clear mind: " + (args.start === "first" ? "first" : "seq " + args.start) + " → " + (args.end === "latest" ? "latest" : "seq " + args.end),
			kind: "other",
			rawInput: { start: args.start, end: args.end, notesChars: args.notes.length }
		}),
		async execute(args, exec) {
			const agent = requireAgent(exec.agent);
			return commitClearMind(
				{ session: agent.session, meter, config, route: requireRoute(agent) },
				args.start,
				args.end,
				args.notes
			);
		}
	});
}
