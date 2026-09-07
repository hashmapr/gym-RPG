# Sprint Report

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