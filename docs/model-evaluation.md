# Model evaluation evidence

This file records deliberate paid evaluations. Normal tests and deterministic scenarios never call a provider.

## `sal-competing-choice-v4-2026-08-30`

The corrected persistent staging Worker completed the fixed 24-case matrix on 2026-08-30 using `deepseek-v4-flash`. Every case passed through the production planner adapter, strict JSON validator, action queue, deterministic executor, and obligation consequences.

| Measure | Result |
| --- | ---: |
| Real provider calls | 24 |
| Valid model plans | 24 |
| Fallbacks | 0 |
| Prompt tokens | 22,038 |
| Completion tokens | 1,120 |
| Estimated spend | $0.004197 |
| Fulfill choices | 24 |
| Delay choices | 0 |
| Immediately fulfilled outcomes | 21 |
| Still-open outcomes after the five-minute case window | 3 |

The provider integration is operational and cheap at this scale, but the experiment failed its product test. DeepSeek selected `fulfill` for every baseline, competing-route, tired, hungry, low-trust, high-trust, near-deadline, and distant-deadline case. In the three hungry cases, deterministic need enforcement interrupted the selected delivery, so the obligation remained open despite the model's confident note.

The result is useful evidence rather than success: the offered problem did not expose enough concrete cost or downstream difference for model judgment to matter. A single open commitment should therefore remain scripted. Further paid evaluation should focus on mutually exclusive commitments, describe the deterministic consequences and next planning opportunity accurately, and compare a genuine multi-day model-assisted run with the scripted baseline.

The complete per-case report, including request IDs and cache-token splits, is retained in GitHub Actions run `33329054907`.

## `sal-consequential-conflict-v5-2026-08-30`

The revised matrix removed single-commitment and hard-need calls. All 24 cases offered two commitments, explicit deterministic relationship/tension deltas, and civic consequences, then advanced far enough to observe both outcomes.

| Measure | Result |
| --- | ---: |
| Real provider calls | 24 |
| Valid model plans | 24 |
| Fallbacks | 0 |
| Prompt tokens | 34,977 |
| Completion tokens | 1,108 |
| Estimated spend | $0.007363 |
| Notice selected | 15 |
| Route report selected | 9 |
| Selected commitment fulfilled | 24 |
| Exposed commitment broken | 24 |

The choices varied, but only with deadline order: DeepSeek selected the earlier deadline in all 24 cases. Reversing relationship strength from 24/88 to 88/24 or adding 30 tension did not overcome a four-hour deadline advantage. Several notes also claimed the second promise could be handled later that morning. Under the current instant-travel world and multi-action queue, that assumption is often reasonable; the evaluator created the broken promise by permitting only one obligation action.

This is a world-model defect, not a prompt-tuning problem. Before another paid revision, deterministic code should model bounded travel/service time, queue every feasible commitment, and prove that no ordering can meet all deadlines. The model should choose priority only for a conflict the executor has established as physically impossible.

The complete v5 report is retained in GitHub Actions run `33329611618`.

## `sal-physical-conflict-v6-2026-08-30`

This revision added deterministic walking and service time, queued every due commitment after the selected priority, and called the model only after a bounded permutation solver proved that no ordering could meet every deadline. Each matrix promise was individually reachable.

| Measure | Result |
| --- | ---: |
| Real provider calls | 24 |
| Valid model plans | 24 |
| Fallbacks | 0 |
| Prompt tokens | 44,913 |
| Completion tokens | 985 |
| Estimated spend | $0.006741 |
| Route report selected | 21 |
| Notice selected | 3 |

DeepSeek chose the civic route in every equal-deadline case, including large trust and tension reversals, and chose Jamie's notice only when it had the earlier hard deadline. The notes correctly named the accepted lateness instead of imagining a second same-morning delivery. This shows a stable preference for preserving the downstream civic chain over the recurring private notice; relationship scalars did not materially influence the choice.

The complete v6 report is retained in GitHub Actions run `33330261982`.

## `sal-season-comparison-v7-2026-08-30`

The cron started this combined matrix-and-season revision at 2026-08-30 19:30:53 UTC and durably wrote `running`, but the invocation ended without a terminal report. GitHub Actions timed out after twenty minutes. The exact provider-call count and token use are therefore unknown and must not be invented from a missing report. The lease correctly prevented an automatic paid retry.

The failure exposed an evaluation-boundary mistake: a repeated 24-call matrix and two full 90-day histories should not share one scheduled invocation. The matrix had already answered its question in v6. Rebuying it added cost and invocation pressure without new evidence.

## `sal-resumable-season-v8-2026-08-31`

This revision removed the already-answered matrix from scheduled staging work and separated the scripted baseline from the one-call assisted season. It was deployed successfully with a real staging Durable Object and the configured DeepSeek secret, but the 90-day baseline never reached its checkpoint. The report remained `baseline-running` through repeated quarter-hour observations (the first lease began at 01:00 UTC and a later stale-lease retry began at 01:30 UTC), so the model phase was never reached and there is no provider usage to report for v8. The failure is consistent with the scheduled Worker's default CPU boundary being too small for this replay, even though the same run is only a few seconds locally.

The important result is operational: a phase marker alone was not enough. The runner needed a durable simulation snapshot, not merely a durable status string.

## `sal-resumable-season-v9-2026-08-31`

This revision implemented resumable seven-day snapshots, but its deployment was rejected before upload because the Cloudflare account is on the Free plan and the configuration requested the paid-only five-minute Worker CPU limit. It produced no deployed state and no provider calls.

## `sal-resumable-season-v10-2026-08-31`

V10 keeps the same experiment but moves each baseline or assisted seven-day step into the staging Durable Object. The Worker cron handler makes bounded internal requests and does not carry the full run snapshot. The configuration no longer requests a paid-only CPU limit. The free phase may retry or resume; an assisted phase resumes only with a persisted snapshot, and otherwise remains terminal so an unknown provider response is never silently repurchased.

The V10 staging deployment succeeded in GitHub Actions run `33350152721`. The persistent staging smoke test passed, and the scheduled season completed at 02:45 UTC on 2026-08-31. The single real `deepseek-v4-flash` call was valid, used 1,967 prompt tokens and 44 completion tokens, had no fallback, and cost an estimated `$0.00092356` using the cache-aware pricing calculation. DeepSeek selected the civic route report and explicitly accepted the late Jamie notice. The assisted season matched the scripted baseline at Days 1, 7, 30, and 90: 7,286 events, 113 fulfilled and 7 broken obligations, and zero relationship or event-count deltas. The model was therefore operational and legible, but it did not yet add a consequence that a competent deterministic rule could not have produced; model participation should not broaden on this evidence alone.

The evaluation Durable Object now records each assisted provider decision in a revision-scoped storage ledger. The ledger is written as `pending` before the request and `complete` with the validated plan afterward. If a chunk snapshot fails after DeepSeek answers, a replay can reuse the completed plan; if the request outcome is unknown, the replay uses the deterministic fallback and records a cost skip. A missing assisted snapshot is terminalized by the scheduler rather than retried blindly. This is deliberately separate from the live town's per-planning-instant decision ledger and is cleared with the evaluation snapshot.

## `sal-resumable-season-v11-2026-09-01`

V11 changed only the evaluation revision so the recovery-aware path would execute against a fresh staging run. GitHub Actions run `33460394401` deployed the Worker and passed the persistent staging smoke test before the evaluator completed at 02:15 UTC on 2026-09-01. The live assisted phase made one real `deepseek-v4-flash` request: the response was valid, with zero fallbacks and zero cost skips, 1,967 prompt tokens (1,920 cache-hit and 47 cache-miss), 45 completion tokens, and an estimated `$0.00010696` spend at the observed peak-window time. The model again selected Amos's urgent route report and explicitly accepted Jamie's late notice.

The assisted season matched the scripted baseline at Days 1, 7, 30, and 90: both ended with 7,286 events, 113 fulfilled and 7 broken obligations, and the same relationship snapshots. All reported divergence fields were zero. This is useful operational evidence that the ledger-enabled path works in the real Durable Object, not evidence that broader model participation is valuable; the model still made no downstream difference that a competent deterministic rule could not have made. The failure-injection and outcome-unknown recovery behaviors remain covered by local tests because deliberately crashing the live paid evaluator would only destroy useful staging state.

## `sal-reflection-slice-v1-2026-09-01`

This is an opt-in staging slice for the next experiment, not a production
feature. `src/reflections.js` adds a configurable simulated-day cadence and one
bounded higher-order field, `{focusTargetId, note}`. A focus can only name a
recorded relationship; deterministic planning turns it into at most one visit
inside the existing action queue, and ordinary co-location and availability
rules decide whether a conversation occurs. Provider failure records a
null-focus fallback and does not stop the town.

`src/reflection-evaluation.js` runs a tiny, two-resident baseline/assisted A/B
fixture through the same authoritative engine. The local default adapter is
deterministic and free. The staging deployment workflow now runs one explicit
30-day evaluation with `createDeepSeekReflection`, bypassing peak pricing only
for this deliberate experiment, and uploads its JSON report as the
`reflection-evaluation` artifact. It records validity, cache-aware cost,
fallbacks, and focal relationship/event deltas. Production remains untouched;
the reflection policy is still disabled in the live Worker.
