'use client';

// RUN DETAIL — calendar of planned sessions by week (completed/missed/
// upcoming/deload badges), adherence per week, and the per-exercise
// progression table built from the target_changes audit log.

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { adherencePct } from '@/lib/coach/engine';
import { getTrainingDate } from '@/lib/day-boundary';
import { useSettings } from '@/lib/settings';
import { exerciseName } from '@/lib/wger';
import type { Exercise, PlannedSession, Program, ProgramRun, TargetChange } from '@/lib/types';

export default function RunDetailPage() {
  const params = useParams<{ id: string; runId: string }>();
  const settings = useSettings();
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);

  const data = useLiveQuery(async () => {
    const run = (await db.program_runs.get(params.runId)) as ProgramRun | undefined;
    if (!run) return null;
    const program = await db.programs.get(params.id);
    if (!program) return null;
    const sessions = await db.planned_sessions
      .where('program_run_id')
      .equals(run.id)
      .toArray();
    sessions.sort(
      (a, b) =>
        (a.planned_date ?? '').localeCompare(b.planned_date ?? '') ||
        a.day_number - b.day_number,
    );
    const templates = await db.program_templates
      .where('program_id')
      .equals(run.program_id)
      .toArray();
    const totalWeeks = new Set(templates.map((t) => t.week_number ?? 1)).size;

    // Progression table: audit rows joined to planned sets → exercise.
    const plannedSets = await db.planned_sets.toArray();
    const psById = new Map(plannedSets.map((s) => [s.id, s]));
    const changes = await db.target_changes.toArray();
    const exercises = await db.exercises.toArray();
    const exById = new Map(exercises.map((e) => [e.id, e]));

    const byExercise = new Map<string, { name: string; rows: { week: number; weight: number | null; reason: string; date: string }[] }>();
    for (const c of changes as TargetChange[]) {
      const set = psById.get(c.planned_set_id);
      if (!set) continue;
      const ps = sessions.find((s) => s.id === set.planned_session_id);
      if (!ps) continue;
      const name = exerciseName(
        exById.get(set.exercise_id) ?? {
          id: set.exercise_id,
          wger_id: null,
          custom_name: null,
          category: null,
          primary_muscle: null,
          is_custom: false,
          machine_type: null,
          created_at: '',
        },
      );
      const entry = byExercise.get(set.exercise_id) ?? { name, rows: [] };
      entry.rows.push({
        week: ps.week_number,
        weight: c.new_weight,
        reason: c.reason,
        date: c.created_at,
      });
      byExercise.set(set.exercise_id, entry);
    }
    for (const entry of byExercise.values()) {
      entry.rows.sort((a, b) => a.week - b.week || a.date.localeCompare(b.date));
    }

    // Week 1 starting weights (from planned sets, no audit row exists yet).
    const week1Sets = plannedSets.filter((s) =>
      sessions.some((ps) => ps.id === s.planned_session_id && ps.week_number === 1),
    );
    for (const s of week1Sets) {
      if (s.target_weight == null) continue;
      const entry = byExercise.get(s.exercise_id);
      if (entry && !entry.rows.some((r) => r.week === 1)) {
        entry.rows.unshift({ week: 1, weight: s.target_weight, reason: 'start', date: '' });
      }
    }

    const weeks = [...new Set(sessions.map((s) => s.week_number))].sort((a, b) => a - b);
    const adherenceByWeek = weeks.map((w) => ({
      week: w,
      pct: adherencePct(sessions.filter((s) => s.week_number === w)),
    }));

    // Substituted slots per session (planned sets carry substituted_from).
    const substitutions = new Map<string, { fromId: string; toId: string }[]>();
    for (const s of plannedSets) {
      if (s.substituted_from == null) continue;
      const list = substitutions.get(s.planned_session_id) ?? [];
      if (!list.some((x) => x.toId === s.exercise_id)) {
        list.push({ fromId: s.substituted_from, toId: s.exercise_id });
      }
      substitutions.set(s.planned_session_id, list);
    }

    return { run, program, sessions, totalWeeks, weeks, adherenceByWeek, progression: [...byExercise.values()], substitutions, exById };
  }, [params.id, params.runId]);

  if (data === undefined) {
    return <main className="p-6 text-zinc-400">Loading…</main>;
  }
  if (data === null) {
    return (
      <main className="p-6">
        <p className="text-zinc-400 mb-4">Run not found.</p>
        <Link href="/programs" className="text-white">
          ← Programs
        </Link>
      </main>
    );
  }

  const { run, program, sessions, totalWeeks, adherenceByWeek, progression, substitutions, exById } = data;

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/programs" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Programs
        </Link>
        <h1 className="text-lg font-black tracking-tight text-white text-right">
          {program.name}
        </h1>
      </header>

      <p className="text-sm text-zinc-400 mb-4">
        Week <span className="text-zinc-100 tabular-nums">{run.current_week}</span> of{' '}
        <span className="tabular-nums">{totalWeeks}</span> · started{' '}
        <span className="tabular-nums">{run.started_on}</span> ·{' '}
        <span className={`uppercase font-bold ${run.status === 'active' ? 'text-white' : 'text-zinc-500'}`}>
          {run.status}
        </span>
      </p>

      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Calendar</h2>
        {adherenceByWeek.map(({ week, pct }) => (
          <div key={week} className="mb-3 rounded-xl bg-zinc-900 border border-zinc-800 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-bold text-zinc-100">
                WEEK {week}
              </h3>
              {pct !== null && (
                <span className="text-xs text-zinc-400 tabular-nums" data-testid={`adherence-week-${week}`}>
                  {pct}%
                </span>
              )}
            </div>
            <ul className="space-y-1">
              {sessions
                .filter((s) => s.week_number === week)
                .map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    today={today}
                    subs={substitutions.get(s.id) ?? []}
                    exById={exById}
                  />
                ))}
            </ul>
          </div>
        ))}
      </section>

      {progression.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-2">
            Progression (from audit log)
          </h2>
          {progression.map((entry) => (
            <div key={entry.name} className="mb-3 rounded-xl bg-zinc-900 border border-zinc-800 p-3">
              <h3 className="text-sm font-bold text-zinc-100 mb-2">{entry.name}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase tracking-wider">
                    <th className="text-left py-1">Week</th>
                    <th className="text-right py-1">Target</th>
                    <th className="text-left py-1 pl-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.rows.map((r, i) => (
                    <tr key={i} data-testid="progression-row" className="border-t border-zinc-800 text-zinc-200">
                      <td className="py-1.5 tabular-nums">{r.week}</td>
                      <td className="text-right tabular-nums">
                        {r.weight !== null ? `${r.weight} lb` : '—'}
                      </td>
                      <td className="pl-3 text-xs text-zinc-500">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function SessionRow({
  session,
  today,
  subs,
  exById,
}: {
  session: PlannedSession;
  today: string;
  subs: { fromId: string; toId: string }[];
  exById: Map<string, Exercise>;
}) {
  const badge =
    session.status === 'completed'
      ? { label: 'DONE', cls: 'bg-white/10 border-white/40 text-white' }
      : session.status === 'missed'
        ? { label: 'MISSED', cls: 'bg-red-500/15 border-red-500/40 text-red-300' }
        : session.planned_date != null && session.planned_date <= today
          ? { label: 'DUE', cls: 'bg-white/10 border-white/40 text-white' }
          : { label: 'UPCOMING', cls: 'bg-zinc-700/40 border-zinc-600 text-zinc-300' };
  return (
    <li className="flex items-center justify-between text-sm">
      <span className="text-zinc-300">
        D{session.day_number} · {session.workout_name}
        {session.is_deload && <span className="ml-1 text-xs text-zinc-300">DELOAD</span>}
        {subs.map(({ fromId, toId }) => {
          const fromName = exerciseName(
            exById.get(fromId) ?? {
              id: fromId,
              wger_id: null,
              custom_name: null,
              category: null,
              primary_muscle: null,
              is_custom: false,
              machine_type: null,
              created_at: '',
            },
          );
          const toName = exerciseName(
            exById.get(toId) ?? {
              id: toId,
              wger_id: null,
              custom_name: null,
              category: null,
              primary_muscle: null,
              is_custom: false,
              machine_type: null,
              created_at: '',
            },
          );
          return (
            <span
              key={`${fromId}-${toId}`}
              data-testid="substitution-row"
              className="ml-1 text-xs text-zinc-300"
            >
              ⇄ {fromName} → {toName}
            </span>
          );
        })}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 tabular-nums">{session.planned_date ?? '—'}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
          {badge.label}
        </span>
      </span>
    </li>
  );
}