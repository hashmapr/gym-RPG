# Sprint 6 Report — WHOOP + Recovery Gates

## Test counts

| Suite | Result |
|---|---|
| Unit (`tests/unit/recovery.test.ts`) | 23 new — all pass |
| Component (`tests/component/recovery.test.tsx`) | 14 new — all pass |
| E2E (`tests/e2e/recovery.spec.ts`) | **7/7 pass** (15.8s) |
| Full suite | **272/275** — 3 pre-existing failures only (see below) |
| `tsc --noEmit` | clean |
| `npm run build` | pass |
| `npm run seed:verify` | **zero golden diffs** (analytics, challenge, Argus, + new recovery sections) |

### Pre-existing failures (NOT Sprint 6 regressions)
- `program-builder.test.tsx` ×2 (test pollution — existed before Sprint 5, baseline was 235/238)
- `workout-logger.test.tsx:294` rest-timer timing flake

## Acceptance gate

1. ✅ **Gate engine deterministic + golden-matched** — 16-case matrix in `gate.golden.json`: thresholds 33/34/66/67 boundaries, `no_data`, manual source on/off, stale 37h vs 35h, deload-first, HRV override (+ baseline-7 + flat-baseline guards), sleep-stack RPE −2, RED no-stack.
2. ✅ **One-time-apply idempotence** — `daily_gate_logs.applied_at` tracks treatment; YELLOW enforce auto-applies exactly once (E2E: weights 200→180/100→90, reload never re-mutates); `markGateApplied` idempotent; suggest_only never auto-applies (Apply button gates it).
3. ✅ **Source rule** — `whoop` always gates; `manual` gates iff `manual_gate_enabled`; no row → no gate; WHOOP wins same date (component test: check-in 90 does not overwrite WHOOP 55).
4. ✅ **Sleep guard** — <5.5h stacks with YELLOW only (rpe_delta −2); RED does not stack.
5. ✅ **HRV override** — GREEN + z ≤ −2 → YELLOW; requires ≥7 baseline days (prior 30d non-null, Bessel-corrected); flat baseline → no z → no override.
6. ✅ **WHOOP mock + client** — deterministic mock (7 API routes), PKCE connect round-trip (E2E), 91-day backfill, 429 → retry, cache 1/day (`prompt_version` receipt), tokens server-side only (source-scan test: no token JSON in client-reachable responses).
7. ✅ **Argus Daily Briefing** — cache-first (`ai_briefings`), narrate-only prompt contract, `briefing-v1` receipt rendered on home (E2E).
8. ✅ **Lab recovery analytics** — Pearson correlations with n≥10 visibility gate; insufficient-data note; scatters render (component + golden `recovery-correlation.golden.json`).
9. ✅ **Readonly regression** — E2E asserts zero deltas on exercises/workout_sessions/workout_sets/goals/programs/program_runs; only `planned_sets` (today), `daily_gate_logs`, `daily_metrics` written.
10. ✅ **`ARGUS_ENABLED=false`** — briefing card removed cleanly (component test via `vi.resetModules` + `stubEnv`); gate engine unaffected.
11. ✅ **Settings** — WHOOP connect/disconnect, gate mode (enforce/suggest_only), manual-gate toggle, manual check-in all persist (component + E2E).
12. ✅ This report.

## Deviations / implementation notes

- **E2E seeds its own gate session**: the deterministic program fixture has no planned session on SEED_TODAY (2026-09-05 is a rest day), so the recovery E2E posts a planned session + 4 planned sets + today's metric through the mock-sync API before first page open.
- **E2E pull-completion signal**: the one-time E2E hydration (`maybePullE2ESeed`) set its localStorage flag *before* the fetch, so tests couldn't tell when rows actually landed (and the flag is consumed after the first pull, so rows posted after `seedProgram` need the same pull). Added `lab.e2eSeedPulled` (set after bulkPut completes) — inert outside E2E.
- **Sync nudge in tests**: the push engine's periodic retry is 15s; tests dispatch a synthetic `online` event (an existing SyncProvider hook → `runSyncNow`) instead of sleeping, keeping the suite fast and deterministic.
- **Injectable clock**: `getGateForToday` accepts `now` so unit tests can pin noon on SEED_TODAY (the real test clock is a day later, which would make every fixture metric stale).
- **Briefing-input golden**: `days_since_last_session` is `null` by design — the last fixture session starts 18:00 on SEED_TODAY while the golden clock is noon, so "days since" is negative → null.
- **5-lb rounding**: YELLOW weight scale rounds DOWN to the 5-lb grid (`Math.floor(x/5)*5`) — 225→200, 220→195 (unit-tested).

## Files

- **New (18)**: `src/lib/recovery/` (gate engine + service), `src/lib/whoop.ts`, `src/lib/server/whoop-mock.ts`, `src/app/api/whoop/*` (7 routes), `src/app/api/lab/recovery/`, `src/components/RecoveryGate.tsx`, `src/components/RecoveryHome.tsx`, `src/lib/argus/briefing.ts`, `src/lib/analytics/recovery.ts`, `src/lib/seed/recovery-fixture.ts`, `scripts/goldens-recovery.ts`, `supabase/migrations/0006_recovery.sql`, 3 goldens, 3 test suites.
- **Modified (11)**: types/db (v6 + `daily_metrics`, `daily_gate_logs`, `ai_briefings`), sync engine (table order), settings defaults, home/workout/lab/settings pages, `package.json` (`seed:goldens-recovery`), `scripts/verify-seed.ts` (section 5), `src/lib/e2e-seed.ts` (pull signal).
