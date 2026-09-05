// Sprint 3 E2E #2 — deload week: the scripted fixture run reaches week 4
// (deload). Planned set counts drop to ×0.6 (floor, min 1), weights are held
// at the pre-deload targets, no progression is applied (deload-hold audit
// rows), and week 5 resumes on the normal schedule.

import { test, expect } from '@playwright/test';
import { useMockSync, seedProgram, mockSyncState } from './helpers';
import type { ProgramFixture } from '../../src/lib/seed/program-fixture';

test('deload week reduces volume, holds weight, documents holds, resumes', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  const fixture = await seedProgram(page);
  const program = fixture.programs[0];
  const run = fixture.program_runs[0];

  // --- Backend state: week-4 volume + held weights -------------------------
  const state = await mockSyncState(page);
  const sessions = (state.tables.planned_sessions ?? []) as {
    id: string;
    week_number: number;
    is_deload: boolean | null;
  }[];
  const week4 = sessions.filter((s) => s.week_number === 4);
  expect(week4.length).toBeGreaterThan(0);
  expect(week4.every((s) => s.is_deload)).toBe(true);
  const week4Ids = new Set(week4.map((s) => s.id));

  const plannedSets = (state.tables.planned_sets ?? []) as {
    planned_session_id: string;
    exercise_id: string;
    target_weight: number | null;
  }[];
  const week4Sets = plannedSets.filter((s) => week4Ids.has(s.planned_session_id));

  // Set counts ×0.6 floor min 1: 4→2, 3→1.
  const perExercise = new Map<string, number>();
  for (const s of week4Sets) {
    perExercise.set(s.exercise_id, (perExercise.get(s.exercise_id) ?? 0) + 1);
  }
  const counts = [...perExercise.values()].sort();
  expect(counts.every((n) => n === 1 || n === 2)).toBe(true);

  // Held weights: week-4 targets equal week-3 targets per exercise.
  const week3 = sessions.filter((s) => s.week_number === 3);
  const week3Ids = new Set(week3.map((s) => s.id));
  const week3Targets = new Map<string, number>();
  for (const s of plannedSets) {
    if (week3Ids.has(s.planned_session_id) && s.target_weight != null) {
      week3Targets.set(s.exercise_id, s.target_weight);
    }
  }
  expect(week3Targets.size).toBeGreaterThan(0);
  for (const s of week4Sets) {
    expect(s.target_weight, `held weight for ${s.exercise_id}`).toBe(
      week3Targets.get(s.exercise_id) ?? null,
    );
  }

  // --- UI: deload badge, held progression rows, week 5 resumes -------------
  await page.goto(`/programs/${program.id}/run/${run.id}`);
  await expect(page.getByText('DELOAD').first()).toBeVisible();
  // Audit log documents the holds (no silent weeks).
  await expect(
    page.locator('[data-testid="progression-row"]').filter({ hasText: 'deload hold' }).first(),
  ).toBeVisible();
  // Week 5 exists on the calendar (UPCOMING — schedule only, no targets yet).
  await expect(page.getByText('WEEK 5')).toBeVisible();
  // Fixture sanity: the run's own template count matches the fixture.
  const fixtureWeek4: ProgramFixture['planned_sets'] = fixture.planned_sets.filter((s) =>
    week4Ids.has(s.planned_session_id),
  );
  expect(fixtureWeek4.length).toBe(week4Sets.length);
});