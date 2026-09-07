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