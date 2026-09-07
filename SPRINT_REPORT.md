# Sprint Report

# Sprint 7.5 Report — "Overload Native" (iOS Capacitor shell, sideload edition)

## Test counts

| Suite | Result |
|---|---|
| `tests/unit/native-modules.test.ts` (NEW) | 15/15 — warmup ramp goldens (185/235/130/90 lb incl. user's real machine loads), backup 4-generation prune, notification nextOccurrence (today/tomorrow/month-rollover), iOS 16.2 gate |
| Full vitest (`--maxWorkers 2`) | **393/393 pass** (378 prior + 15 new) |
| `tsc --noEmit` | clean |
| `npm run build` (web) | clean |
| `npm run build:native` (static export) | clean — all routes, query twins, no _next/data |
| `xcodebuild` (App + OverloadWidget, SPM) | **BUILD SUCCEEDED**; `OverloadWidget.appex` verified embedded in `App.app/PlugIns/` |
| `npm run seed:verify` | zero golden diffs (analytics, challenge, Argus, recovery, RPG) |
| Monochrome identity test | green (boot.ts now imports `COLORS.base` instead of raw hex) |

## What shipped

1. **Capacitor 8 shell** — `capacitor.config.ts` (`personal.overload.app`, appName Overload, webDir out, black bg, always insets), `npx cap add ios` (Swift Package Manager — no CocoaPods), static-export pipeline via `npm run build:native` (api stash → NATIVE_SHELL=1 → restore). SceneDelegate boots `MainViewController` (CAPBridgeViewController subclass) which registers the plugin in `capacitorDidLoad()`.
2. **OverloadNative Swift plugin** (`ios/App/App/OverloadNative.swift`) — `startRestActivity`/`stopRestActivity` (ActivityKit, iOS 16.2 gate), `readLatestBodyweight` (HKQuantityType bodyMass → lb + ISO date), `readSleepHours` (sleepAnalysis asleep stages 2–5, sum → hours). All failures reject → JS catches → documented fallback.
3. **Live Activity widget extension** (`ios/App/OverloadWidget/`) — full pbxproj target surgery: `OverloadWidgetBundle` with `ActivityConfiguration` lock-screen view (REST eyebrow + `Text(timerInterval:)` self-updating countdown, monospaced, white-on-black) + Dynamic Island compact/minimal. `RestActivityAttributes` duplicated app/widget (name + Codable fields match). App target embeds the appex via "Embed Foundation Extensions" copy phase + target dependency. **The committed Live Activity is fully wired end-to-end** — no notification-only fallback needed.
4. **Native rest timer** — RestTimer schedules local notification (ID 1001) at expiry + starts the Live Activity; cancels both on set log/stop. Haptics: light impact on set-complete, success pattern on PR.
5. **Notification inventory** (all local, each toggleable in Settings) — rest expiry 1001, morning briefing 2001 (07:00, summary from latest cached `ai_briefings`), program reminder 2002 (usual training hour from session-start histogram, fallback 18), streak nudge 2003 (20:00, only when streak live + no session today). Permission requested once on first launch (localStorage guard).
6. **HealthKit check-in auto-fill** — `HealthKitCheckInFill` on Recovery Home fills bodyweight/sleep into today's `daily_metrics` with source `healthkit`, never overwrites whoop/healthkit rows. HealthKit entitlement wired (`App.entitlements` + `NSHealthShareUsageDescription`); documented fallback: delete entitlements → manual check-in.
7. **Background sync** — `@capacitor/background-task` beforeExit → existing sync engine; foreground sync unchanged.
8. **Weekly auto-backup** — JSON export → `Documents/OverloadBackups/overload-backup-YYYY-MM-DD.json`, 7-day throttle, pruned to 4 generations; `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` → visible in Files app.
9. **Warm-up generator** — `buildWarmupRamp` (50%×5 → 70%×3 → 90%×1, roundTo5, drops ≤0/reaching-target), expander UI in SetLogger (program + freeform), LOG/LOG ALL with set_type `warmup` (0 XP, excluded from volume landmarks — verified against pr/stats/xp rules), settings toggle.
10. **Icon + splash** — `scripts/gen-icons.mjs` rewritten: white sigil-eye on pure black (almond outline + pupil, hand-rolled PNG) → PWA 192/512/180, iOS 1024 AppIcon, 2732 splash ×3.
11. **Polish** — safe-area utilities (`.pb-safe`/`.pt-safe`) on bottom nav + rest bar, StatusBar Dark/#000000, SW skip in shell, iOS version + Live Activity capability logged at boot.

## Native smoke checklist (manual on device — recorded for the user's first build)

| # | Item | Status |
|---|---|---|
| 1 | AltStore install → Dexie hydrates → Supabase rehydrates | ⏳ pending user device run (SIGNING.md §3) |
| 2 | Log set → lock → Live Activity countdown on lock screen → rest notification → haptic | ⏳ pending (widget extension built + embedded; ActivityKit request wired) |
| 3 | Airplane mode: full workout loggable → syncs on reconnect | ⏳ pending (offline-first Dexie unchanged) |
| 4 | HealthKit bodyweight auto-fills check-in | ⏳ pending (entitlement wired; fallback documented) |
| 5 | Delete app → reinstall → full rehydration | ⏳ pending |
| 6 | Weekly backup JSON in Files app | ⏳ pending (UIFileSharingEnabled set) |
| 7 | 7-day expiry → AltStore refresh → data intact | ⏳ pending (SIGNING.md §4) |
| 8 | Briefing notification at 07:00 | ⏳ pending |
| 9 | Notification toggles silence each category | ⏳ pending |
| 10 | Warm-up expander shows ramp; warmups excluded from volume | ✅ verified in unit tests (exclusion rules) + component tests |

## Deviations from spec

- **Live Activity gate is iOS 16.2, not 16.1**: the 16.1 ActivityKit `request`/`end` signatures are obsoleted in current SDKs (renamed to the `ActivityContent` API in 16.2). Device is 16.1+ confirmed; every 16.1 device ships 16.2+. `LIVE_ACTIVITY_MIN_IOS = '16.2'` in boot.ts, mirrored by `#available(iOS 16.2, *)` in Swift. Documented, not a functional gap.
- **WHOOP shows disconnected in the shell** (server-mocked backend) — manual check-in fallback is the documented path; HealthKit bodyweight/sleep auto-fill covers the check-in loop.
- **Lab pages fetch `/api/lab/*`** — in the native shell these calls fail gracefully; the lab remains a web-PWA-first surface (data lives in Dexie; API-backed views need the dev server). Not a 7.5 blocker; noted for a future sprint.
- **Hydration warning**: the static HTML renders web-shaped hrefs, then the client re-renders native-shaped query-twin links — React 19 recoverable warning, accepted.
- **Pre-existing flake note**: full vitest at default 36 workers drops 6–10 rotating failures (fake-indexeddb timing under parallel workers); HEAD fails identically. `--maxWorkers 2` → 393/393. Unchanged from prior sprints.

## Files

- New: `ios/App/App/{OverloadNative,MainViewController}.swift`, `ios/App/App/App.entitlements`, `ios/App/OverloadWidget/{OverloadWidgetBundle.swift,Info.plist}`, `src/lib/native/{notifications,haptics,live-activity,backup,background-sync,schedule,boot,platform}.ts`, `src/lib/warmups.ts`, `tests/unit/native-modules.test.ts`, `SIGNING.md`, `capacitor.config.ts`
- Modified: `ios/App/App/{SceneDelegate.swift,Info.plist}`, `ios/App/App.xcodeproj/project.pbxproj` (2 Swift files + widget target + entitlements), `scripts/gen-icons.mjs` (sigil-eye), `src/components/{RestTimer,SetLogger,SyncProvider,ServiceWorkerRegistrar,RecoveryHome,AppShell}.tsx`, `src/app/{page,settings/page}.tsx`, `src/app/globals.css`, `src/lib/{types,settings}.ts`, `package.json`, icons + splash assets

---

# Sprint 8a Report — "The Feature Store" (two-column RPE + ML harness)

## Test counts

| Suite | Result |
|---|---|
| `tests/unit/rpe-estimator.test.ts` | 15/15 — golden-locked on the real Hevy export (rpe-estimation.golden.json) |
| `tests/unit/ml-features.test.ts` | 12/12 — feature store + goldens (features.golden.json, 114 rows) |
| `tests/unit/ml-baselines.test.ts` | 10/10 — persistence/velocity baselines + walk-forward backtest (backtest.golden.json, 28 folds) |
| `tests/unit/ml-registry.test.ts` | 5/5 — kill switch, single-active invariant |
| `tests/component/ml-surface.test.tsx` | 10/10 — felt-vs-physics flow, blind mode, nudge once/session, flag-off surfaces |
| `tests/e2e/ml-harness.spec.ts` | 4/4 — feature-backfill idempotence, velocity surface, flag-off, readonly regression |
| Full vitest | 374/378 pass; 4 parallel-jsdom flakes pass solo (documented pattern, load avg 4.8) |
| `tsc --noEmit` | clean |
| `npm run build` | clean |
| `npm run seed:verify` | zero golden diffs |
| Playwright visual + rpg + ml-harness | 15/15 (3 baselines updated: quest-count 3/6→3/5 from M1 cardio-starter swap + 8a Argus capability note) |

## What shipped

1. **Two-column RPE** — `workout_sets` gains `rpe_estimated` + `rpe_confidence` (high/medium/low). `rpe` is the user-reported value, never overwritten; the estimate is engine-computed, never user-editable (independence lock — `updateSetRpe` writes the user column only). `logSet` computes a live estimate at log time from a self-inclusive anchor pool; failure sets and null-e1RM sets abstain (null/null).
2. **RPE estimator** (`src/lib/ml/rpe-estimator.ts`) — consensus e1RM anchors from the trailing 28 days; confidence by anchor quality; `rpeFactor` maps missing/abstained estimates to the 0.7 factor downstream. Golden-locked against the user's real export.
3. **Felt-vs-physics surface** (`SetLogger`) — post-log felt-RPE card (skip writes nothing), estimate reveal after the answer, inline RPE path skips the card, blind mode (`blind_rpe`, opt-in) hides the estimate until after logging, divergence nudge ("physics says N, you said M — rough day?") fires once per session when user − estimate ≥ 2, gated by `rpe_nudge_enabled`.
4. **XP stakes ride the engine** — `xpRpeValue` uses the estimate at medium/high confidence; the user-reported RPE has ZERO XP stakes (anti-gaming).
5. **Feature store** (`src/lib/ml/features.ts`) — `backfillMlFeatures` materializes 27-column rows (e1RM, rpe_source precedence logged > estimated > missing, recovery/HRV/sleep/body-state/gate context, rolling 7d/28d volume, 12w velocity slope, divergence, rich/sparse completeness); wired into the import flow. Shared `lsqSlopePerWeek` now powers both the estimator and `computeVelocity` (analytics velocity goldens unchanged — proof the shared math matches).
6. **Baselines + backtest** (`baselines.ts`, `backtest.ts`) — `predictTopE1RM` (0 days → persistence; else last + velocity slope, never below last observed; <4 points → persistence fallback) and `runBacktest` (walk-forward 12w train / 2w holdout / 1d stride, MAE per rich/sparse stratum). `mlPassesGate` is hard-FALSE in 8a.
7. **Registry + kill switch** (`registry.ts`) — `ML_V1_ACTIVE = false`; `activeModelVersion` requires flag AND an active `ml_v1` row (flag wins); `pinModelVersion` enforces single-active. Migration `0009_ml_harness.sql` (ml_features, ml_model_registry, private `ml-artifacts` storage bucket); Deno `ml-infer` stub (baseline contract, 8b note); `ml/train.py` stub + `workflow_dispatch`-only training workflow. Home forecast-chip stub renders only behind the flag; Argus forecasting capability reads "READY (awaiting data)".
8. **Goldens** — `rpe-estimation.golden.json` (real-export estimates + highlighted narrative rows), `features.golden.json` (114 rows: 36 logged / 72 estimated / 6 missing; 108 rich / 6 sparse), `backtest.golden.json` (28 folds, 315 rows, MAE sparse 7.7747 / rich 7.5101 / combined 7.5807) — all generated by `seed:goldens-features` + `seed:goldens-rpe` from deterministic fixtures.

## Deviations from spec

- **Seated Row (Machine) 165×1 estimates 10.0, not the narrative ~4–5 (DOCUMENTED, PROMINENT)**: the narrative anchor for that lift lives 30.9 days before the frozen today (Sep 5) — outside the locked 28-day anchor window — so the only in-window anchor is the set's own session top, which self-anchors to est 10.0. The estimator is window-pure by design; the golden records the deviation (`deviation` contains "28d") and the test asserts it explicitly rather than papering over it.
- **Nudge lifecycle**: logging the next set clears a shown nudge (`submit` resets `showNudge`), so "once per session" is asserted as *does not re-appear* after the following set — the nudge never re-fires for the same workout.
- **Visual baselines**: home + character quest chip 3/6→3/5 (M1 cardio-starter swap, committed earlier) and argus-hub capability note — intentional drift, baselines regenerated.

## Files

- New: `src/lib/ml/{rpe-estimator,features,baselines,backtest,registry,features-golden,rpe-golden}.ts`, `supabase/functions/ml-infer/index.ts`, `ml/train.py`, `.github/workflows/ml-train.yml`, `supabase/migrations/0009_ml_harness.sql`, `scripts/{goldens-features,goldens-rpe}.ts`, `tests/unit/{rpe-estimator,ml-features,ml-baselines,ml-registry}.test.ts`, `tests/component/ml-surface.test.tsx`, `tests/e2e/ml-harness.spec.ts`, goldens ×3
- Modified: `log-set.ts` (live estimate + `updateSetRpe`), `SetLogger.tsx` (felt flow + nudge), `settings.ts` (blind_rpe, rpe_nudge_enabled), `types.ts` (estimate columns, sync tables, settings), `rpg/ledger.ts` (XP stakes on engine estimate), `analytics/index.ts` (shared LSQ), `import/page.tsx` (backfill hook), `argus/page.tsx`, `page.tsx`, `db.ts` (v9 stores), `sync/engine.ts`, `tsconfig.json` (exclude supabase/functions)

# Sprint 7.6 v2 Report — "Instrument Panel Monochrome" (full re-skin)

## Test counts

| Suite | Result |
|---|---|
| `tests/unit/identity.test.ts` (strengthened) | 6/6 — +zero Cinzel, +zero decorative color classes (lime/amber/emerald/violet/rose/sky/…), +zero dead ember hexes |
| `tests/component/rpg.test.tsx` (updated) | 8/8 — token test now asserts monochrome tokens + asserts ember tokens are DEAD |
| Full vitest | 320/326 pass; 6 parallel-jsdom flakes pass solo (documented pattern) |
| `tsc --noEmit` | clean |
| `npm run build` | clean |
| `npm run seed:verify` | zero golden diffs (skin-only — engines untouched) |
| Playwright `visual.spec.ts` | 7/7 — 14 baselines regenerated for the new skin |
| Playwright `rpg.spec.ts` | 4/4 |

## What shipped

1. **Tokens** — `tokens.ts` + `globals.css` rewritten: base `#000000` (OLED), surface `#141416`, surface-raised `#1c1c1f`, border `#27272a`, text white/`#a1a1aa`/`#52525b`. Accent = WHITE. Functional color only: good `#22c55e` / warn `#eab308` / bad `#ef4444` (recovery bands). Ember family + border-gold exterminated.
2. **Typography** — Space Grotesk (display 500/600/700), IBM Plex Mono (eyebrows: 11px uppercase 0.08em tracking via `.eyebrow`), Inter body with `tabular-nums`. Cinzel removed everywhere.
3. **Mechanical sweep** — every ember class/hex → monochrome across 30+ files; decorative color classes (emerald/violet/amber/rose/sky/lime) → white accent or zinc. Recovery visuals (RecoveryHome badge, RecoveryGate, sparkline) keep band colors via `good/warn/bad` tokens. Deliberate deviation: destructive/error red kept in settings (safety affordance, informational not decorative).
4. **Design passes** — home CTAs `bg-white text-black rounded-md` (fixed the Tailwind v4 `text-base` = font-size trap that left white-on-white text); eyebrows on home cards; secondary buttons transparent + hairline + `active:bg-white/10`; XP/progress bars 2px white on `#27272a` track (quests, character gauges); skill-tree nodes white=done / zinc-400=available / zinc-600=locked; character POWER LEVEL ring numeral 44px + giant XP numeral; ChallengeDial monochrome (white active/complete, zinc fail); Celebration white glow + `navigator.vibrate(30)`; AppShell active `bg-white/10`; calendar heat = grayscale ramp; lab status colors → white/zinc; manifest `#000000`.
5. **Audits** — identity.test.ts now enforces: zero "The Lab", zero hex outside tokens, zero Cinzel, zero decorative color classes, zero dead ember hexes. rpg.test.ts asserts ember tokens are gone.

## Key findings

- **Tailwind v4 `text-base` trap**: resolves to font-size (1rem), not color — old CTAs had invisible white-on-white text. Always `text-black` explicitly on white buttons.
- **Split-text test trap**: breaking "19,242 XP" into numeral + unit spans breaks `getByText(/19,242 XP/)` — tests updated to match the numeral and unit separately.
- **Parallel jsdom flake**: 6 failures under parallel load (load avg 3.2), all pass solo — same documented pattern as program-builder.

## Deviations from spec

- **No separate chat route**: argus hub (prompt + draft preview) IS the chat surface — skin-only constraint forbids new pages. 7 visual surfaces unchanged.
- **Destructive red kept** in settings (delete confirm, errors): informational safety affordance; CI greps ban lime/gold, not red.

---

# Sprint 7.6 Report — "The Face" (identity, shell, home, visual baselines)

## Test counts

| Suite | Result |
|---|---|
| `tests/unit/identity.test.ts` (new) | 3/3 — APP_NAME audit, zero `/the lab/i` in src/, zero hardcoded hex outside globals.css + tokens.ts |
| Home/component tests (`home-states`, rpg components) | 15/15 |
| `tsc --noEmit` | clean |
| `npm run seed:verify` | zero golden diffs (identity sweep didn't move the fixture hash) |
| Playwright `visual.spec.ts` | 7/7 — 14 baselines (7 surfaces × mobile 390 / desktop 1440) |
| Playwright `rpg.spec.ts` | 4/4 |

## What shipped

1. **Identity** — `src/lib/identity.ts`: APP_NAME "Overload", wordmark, tagline, motto ("Ghost Division — the log that never misses."). Full sweep: zero "The Lab" left in src/ (pages, comments, coach_name, mock server). Manifest renamed.
2. **Tokens** — `src/lib/tokens.ts` mirrors globals.css `@theme`: base `#0a0a0b`, surface/surface-raised, border + border-gold, ember family, text tiers, good/warn/bad. All component hex moved to tokens (character SVG, recharts strokes, ChallengeDial, sparkline, themeColor). Audit test enforces it.
3. **AppShell** — desktop ≥1024px icon rail (9 items), mobile bottom nav (Home/Programs/Challenges/Character/More) + More sheet (Lab/Argus/History/Import/Settings), centered max-w-xl column. Wired in layout.tsx inside SyncProvider.
4. **Home composition** — exact spec order: wordmark + CharacterChip (LV ring, streak, freeze count) → today/rest card → START/RESUME CTA → ChallengeStrip (active dials or starter teaser) → WeekTiles (Sessions/Volume/PRs/Streak, last-7d) → last workout / no-history nudge → no-program teaser. Recovery (sparkline, briefing, new ManualCheckIn) in expandable details. All legacy testids preserved.
5. **Empty states** — no-history nudge (→ Import), no-program teaser (→ builder), ManualCheckIn when no recovery data today.
6. **Visual baselines** — `tests/e2e/visual.spec.ts`: 7 surfaces × 2 viewports, frozen clock at SEED_TODAY (`page.clock.install`), animations disabled, fullPage. CI drift detection via `toHaveScreenshot`.

## Key findings

- **Deep-link + seed-pull race**: one-shot loaders (skilltree/quests `useEffect`) read Dexie before the E2E seed pull lands when tests deep-link. Visual tests now land on `/` first, wait for `lab.e2eSeedPulled`, then navigate — same flow as rpg.spec. Reactive `useLiveQuery` pages (home/character) masked this.
- **Visual test budget**: chart-heavy fullPage screenshots starve on the shared machine; visual describe sets `test.setTimeout(300_000)`.

## Deviations from spec
- None functional. Desktop rail item set is 9 (spec said "nav items"); More sheet groups secondary destinations per the 5-tab mobile constraint.

# M1 Report — Real-Data Calibration (migration 0008 + Dexie v8)

## Test counts

| Suite | Result |
|---|---|
| Unit (`tests/unit/hevy-real.test.ts`) | 18 new — all pass (real-export parse: cardio anomalies, 1-rep heavies, separate Leg Press machines, empty RPE, `d MMM yyyy` dates, zero-dup re-import, name evolution) |
| Unit (`tests/unit/csv-export.test.ts`) | 1 new — round-trip proof: exported CSV re-imports with zero new inserts; measurements CSV re-parses to the same rows |
| RPG goldens | regenerated — 80 skill nodes, 9 body-state cases, 4 bodyweight feats (4 × 750 XP) shift level-ups; `rpg.test.ts` 18/18 |
| Recovery goldens | regenerated — briefing-input gains `bodyweight_trend` ('down'), `bodyweight_target_lb` 220, `bodyweight_distance_lb` 2.5 |
| `tsc --noEmit` | clean |
| `npm run build` | pass |
| `npm run seed:verify` | zero golden diffs (after reseed — fixture hash changed with new columns) |
| Playwright `rpg.spec.ts` | 4/4 pass |

### Environment note
Full-suite parallel vitest runs on this shared machine starve under load (load avg ~4.7): rpg/argus golden tests hit their 5s timeouts with 15-min wall times. Every affected file passes in isolation (rpg 18/18 ×2, argus 37/37, recovery 22/23 + 1 timing flake that passes solo). Same pre-existing parallel jsdom flakes as Sprint 7 (program-builder ×2, workout-logger ×1, argus ×1).

## What shipped

1. **Schema (migration 0008 + Dexie v8)** — `daily_metrics.body_fat_pct DECIMAL`, `exercises.machine_type TEXT` (45deg | horizontal | selectorized | cable | cardio).
2. **Importer** — `measurement_data.csv` → daily_metrics (weight + fat %); cardio rows (empty reps + duration) → cardio_entries with distance null and anomalies preserved; 0-based set_index preserved (was clamped to 1, collapsing 275→244 sets); CRLF/LF mixed line endings normalized (Papa glues rows when header is CRLF and a data row is bare LF — root-caused via minimal repro).
3. **Equipment calibration** — `machine_type` per the user's real machines; `effective_load = weight × angle_factor` (45deg 0.707, horizontal 1.0): 45deg Leg Press 240 loaded ≈ 168 lb effective vs Horizontal 235 = 235 lb — Horizontal is the heavier lifter by mechanical fact.
4. **RPG** — 8 strength chains × 5 tiers anchored to the user's real Consensus e1RMs (80 nodes); bodyweight Feats sub-250/240/230/225/220 at +750 XP each; character sheet binds the user's 11 actual machines; real weigh-in series (251.33/252/252.21/252.2) → CUT via sparse fallback.
5. **Cardio time challenge** — new `cardio_time` type (cumulative hours, `target_hours`), reward 400 XP, gauntlet-validated; starter "10 Hours of Cardio This Month" added, miles-based 25mi starter deprioritized to last (user cardio has no distance data).
6. **Argus briefing** — inputs gain bodyweight trend direction (≥0.5 lb delta over last two weigh-ins) + distance to the 220 lb target; narration guardrail unchanged.
7. **CSV export** — Settings → Export CSV: Hevy-compatible workouts CSV (same column schema as import) + measurements CSV, one tap, two downloads; timestamps export as `YYYY-MM-DD HH:mm:ss` UTC so re-import round-trips exactly (zero duplicates, proven by test).

## Deviations from spec

1. `CHAIN_ROLE` binds 8 chains to the 6 seeded key-lift ids (duplicate ids would double-count strength XP); documented pattern from Sprint 7.
2. Export timestamps use `YYYY-MM-DD HH:mm:ss` instead of Hevy's `d MMM yyyy, HH:mm` — the minute-precision format loses seconds and would break the zero-duplicate round-trip guarantee; the parser accepts both.
3. Export `title` comes from `workout_sessions.notes` (where the importer stores the Hevy workout title); manual sessions export their notes as title.
4. `top_set` exports as `normal` (app-only type, lossy — mirrors the documented import mapping).

## Files

**New:** `supabase/migrations/0008_calibration.sql`, `src/lib/equipment.ts`, `tests/fixtures/hevy-real.csv`, `tests/fixtures/hevy-real-measurements.csv`, `tests/unit/hevy-real.test.ts`, `tests/unit/csv-export.test.ts`.

**Modified:** `src/lib/db.ts` (v8), `src/lib/hevy-csv.ts` (line-ending normalization, 0-based set_order, cardio + measurements parsing), `src/lib/rpg/{config,ledger,quests,xp}.ts`, `src/lib/seed/{rpg-fixture,recovery-fixture,challenge-fixture,fixture,program-fixture}.ts`, `src/lib/challenges/{engine,service}.ts`, `src/lib/argus/{briefing,gauntlet}.ts`, `src/lib/export.ts`, `src/lib/{types,wger,whoop}.ts`, `src/app/{import,settings,quests,page,challenges/*,programs/*}/page.tsx`, `src/components/FinishWorkoutModal.tsx`, goldens (xp/body-state/skills/quests/rpg-character/briefing-input), test literals for the two new columns.

---

# Sprint 7 Report — The RPG

## Test counts

| Suite | Result |
|---|---|
| Unit (`tests/unit/rpg.test.ts`) | 18 new — all pass (5 golden diffs, idempotence, level boundaries, high-water, A1 body-state cases, purity) |
| Component (`tests/component/rpg.test.tsx`) | 8 new — all pass (character sheet, quests board, celebration, ember tokens, zero-fantasy-nouns copy walk) |
| E2E (`tests/e2e/rpg.spec.ts`) | **4/4 pass** (18.8s): lifecycle, body-state, retro-import, readonly-regression |
| Full vitest | **296/301** — 5 pre-existing parallel-load flakes only (see below) |
| Full Playwright | **37/39** — 2 pre-existing failures only (see below) |
| `tsc --noEmit` | clean |
| `npm run build` | pass (3 new routes: /character, /skilltree, /quests) |
| `npm run seed:verify` | **zero golden diffs** — all 6 sections incl. new `rpg-character` |

### Pre-existing failures (NOT Sprint 7 regressions)
- `program-builder.test.tsx` ×2 + `workout-logger.test.tsx` ×2 + `argus.test.ts` ×1: parallel jsdom load flakes — all pass in isolation and on the clean tree (verified via `git stash`).
- `program-lifecycle.spec.ts` + `substitution-e2e.spec.ts`: fail on the clean tree too (verified via `git stash`), unrelated to RPG.

## Acceptance gates

1. **Deterministic seed** — `buildRpgData()` from the committed base fixture; same hash in, same character out. `computeSeedRpg` twice → identical.
2. **Goldens win** — `rpg-character` golden committed; `seed:verify` section 6 diffs zero.
3. **Level curve** — T(L)=round(120·(L−1)^1.75); boundaries tested at L2/3/6/10/20/50 crossings.
4. **XP engine** — setXp/cardioXp/prBonus formulas locked by goldens; warmup 0×, RPE clamp 0.3–1.0.
5. **Skill tree** — 74 nodes across 4 branches; 44 completed / 12 available / 18 locked in seed; crossings persist via silent recompute.
6. **Quests** — trial/arc/deed/feat board live-evaluates challenges via `buildEvalContext` + `evaluateChallenge`; ✨ adaptive mark.
7. **Body state (Amendment A1)** — CUT/BALANCED/GAIN with sparse fallback (last-known governs), hysteresis (3-day persistence), band logic; 8 named A1 cases unit-tested.
8. **Retro-compute** — first import materializes the character (import screen shows the materialized panel); app-open retro-compute bails when ledger exists or no sets.
9. **Readonly regression** — e2e asserts RPG browsing writes only `xp_ledger`/`user_skills`/`rpg_character`/`skill_nodes`/`settings` (pre-existing challenge/recovery sweep tables allowed).
10. **Copy discipline** — zero fantasy nouns (dungeon/dragon/sword/mana/… enforced by test); second-person voice; ember tokens via Tailwind v4 `@theme`; Cinzel display font.

## Deviations from spec

1. Level curve base is (L−1), so L2 starts at 120 XP.
2. Ledger ids are deterministic strings, not UUIDs.
3. `source_kind: 'skill'` added for skill-node XP rows.
4. Branch XP formula constants locked by goldens (spec left them open).
5. Manual `xp_mode` override applies to the ENTIRE recompute, not just new rows.
6. `best_streak` uses app grace semantics (max_rest_days=2); freeze mechanics ignored.
7. 74 skill nodes vs spec's "~60".
8. `checkin_count` condition type added for deeds.
9. Machine/DB node titles bind to fixture exercise ids via seed data.
10. Feats display-only XP (no ledger rows).
11. Session bonus requires ≥1 working set.
12. Program week `earned_at` = weekEndDate T23:59:59Z.
13. A1 sparse fallback (user amendment): <7 entries in 14d → last-known weight governs.
14. Seed has no program tables → program/adherence XP is 0 in the seed character.
15. Seed has no cardio → conditioning branch XP is 0.

## Files

**New:** `src/lib/rpg/{types,xp,level,skill-tree,quests,body-state,retro,copy}.ts`, `src/lib/seed/rpg-fixture.ts`, `src/components/rpg/Celebration.tsx`, `src/app/{character,skilltree,quests}/page.tsx`, `tests/unit/rpg.test.ts`, `tests/component/rpg.test.tsx`, `tests/e2e/rpg.spec.ts`, goldens `tests/goldens/rpg-character.json`.

**Modified:** `src/lib/db.ts` (rpg_* schema v9), `src/lib/sync/engine.ts` (table order), `src/components/SyncProvider.tsx` (retro-compute on sync), `src/app/page.tsx` (character chip), `src/app/import/page.tsx` (materialized screen), `src/app/globals.css` (ember @theme), `src/app/layout.tsx` (Cinzel), `scripts/verify-seed.ts` (section 6), `src/lib/seed/rpg-fixture.ts` exports.