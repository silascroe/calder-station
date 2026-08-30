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

## Next revision

`sal-consequential-conflict-v5-2026-08-30` removes paid calls for single commitments and hard-need cases. Its 24 cases all contain two commitments that will expire before the next planning turn. The prompt states concrete relationship deltas, current tension, deadlines, exposed work, and civic-chain effects; the scenario then runs long enough to observe one fulfillment and one broken commitment. Genuine results are pending the isolated staging deployment.
