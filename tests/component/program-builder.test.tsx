// Component tests: program builder — create a 2-week program with mixed
// rules from the UI; the engine produces the expected first-week targets.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

// wger remote search is network — force offline-style local-only results.
vi.mock('@/lib/wger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wger')>();
  return { ...actual, searchWgerExercises: vi.fn().mockRejectedValue(new Error('offline')) };
});

import { db, nowIso } from '@/lib/db';
import { useSyncStore } from '@/lib/sync/store';
import ProgramBuilderPage from '@/app/programs/new/page';
import type { Exercise } from '@/lib/types';

const BENCH: Exercise = {
  id: 'ex-bench',
  wger_id: 141,
  custom_name: 'Barbell Bench Press',
  category: 'Barbell',
  primary_muscle: 'Chest',
  is_custom: false,
  created_at: '2024-01-01T00:00:00.000Z',
};
const SQUAT: Exercise = {
  id: 'ex-squat',
  wger_id: 100,
  custom_name: 'Barbell Squat',
  category: 'Barbell',
  primary_muscle: 'Legs',
  is_custom: false,
  created_at: '2024-01-01T00:00:00.000Z',
};

beforeEach(async () => {
  cleanup();
  await Promise.all(db.tables.map((t) => t.clear()));
  useSyncStore.setState({ online: true, queuedCount: 0, syncing: false, lastError: null });
  await db.exercises.bulkAdd([BENCH, SQUAT]);
});

async function addExercise(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
  optionText: string,
) {
  const input = screen.getAllByTestId('exercise-search')[0];
  await user.type(input, query);
  const results = await screen.findByTestId('exercise-results', {}, { timeout: 3000 });
  const option = [...results.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(optionText),
  );
  if (!option) throw new Error(`option ${optionText} not found`);
  await user.click(option);
}

describe('Program builder', () => {
  it('creates a 2-week program with mixed rules → engine produces first-week targets', async () => {
    const user = userEvent.setup();

    // Athlete history: the engine falls back to the latest logged top set
    // when a rule has no start weight → golden week-1 targets 185 / 315.
    await db.workout_sessions.add({
      id: 'ws-hist',
      gym_id: null,
      session_type: 'strength',
      start_time: '2026-08-01T10:00:00.000Z',
      end_time: '2026-08-01T11:00:00.000Z',
      mood: null,
      energy: null,
      caffeine: null,
      notes: null,
      total_volume: null,
      total_sets: null,
      created_at: nowIso(),
    });
    await db.workout_sets.bulkAdd([
      {
        id: 'set-hist-bench',
        workout_id: 'ws-hist',
        exercise_id: BENCH.id,
        set_order: 1,
        weight: 185,
        reps: 8,
        rpe: null,
        rir: null,
        tempo: null,
        set_type: 'working',
        rest_before: null,
        rest_after: null,
        duration: null,
        mean_velocity: null,
        peak_velocity: null,
        timestamp: '2026-08-01T10:05:00.000Z',
        source: 'app',
        local_id: 'lid-hist-bench',
        created_at: '2026-08-01T10:05:00.000Z',
      },
      {
        id: 'set-hist-squat',
        workout_id: 'ws-hist',
        exercise_id: SQUAT.id,
        set_order: 1,
        weight: 315,
        reps: 5,
        rpe: null,
        rir: null,
        tempo: null,
        set_type: 'working',
        rest_before: null,
        rest_after: null,
        duration: null,
        mean_velocity: null,
        peak_velocity: null,
        timestamp: '2026-08-01T10:20:00.000Z',
        source: 'app',
        local_id: 'lid-hist-squat',
        created_at: '2026-08-01T10:20:00.000Z',
      },
    ]);

    render(<ProgramBuilderPage />);

    await user.type(screen.getByTestId('program-name'), 'Test 2-Week');
    // Week 1: add a day, bench (double 8-12 default preset) + squat (linear).
    await user.click(screen.getByTestId('add-day'));
    await addExercise(user, 'bench', 'Barbell Bench Press');
    await addExercise(user, 'squat', 'Barbell Squat');
    fireEvent.change(screen.getByTestId('rule-ex-squat'), {
      target: { value: 'linear' },
    });
    // Set weeks AFTER the days exist so week 2 copies week 1.
    fireEvent.change(screen.getByTestId('weeks-count'), { target: { value: '2' } });

    await user.click(screen.getByTestId('save-program'));

    await waitFor(
      async () => {
        const programs = await db.programs.toArray();
        expect(programs).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    const program = (await db.programs.toArray())[0];
    expect(program.name).toBe('Test 2-Week');
    expect(program.weekdays).toEqual([1, 3, 5]);

    const templates = await db.program_templates.where('program_id').equals(program.id).toArray();
    expect(templates.length).toBe(2);
    expect(new Set(templates.map((t) => t.week_number)).size).toBe(2);

    const rules = await db.progression_rules.toArray();
    expect(rules.filter((r) => r.rule_type === 'double')).toHaveLength(2);
    expect(rules.filter((r) => r.rule_type === 'linear')).toHaveLength(2);

    // startRun materialized the schedule + week-1 planned sets.
    const runs = await waitFor(async () => {
      const r = await db.program_runs.where('status').equals('active').toArray();
      expect(r).toHaveLength(1);
      return r;
    });
    const sessions = await waitFor(async () => {
      const s = await db.planned_sessions
        .where('program_run_id')
        .equals(runs[0].id)
        .toArray();
      expect(s.length).toBe(2); // 1 day × 2 weeks
      return s;
    });
    const week1 = sessions.find((s) => s.week_number === 1)!;
    const week2 = sessions.find((s) => s.week_number === 2)!;
    // Wait for full week-1 materialization (2 exercises × 3 sets).
    await waitFor(async () => {
      const all = await db.planned_sets
        .where('planned_session_id')
        .equals(week1.id)
        .toArray();
      expect(all.length).toBe(6);
    });
    const plannedSets = await db.planned_sets
      .where('planned_session_id')
      .equals(week1.id)
      .toArray();
    // Golden first-week targets from athlete history.
    const benchSets = plannedSets.filter((s) => s.exercise_id === BENCH.id);
    const squatSets = plannedSets.filter((s) => s.exercise_id === SQUAT.id);
    expect(benchSets.every((s) => s.target_weight === 185)).toBe(true);
    expect(benchSets.every((s) => s.target_reps === '8-12')).toBe(true);
    expect(squatSets.every((s) => s.target_weight === 315)).toBe(true);
    // Week 2 mirrors week 1's prescription at the template level
    // (planned sets for later weeks materialize when the week is reached).
    const allTemplates = await db.program_templates.toArray();
    expect(allTemplates.map((t) => t.week_number).sort()).toEqual([1, 2]);
    const week2Template = allTemplates.find((t) => t.week_number === 2)!;
    const week2Tes = await db.template_exercises
      .where('template_id')
      .equals(week2Template.id)
      .toArray();
    expect(week2Tes).toHaveLength(2);
    expect(week2Tes.map((te) => te.exercise_id).sort()).toEqual(
      [BENCH.id, SQUAT.id].sort(),
    );
  });

  it('JSON import: validate → preview → use → save creates the program', async () => {
    const user = userEvent.setup();
    render(<ProgramBuilderPage />);

    await user.click(screen.getByTestId('open-import'));
    // userEvent.type parses { as key syntax — set textarea value directly.
    fireEvent.change(screen.getByTestId('import-text'), {
      target: {
        value: JSON.stringify({
          name: 'Imported',
          goal: 'strength',
          weekdays: [2, 4],
          weeks: [
            {
              days: [
                {
                  name: 'Day 1',
                  exercises: [
                    { exercise: 'Barbell Bench Press', sets: 3, reps: '8-12', rpe: 8, rest: 120, rule: { rule_type: 'double', increment_lb: 5, min_reps: 8, max_reps: 12, target_rpe: 8 } },
                  ],
                },
              ],
            },
            {
              deload: true,
              days: [
                {
                  name: 'Day 1',
                  exercises: [
                    { exercise: 'Barbell Bench Press', sets: 2, reps: '8', rpe: 7, rest: 120, rule: { rule_type: 'static' } },
                  ],
                },
              ],
            },
          ],
        }),
      },
    });
    await user.click(screen.getByTestId('import-validate'));
    await waitFor(() => expect(screen.getByTestId('import-preview')).toBeTruthy());
    await user.click(screen.getByTestId('import-commit'));

    await waitFor(() => expect(screen.getByTestId('program-name')).toHaveValue('Imported'));
    expect(screen.getByTestId('weeks-count')).toHaveValue(2);

    await user.click(screen.getByTestId('save-program'));
    await waitFor(
      async () => {
        const programs = await db.programs.toArray();
        expect(programs).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    const program = (await db.programs.toArray())[0];
    expect(program.name).toBe('Imported');
    expect(program.weekdays).toEqual([2, 4]);
    const templates = await db.program_templates
      .where('program_id')
      .equals(program.id)
      .toArray();
    const w2 = templates.find((t) => t.week_number === 2)!;
    expect(w2.is_deload).toBe(true);
    // Name-resolved exercise ids.
    const tes = await db.template_exercises.toArray();
    expect(tes.every((te) => te.exercise_id === BENCH.id)).toBe(true);
  });

  it('invalid import JSON shows an error and does not crash', async () => {
    const user = userEvent.setup();
    render(<ProgramBuilderPage />);
    await user.click(screen.getByTestId('open-import'));
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: '{ name: 42 }' } });
    await user.click(screen.getByTestId('import-validate'));
    await waitFor(() => expect(screen.getByTestId('import-error')).toBeTruthy());
    expect(screen.queryByTestId('import-preview')).toBeNull();
  });
});