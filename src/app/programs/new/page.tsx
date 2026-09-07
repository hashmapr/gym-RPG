'use client';

// PROGRAM BUILDER — name/goal/weekdays/weeks, per-week days with exercises
// (wger picker), sets/reps-range/RPE/rest, progression rule per exercise,
// deload toggle per week. OR import program JSON (validate → preview →
// create). Saving creates the program AND starts its first run.

import { useMemo, useState } from 'react';
import { programRunHref } from '@/lib/links';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { db, newId, nowIso } from '@/lib/db';
import ExerciseSearch from '@/components/ExerciseSearch';
import { startRun } from '@/lib/coach/run';
import { exerciseName } from '@/lib/wger';
import type {
  Exercise,
  ProgressionRuleType,
  Program,
  ProgramTemplate,
  TemplateExercise,
  ProgressionRule,
} from '@/lib/types';

interface RuleSpec {
  rule_type: ProgressionRuleType;
  increment_lb: number | null;
  target_rpe: number | null;
  min_reps: number | null;
  max_reps: number | null;
  start_weight_lb: number | null;
}

interface BuilderExercise {
  exerciseId: string;
  name: string;
  sets: number;
  reps: string;
  rpe: number | null;
  rest: number;
  rule: RuleSpec;
}

interface BuilderDay {
  dayNumber: number;
  name: string;
  exercises: BuilderExercise[];
}

interface BuilderWeek {
  week: number;
  deload: boolean;
  days: BuilderDay[];
  // true once the user explicitly edited this week's days/exercises;
  // unedited weeks keep mirroring week 1.
  edited: boolean;
}

const RULE_PRESETS: { type: ProgressionRuleType; label: string; make: () => RuleSpec }[] = [
  {
    type: 'linear',
    label: 'Linear +5',
    make: () => ({ rule_type: 'linear', increment_lb: 5, target_rpe: null, min_reps: null, max_reps: null, start_weight_lb: null }),
  },
  {
    type: 'double',
    label: 'Double 8–12 @ RPE 8',
    make: () => ({ rule_type: 'double', increment_lb: 5, target_rpe: 8, min_reps: 8, max_reps: 12, start_weight_lb: null }),
  },
  {
    type: 'rpe_autoreg',
    label: 'RPE autoreg',
    make: () => ({ rule_type: 'rpe_autoreg', increment_lb: 5, target_rpe: 8, min_reps: null, max_reps: null, start_weight_lb: null }),
  },
  {
    type: 'static',
    label: 'Static (no progression)',
    make: () => ({ rule_type: 'static', increment_lb: null, target_rpe: null, min_reps: null, max_reps: null, start_weight_lb: null }),
  },
];

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ProgramBuilderPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [weeksCount, setWeeksCount] = useState(4);
  const [weeks, setWeeks] = useState<BuilderWeek[]>([]);
  const [activeWeek, setActiveWeek] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<BuilderWeek[] | null>(null);
  const [importMeta, setImportMeta] = useState<{ name: string; goal: string; weekdays: number[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure weeks array matches weeksCount; new weeks copy week 1. Weeks the
// user hasn't explicitly edited keep mirroring week 1 (keeping their deload
// flag), so "set weeks first, then build week 1" produces a full program.
  const ensureWeeks = (count: number, current: BuilderWeek[]): BuilderWeek[] => {
    const out: BuilderWeek[] = [];
    const src = current.find((x) => x.week === 1);
    const srcHasExercises = !!src && src.days.some((d) => d.exercises.length > 0);
    const copyDays = (): BuilderDay[] =>
      src
        ? src.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e, rule: { ...e.rule } })) }))
        : [];
    for (let w = 1; w <= count; w++) {
      const existing = current.find((x) => x.week === w);
      if (existing) {
        out.push(
          w !== 1 && !existing.edited && srcHasExercises
            ? { ...existing, days: copyDays() }
            : existing,
        );
      } else {
        out.push({
          week: w,
          deload: false,
          edited: false,
          days: copyDays(),
        });
      }
    }
    return out;
  };

  const currentWeeks = useMemo(() => ensureWeeks(weeksCount, weeks), [weeksCount, weeks]);
  const week = currentWeeks.find((w) => w.week === activeWeek) ?? currentWeeks[0];

  const updateWeek = (patch: Partial<BuilderWeek>, markEdited = false) => {
    setWeeks(
      currentWeeks.map((w) =>
        w.week === activeWeek ? { ...w, ...patch, edited: markEdited || w.edited } : w,
      ),
    );
  };

  const addDay = () => {
    const dayNumber = week.days.length + 1;
    updateWeek(
      {
        days: [...week.days, { dayNumber, name: `Day ${dayNumber}`, exercises: [] }],
      },
      true,
    );
  };

  const updateDay = (dayNumber: number, patch: Partial<BuilderDay>) => {
    updateWeek(
      {
        days: week.days.map((d) => (d.dayNumber === dayNumber ? { ...d, ...patch } : d)),
      },
      true,
    );
  };

  const addExerciseTo = (dayNumber: number, exercise: Exercise) => {
    const day = week.days.find((d) => d.dayNumber === dayNumber);
    if (!day) return;
    updateDay(dayNumber, {
      exercises: [
        ...day.exercises,
        {
          exerciseId: exercise.id,
          name: exerciseName(exercise),
          sets: 3,
          reps: '8-12',
          rpe: 8,
          rest: 120,
          rule: RULE_PRESETS[1].make(),
        },
      ],
    });
  };

  const updateExercise = (dayNumber: number, index: number, patch: Partial<BuilderExercise>) => {
    const day = week.days.find((d) => d.dayNumber === dayNumber);
    if (!day) return;
    updateDay(dayNumber, {
      exercises: day.exercises.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    });
  };

  const removeExercise = (dayNumber: number, index: number) => {
    const day = week.days.find((d) => d.dayNumber === dayNumber);
    if (!day) return;
    updateDay(dayNumber, { exercises: day.exercises.filter((_, i) => i !== index) });
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (weekdays.length === 0) {
      setError('Pick at least one training day.');
      return;
    }
    const totalDays = currentWeeks.reduce((n, w) => n + w.days.length, 0);
    if (totalDays === 0) {
      setError('Add at least one day with exercises.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const program: Program = {
        id: newId(),
        name: name.trim(),
        coach_name: null,
        goal: goal.trim() || null,
        start_date: null,
        end_date: null,
        is_active: true,
        weekdays: [...weekdays].sort(),
        created_at: nowIso(),
      };
      await db.programs.add(program);
      for (const w of currentWeeks) {
        for (const d of w.days) {
          if (d.exercises.length === 0) continue; // don't persist empty days
          const template: ProgramTemplate = {
            id: newId(),
            program_id: program.id,
            week_number: w.week,
            day_number: d.dayNumber,
            workout_name: d.name,
            is_deload: w.deload,
            created_at: nowIso(),
          };
          await db.program_templates.add(template);
          for (let i = 0; i < d.exercises.length; i++) {
            const ex = d.exercises[i];
            const resolvedId = await resolveExerciseId(ex);
            if (!resolvedId) {
              throw new Error(`Exercise not found: ${ex.name}`);
            }
            const te: TemplateExercise = {
              id: newId(),
              template_id: template.id,
              exercise_id: resolvedId,
              target_sets: ex.sets,
              target_reps: ex.reps,
              target_rpe: ex.rpe,
              target_rest: ex.rest,
              exercise_order: i + 1,
            };
            await db.template_exercises.add(te);
            const rule: ProgressionRule = {
              id: newId(),
              template_exercise_id: te.id,
              rule_type: ex.rule.rule_type,
              increment_lb: ex.rule.increment_lb,
              target_rpe: ex.rule.target_rpe,
              min_reps: ex.rule.min_reps,
              max_reps: ex.rule.max_reps,
              start_weight_lb: ex.rule.start_weight_lb,
              created_at: nowIso(),
            };
            await db.progression_rules.add(rule);
          }
        }
      }
      const run = await startRun(program.id);
      router.push(programRunHref(program.id, run.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save program.');
      setSaving(false);
    }
  };

  const tryImport = () => {
    setImportError(null);
    setImportPreview(null);
    try {
      const parsed = JSON.parse(importText) as {
        name?: unknown;
        goal?: unknown;
        weekdays?: unknown;
        weeks?: unknown;
      };
      if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
        throw new Error('name is required');
      }
      if (!Array.isArray(parsed.weeks) || parsed.weeks.length === 0) {
        throw new Error('weeks must be a non-empty array');
      }
      const wd =
        Array.isArray(parsed.weekdays) && parsed.weekdays.every((n) => typeof n === 'number')
          ? (parsed.weekdays as number[])
          : [1, 3, 5];
      const outWeeks: BuilderWeek[] = [];
      for (const [wi, w] of parsed.weeks.entries()) {
        const weekObj = w as { deload?: unknown; days?: unknown };
        if (!Array.isArray(weekObj.days) || weekObj.days.length === 0) {
          throw new Error(`weeks[${wi}].days must be a non-empty array`);
        }
        const days: BuilderDay[] = [];
        for (const [di, d] of weekObj.days.entries()) {
          const dayObj = d as { name?: unknown; exercises?: unknown };
          if (!Array.isArray(dayObj.exercises) || dayObj.exercises.length === 0) {
            throw new Error(`weeks[${wi}].days[${di}].exercises must be a non-empty array`);
          }
          const exercises: BuilderExercise[] = [];
          for (const [ei, e] of dayObj.exercises.entries()) {
            const exObj = e as Record<string, unknown>;
            const exerciseId = typeof exObj.exercise_id === 'string' ? exObj.exercise_id : null;
            const exName = typeof exObj.exercise === 'string' ? exObj.exercise : null;
            if (!exerciseId && !exName) {
              throw new Error(
                `weeks[${wi}].days[${di}].exercises[${ei}] needs "exercise" (name) or "exercise_id"`,
              );
            }
            exercises.push({
              exerciseId: exerciseId ?? `name:${exName}`,
              name: exName ?? exerciseId!,
              sets: typeof exObj.sets === 'number' ? exObj.sets : 3,
              reps: typeof exObj.reps === 'string' ? exObj.reps : '8-12',
              rpe: typeof exObj.rpe === 'number' ? exObj.rpe : null,
              rest: typeof exObj.rest === 'number' ? exObj.rest : 120,
              rule: normalizeRule(exObj.rule),
            });
          }
          days.push({
            dayNumber: di + 1,
            name: typeof dayObj.name === 'string' ? dayObj.name : `Day ${di + 1}`,
            exercises,
          });
        }
        outWeeks.push({ week: wi + 1, deload: weekObj.deload === true, days, edited: true });
      }
      setImportMeta({ name: parsed.name, goal: typeof parsed.goal === 'string' ? parsed.goal : '', weekdays: wd });
      setImportPreview(outWeeks);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const commitImport = async () => {
    if (!importPreview || !importMeta) return;
    setName(importMeta.name);
    setGoal(importMeta.goal);
    setWeekdays(importMeta.weekdays);
    setWeeksCount(importPreview.length);
    setWeeks(importPreview.map((w) => ({ ...w, edited: true })));
    setImportOpen(false);
    setImportPreview(null);
    setImportText('');
  };

  return (
    <main className="max-w-md mx-auto p-4 pb-32">
      <header className="flex items-center justify-between py-4">
        <Link href="/programs" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Programs
        </Link>
        <h1 className="text-xl font-black tracking-tight text-white">NEW PROGRAM</h1>
        <button
          type="button"
          data-testid="open-import"
          onClick={() => setImportOpen(true)}
          className="min-h-10 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-semibold text-zinc-100"
        >
          IMPORT JSON
        </button>
      </header>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-3">
        <input
          data-testid="program-name"
          type="text"
          placeholder="Program name"
          aria-label="Program name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100"
        />
        <input
          data-testid="program-goal"
          type="text"
          placeholder="Goal (optional)"
          aria-label="Goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="w-full min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100"
        />
        <div className="flex gap-1 flex-wrap" data-testid="weekday-picker">
          {WEEKDAY_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() =>
                setWeekdays((cur) =>
                  cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort(),
                )
              }
              className={`min-h-10 px-3 rounded-lg text-sm font-semibold ${
                weekdays.includes(i)
                  ? 'bg-white text-black'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 text-sm text-zinc-300">
          Weeks
          <input
            data-testid="weeks-count"
            type="number"
            min={1}
            max={52}
            value={weeksCount}
            onChange={(e) => setWeeksCount(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
            className="w-20 min-h-10 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-center text-zinc-100"
          />
        </label>
      </section>

      <div className="flex gap-1 mt-4 overflow-x-auto pb-1" data-testid="week-tabs">
        {currentWeeks.map((w) => (
          <button
            key={w.week}
            type="button"
            onClick={() => setActiveWeek(w.week)}
            className={`min-h-10 px-3 rounded-lg text-sm font-bold whitespace-nowrap ${
              activeWeek === w.week
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            W{w.week}
            {w.deload ? ' 🕊' : ''}
          </button>
        ))}
      </div>

      {week && (
        <section className="mt-3 rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm uppercase tracking-widest text-zinc-400">
              WEEK {week.week}
            </h2>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                data-testid={`deload-${week.week}`}
                type="checkbox"
                checked={week.deload}
                onChange={(e) => updateWeek({ deload: e.target.checked })}
                className="w-5 h-5 accent-white"
              />
              Deload
            </label>
          </div>

          {week.days.map((day) => (
            <div key={day.dayNumber} className="mb-4 rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  aria-label={`Day ${day.dayNumber} name`}
                  value={day.name}
                  onChange={(e) => updateDay(day.dayNumber, { name: e.target.value })}
                  className="flex-1 min-h-10 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100 text-sm"
                />
              </div>
              {day.exercises.map((ex, i) => (
                <div key={`${ex.exerciseId}-${i}`} className="mb-2 rounded-lg bg-zinc-900 border border-zinc-700 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-100">{ex.name}</span>
                    <button
                      type="button"
                      onClick={() => removeExercise(day.dayNumber, i)}
                      className="text-xs text-red-400 px-2"
                    >
                      REMOVE
                    </button>
                  </div>
                  <div className="flex gap-2 mt-1 text-xs">
                    <input
                      type="number"
                      min={1}
                      aria-label="Sets"
                      value={ex.sets}
                      onChange={(e) => updateExercise(day.dayNumber, i, { sets: Number(e.target.value) || 1 })}
                      className="w-14 min-h-9 rounded bg-zinc-800 border border-zinc-700 px-2 text-center text-zinc-100"
                    />
                    <input
                      type="text"
                      aria-label="Reps (e.g. 8-12)"
                      value={ex.reps}
                      onChange={(e) => updateExercise(day.dayNumber, i, { reps: e.target.value })}
                      className="w-20 min-h-9 rounded bg-zinc-800 border border-zinc-700 px-2 text-center text-zinc-100"
                    />
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      aria-label="Target RPE"
                      value={ex.rpe ?? ''}
                      onChange={(e) =>
                        updateExercise(day.dayNumber, i, {
                          rpe: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-16 min-h-9 rounded bg-zinc-800 border border-zinc-700 px-2 text-center text-zinc-100"
                    />
                    <input
                      type="number"
                      min={0}
                      aria-label="Rest seconds"
                      value={ex.rest}
                      onChange={(e) => updateExercise(day.dayNumber, i, { rest: Number(e.target.value) || 0 })}
                      className="w-16 min-h-9 rounded bg-zinc-800 border border-zinc-700 px-2 text-center text-zinc-100"
                    />
                    <select
                      data-testid={`rule-${ex.exerciseId}`}
                      aria-label="Progression rule"
                      value={ex.rule.rule_type}
                      onChange={(e) => {
                        const preset = RULE_PRESETS.find((p) => p.type === e.target.value)!;
                        updateExercise(day.dayNumber, i, { rule: preset.make() });
                      }}
                      className="min-h-9 rounded bg-zinc-800 border border-zinc-700 px-1 text-zinc-100"
                    >
                      {RULE_PRESETS.map((p) => (
                        <option key={p.type} value={p.type}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              <ExerciseSearch onSelect={(e) => addExerciseTo(day.dayNumber, e)} />
            </div>
          ))}

          <button
            type="button"
            data-testid="add-day"
            onClick={addDay}
            className="w-full min-h-11 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold text-zinc-100 text-sm active:bg-zinc-700"
          >
            + ADD DAY
          </button>
        </section>
      )}

      {error && (
        <p data-testid="builder-error" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-zinc-950/95 backdrop-blur border-t border-zinc-800">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            data-testid="save-program"
            onClick={save}
            disabled={saving}
            className="w-full min-h-14 rounded-xl bg-white font-black text-lg tracking-wide text-black disabled:opacity-50 active:bg-white/80"
          >
            {saving ? 'SAVING…' : 'CREATE + START RUN'}
          </button>
        </div>
      </div>

      {importOpen && (
        <div
          data-testid="import-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Import program JSON"
        >
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-700 p-4 max-h-[85vh] flex flex-col">
            <h2 className="text-lg font-black text-zinc-100 mb-2">IMPORT PROGRAM JSON</h2>
            <textarea
              data-testid="import-text"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{"name":"…","goal":"…","weekdays":[1,3,5],"weeks":[{"days":[{"name":"Day 1","exercises":[{"exercise":"Bench Press","sets":3,"reps":"8-12","rpe":8,"rest":120,"rule":{"rule_type":"double","increment_lb":5,"min_reps":8,"max_reps":12,"target_rpe":8}}]}]}]}'
              className="w-full h-48 rounded-lg bg-zinc-800 border border-zinc-700 p-3 text-xs text-zinc-100 font-mono"
            />
            {importError && (
              <p data-testid="import-error" className="mt-2 text-sm text-red-400">
                {importError}
              </p>
            )}
            {importPreview && (
              <div data-testid="import-preview" className="mt-2 rounded-lg bg-zinc-800 border border-zinc-700 p-3 text-sm text-zinc-300">
                <p className="font-bold text-zinc-100">{importMeta?.name}</p>
                <p className="text-xs text-zinc-500">
                  {importPreview.length} weeks ·{' '}
                  {importPreview.reduce((n, w) => n + w.days.length, 0)} days ·{' '}
                  {importPreview.reduce(
                    (n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0),
                    0,
                  )}{' '}
                  exercises
                </p>
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                data-testid="import-validate"
                onClick={tryImport}
                className="flex-1 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 font-bold text-zinc-100 active:bg-zinc-700"
              >
                VALIDATE
              </button>
              <button
                type="button"
                data-testid="import-commit"
                onClick={commitImport}
                disabled={!importPreview}
                className="flex-1 min-h-12 rounded-lg bg-white font-bold text-black disabled:opacity-40 active:bg-white/80"
              >
                USE THIS
              </button>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="min-h-12 px-4 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function normalizeRule(raw: unknown): RuleSpec {
  const r = (raw ?? {}) as Record<string, unknown>;
  const type = typeof r.rule_type === 'string' ? r.rule_type : 'static';
  const valid: ProgressionRuleType[] = ['linear', 'double', 'rpe_autoreg', 'static'];
  const ruleType = (valid as string[]).includes(type) ? (type as ProgressionRuleType) : 'static';
  return {
    rule_type: ruleType,
    increment_lb: typeof r.increment_lb === 'number' ? r.increment_lb : null,
    target_rpe: typeof r.target_rpe === 'number' ? r.target_rpe : null,
    min_reps: typeof r.min_reps === 'number' ? r.min_reps : null,
    max_reps: typeof r.max_reps === 'number' ? r.max_reps : null,
    start_weight_lb: typeof r.start_weight_lb === 'number' ? r.start_weight_lb : null,
  };
}

// Import entries may reference exercises by name — resolve at save time.
async function resolveExerciseId(spec: BuilderExercise): Promise<string | null> {
  if (!spec.exerciseId.startsWith('name:')) return spec.exerciseId;
  const name = spec.exerciseId.slice(5).trim().toLowerCase();
  const all = await db.exercises.toArray();
  const match = all.find((e) => exerciseName(e).toLowerCase() === name);
  return match?.id ?? null;
}