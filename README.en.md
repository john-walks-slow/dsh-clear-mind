# dsh-clear-mind

<p align="center">
  <a href="./README.md"><strong>简体中文</strong></a> ·
  <a href="./README.en.md"><strong>English</strong></a>
</p>

A DeepSeek Harness (cordis) plugin for model-autonomous context compaction: when failed exploration and large outputs drag the context down, the model calls `clear_mind` to "clear its mind" — replacing a span of conversation history with a checkpoint it wrote itself, keeping only the notes and freeing attention and token budget. The human-side history is never touched: every clear renders in the GUI as an expandable compaction row.


![dsh-clear-mind in the DSH settings: proactive reminder thresholds and compaction guards](assets/screenshot-1.png)

## What the model sees

**`mind_map`** surveys the model's own context surface: every message with its stable seq id, role, token weight, and a one-line preview, grouped by turn; `▸` marks a valid range start, `◂` a valid range end, `◆` a prior checkpoint, and the result carries the clear-mind playbook (when to clear, how to pick a range, how to write the notes, the pre-commit self-check):

```
Mind surface: 31 nodes, ~41.2k tokens; request pressure ~41.2k tokens.
Seqs are ids in surface order (the list is NOT numeric-sorted after any clear/compaction) — use them as identities, not as an interval.
Range boundaries are marked ▸ (may start a clear) and ◂ (may end a clear); ◆ marks a prior checkpoint. Latest clearable end: seq 24.

turn 1 · seqs 1-10 · 10 nodes · ~15.3k tok — help me debug the plugin build error
 ▸    1   ◆user      1.20k "help me debug the plugin build error"
      2    assistant   340 "Let me look at the tsc output first."
      4    tool      4.90k "bash · npm run build"
      8 ◂  assistant   260 "Build passes. Summary: the include array missed the scripts directory."

turn 2 · seqs 11-24 · 14 nodes · ~18.9k tok — still failing, try a different bundler
 ▸   11    user        900 "still failing, try a different bundler"
     24 ◂  assistant   350 "The client bundle loads fine now, issue resolved."

— clear-mind playbook —
Range choice: clear "completed old phases" or "collapsible side branches"; keep at least the last 1-2 turns verbatim……
Pre-commit self-check: is every open requirement captured? Are paths/ids/numbers you'll need verbatim?……
```

**`clear_mind(start, end, notes)`** replaces the `[start..end]` span with a checkpoint the model distills itself, through the platform's native compaction transaction (start → summary → replace → end) so the GUI, the token meter, and later auto-compactions all understand it; failure paths are fail-closed and never leave an unclosed transaction:

```
Cleared 24 messages (~34.2k tokens) into checkpoint seq 25. Surface: ~41.2k → ~9.6k tokens.
Your clear_mind call and this result fold into a one-line tombstone at the next step boundary;
the checkpoint now stands for the cleared span. Reorient briefly (goal, constraints, next step), then continue.
```

At the next step boundary the call and its result fold into a one-line tombstone; in the GUI the checkpoint renders as a native compaction row ("compacted N history items", notes expandable).

**Proactive reminder**: when the context grows long or a single turn runs too many steps, the plugin folds a `<system-reminder>` into the next step boundary nudging the model to clear proactively (thresholds and cooldown under Configuration):

```
<system-reminder>
[Context / Step Alert] 当前会话已达到主动清理检查点：
- 原因：上下文已占模型窗口的 71%（95200/128000 tokens，阈值 70%）
- 建议：长上下文或单轮过多 Step 容易累积过时试错过程与冗余工具输出，分散注意力并增加推理成本。
- 行动指引：先调用 mind_map 审视当前上下文表面，然后将已完成阶段/可收敛支线通过 clear_mind 压缩为检查点，剔除噪音留下有用信息。若手头工作尚未完成，先把这一阶段的工作做完再清理即可。
</system-reminder>
```

(The reminder text the model receives is bilingual as shown above.)

## Behavior rules

- **Root agents only**: `mind_map` / `clear_mind` are registered exclusively on root agents; subagents keep the platform's automatic compaction and can never rewrite their own history.
- **Seqs are identities, not numbers**: after a replace the surface's seqs are non-monotonic and the map header says so; commit re-validates every boundary, and `start` / `end` also accept the `first` / `latest` sentinels.
- **Multi-segment clearing**: disjoint ranges take one `clear_mind` call each — every segment is validated and checkpointed independently.
- **Self-collapse**: committed `clear_mind` and consumed `mind_map` call/result pairs fold into a one-line tombstone at the next step boundary (compaction/prune + user/message replace, the shadow-price protocol) — no dead weight left behind.
- **Shadow-price protocol**: every replace is immediately followed by a `compaction/summary` carrying the exact shadowedRange/shadowedSeqs/shadowedTokenCount, isomorphic to the platform compaction engine and safe for token-meter replay.
- **Guardrails against degenerate calls**: tiny clears below `minClearTokens` and notes that are too short or too long are rejected with an actionable error.
- **The human-side log is untouched**: the append-only log is the single source of truth; clears are expressed through platform transaction vocabulary, the GUI keeps the original text, and everything stays auditable and revertible (dsh-rewind).

## Configuration (optional)

```yaml
- id: clear-mind
  name: dsh-clear-mind
  config:
    minClearTokens: 1000        # minimum clearable size (heuristic tokens), blocks trivial clears
    minNotesChars: 200          # checkpoint notes minimum length
    maxNotesChars: 16000        # checkpoint notes maximum length
    selfCollapse: true          # auto-fold clear_mind / mind_map call+result pairs
    reminderEnabled: true       # proactive reminder toggle
    reminderThresholdRatio: 0.70   # context-to-window ratio threshold (0.01~1)
    reminderThresholdTokens: 0     # absolute token threshold (0 = ratio only)
    reminderThresholdSteps: 100    # steps per turn threshold
    reminderStepInterval: 25       # minimum step gap between reminders in one turn
```

The web frontend exposes every knob on its settings page (namespace `clear-mind`); saving hot-applies without a restart. On headless profiles without a settings service the plugin degrades gracefully to config-file-only. A reminder also requires the token count to have grown since the last one — a steady conversation is never nagged twice.

## Install

```bash
dsh plugin --profile web add dsh-clear-mind
```

No manual configuration needed after install — the bundled `cordis.patch.yml` mounts automatically, and the model gets both tools after restarting dsh; every option has a sensible default.

Install straight from GitHub (source install; pnpm ≥10 requires allowing the build script):

```bash
dsh plugin --profile web add github:john-walks-slow/dsh-clear-mind
# The first add is blocked by pnpm: add the package name pnpm prints to
# allowBuilds in ~/.dsh/profiles/web/pnpm-workspace.yaml, then re-run
```

## Permissions & compatibility

- **Zero network, zero external services**: makes no network requests and performs no filesystem writes; it only rewrites the session surface through the platform's compaction transaction vocabulary
- **Dependencies**: `@deepseek-ai/cordis` 4.0.2 / `@deepseek-ai/dsh-session` · `dsh-llm` · `dsh-compaction` · `dsh-tools` 0.1.2-rc.1 (aligned with dsh 0.1.2-rc.1 locked versions), Node ≥ 22.5
- **Platform requirements**: binds the platform `ctx.tokenMeter` (MeterPort); tool registration relies on `ctx.agents.roots()`; the settings page is an optional enhancement (degrades automatically without a settings service)
- **Subagents unaffected**: subagents keep the platform's automatic compaction — zero behavior change
- **Coexists with auto-compaction**: the plugin offers a semantically controlled manual exit before the platform's autocompact kicks in; the two do not conflict

## Local development

```bash
npm install
npm run check   # tsc --noEmit (src+test)
npm run build   # outputs dist/src/ + lib/client.js (web settings page)
npm test        # tsc(incl. test) + node --test dist/test/*.test.js, 47 cases
```

Unit tests run against a heuristic meter copy and real Session construction (including full-log shadow-price assertions); at runtime the platform `ctx.tokenMeter` is bound.

- Platform contracts and development discipline: see `AGENTS.md`; research/plan/review docs: see `docs/features/`
