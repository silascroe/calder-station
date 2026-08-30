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

## Next revision

`sal-physical-conflict-v6-2026-08-30` adds deterministic walking and service time, queues every due commitment after the selected priority, and calls a model only after a bounded permutation solver proves that no ordering can meet every deadline. Each matrix promise is individually reachable; the sacrifice is now a property of the simulated clock and map rather than of an artificial one-action evaluator. Genuine results are pending isolated staging deployment.
