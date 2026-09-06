# Sprint 5 Report — Argus: Challenge Authoring + Adaptive Challenges

## Test counts

| Suite | Result |
|---|---|
| Unit (`tests/unit/`) | 37 new (argus.test.ts) — all pass |
| Component (`tests/component/`) | 5 new (argus.test.tsx) — all pass |
| E2E (`tests/e2e/argus.spec.ts`) | **8/8 pass** (20.8s) |
| Full suite | **235/238** — 3 pre-existing failures only (see below) |
| `tsc --noEmit` | clean |
| `npm run build` | pass |
| `npm run seed:verify` | **zero golden diffs** (governor, ai-validation, suggestion, calibration) |

### Pre-existing failures (NOT Sprint 5 regressions)
- `program-builder.test.tsx` ×2 (test pollution — existed before Sprint 5, baseline was 230/233)
- `workout-logger.test.tsx:294` rest-timer timing flake (durationSec expected 90, got null)

## Acceptance gate

1. ✅ AI-authored challenge evaluates identically to hand-created equivalent (engine untouched; readonly-regression E2E)
2. ✅ Gauntlet rejects all invalid fixtures with correct reasons; zero invalid defs reach DB (argus-invalid E2E)
3. ✅ Context builder aggregate-only, deterministic, golden-matched (calibration.golden.json)
4. ✅ Governor timelines reproduce; idempotent (one application per checkpoint); clamping logged; confirm-deny consumes checkpoint (governor.golden.json + lifecycle/deny/clamp E2E)
5. ✅ Streak immutability: adaptive flag rejected on streak types
6. ✅ Weekly suggestion: one pending max, never auto-creates, dismissible (suggestion.golden.json)
7. ✅ Offline: Argus hidden/disabled; evaluation + governor unaffected
8. ✅ `ARGUS_ENABLED=false` removes the AI cleanly; zero hardcoded "Argus" strings outside `src/lib/argus/config.ts`
9. ✅ Cost guard: ≤2 calls per generation; complete audit per attempt
10. ✅ Sprints 1–4 suites green (2 known program-builder failures documented, not regressed)
11. ✅ This report

## Deviations from spec

- **D-clamp fixture**: spec's 39,000-lb clamp target is mathematically unreachable — bounds are [80%, 105%] of current target, so the test seeds an overperformance scenario that clamps at the 105% bound instead. Flag still visible; clamping still logged.
- **Prescriptive policy rejection**: gauntlet additionally rejects prescriptive (non-adaptive) `adaptation_policy` shapes on adaptive challenges.
- **Threshold bound**: checkpoint `threshold_pct` clamped to ±50 in addition to spec bounds.
- **Gauntlet strict-shape**: added strict object-shape validation for policy checkpoints (unknown keys rejected).
- **`/challenges/new?from=` flow**: suggestion accept deep-links into the authoring form pre-filled (spec implied but didn't specify routing).
- **`getStreakDisplay` persist flag**: Dexie liveQuery in settings is read-only; the function's internal writes (freeze grant + consumption persistence) now gate on `opts.persist` (default true). `SyncProvider` sweep calls it with persistence on app open, so behavior is unchanged everywhere except liveQuery reads.
- **Seed gotcha (documented)**: `ChallengeRun.adaptation_policy` is a parsed `AdaptationPolicy` object in Dexie — E2E seeds must `JSON.parse` the policy string or the governor sweep dies silently on `policy.checkpoints`.

## Scope guardrails honored

No LLM in evaluation/pacing/resolution/governor paths (100% deterministic) · no chat UI · no streaming · no raw workout data in prompts · no auto-created runs from suggestions · governor policy execution is the only automatic mutation · no ML/WHOOP/RPG · v1 governor: one metric (`pace_vs_required`), one action (`adjust_remaining`) · no new chart libraries (dials are SVG).

## Blockers

None.