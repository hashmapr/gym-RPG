'use client';

// PROGRAMS — active run card (week N of M, adherence %, next session) and
// completed/abandoned runs below. Entry point to run detail + builder.

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { adherencePct } from '@/lib/coach/engine';
import { getTrainingDate } from '@/lib/day-boundary';
import { useSettings } from '@/lib/settings';
import type { Program, ProgramRun } from '@/lib/types';

export default function ProgramsPage() {
  const settings = useSettings();
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);

  const runs = useLiveQuery(async () => {
    const all = await db.program_runs.toArray();
    all.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const programs = await db.programs.toArray();
    const byId = new Map(programs.map((p) => [p.id, p]));
    const out = [];
    for (const run of all) {
      const program = byId.get(run.program_id);
      if (!program) continue;
      const sessions = await db.planned_sessions
        .where('program_run_id')
        .equals(run.id)
        .toArray();
      const templates = await db.program_templates
        .where('program_id')
        .equals(run.program_id)
        .toArray();
      const totalWeeks = new Set(templates.map((t) => t.week_number ?? 1)).size;
      const elapsed = sessions.filter(
        (s) => s.planned_date != null && s.planned_date <= today,
      );
      const adherence = adherencePct(elapsed);
      const next = sessions
        .filter((s) => s.status === 'planned' && s.planned_date != null && s.planned_date >= today)
        .sort((a, b) => (a.planned_date ?? '').localeCompare(b.planned_date ?? ''))[0];
      out.push({ run, program, totalWeeks, adherence, nextName: next?.workout_name ?? null, nextDate: next?.planned_date ?? null });
    }
    return out;
  }, [today]);

  const active = (runs ?? []).filter((r) => r.run.status === 'active');
  const past = (runs ?? []).filter((r) => r.run.status !== 'active');

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Home
        </Link>
        <h1 className="text-xl font-black tracking-tight text-white">
          PROGRAMS
        </h1>
        <Link
          href="/programs/new"
          data-testid="new-program"
          className="min-h-10 px-3 py-2 rounded-lg bg-white font-bold text-black text-sm active:bg-white/80"
        >
          + NEW
        </Link>
      </header>

      {runs === undefined && <p className="text-zinc-400">Loading…</p>}

      {runs !== undefined && active.length === 0 && past.length === 0 && (
        <p className="text-zinc-400 text-center mt-10">
          No programs yet. Create one to start training with the coach.
        </p>
      )}

      {active.map((r) => (
        <RunCard key={r.run.id} data={r} active testid="active-run-card" />
      ))}

      {past.length > 0 && (
        <h2 className="mt-6 mb-2 text-xs uppercase tracking-widest text-zinc-500">
          Past runs
        </h2>
      )}
      {past.map((r) => (
        <RunCard key={r.run.id} data={r} active={false} testid="past-run-card" />
      ))}
    </main>
  );
}

interface RunCardData {
  run: ProgramRun;
  program: Program;
  totalWeeks: number;
  adherence: number | null;
  nextName: string | null;
  nextDate: string | null;
}

function RunCard({
  data,
  active,
  testid,
}: {
  data: RunCardData;
  active: boolean;
  testid: string;
}) {
  return (
    <Link
      href={`/programs/${data.program.id}/run/${data.run.id}`}
      data-testid={testid}
      className="block mt-3 rounded-xl bg-zinc-900 border border-zinc-800 p-4 active:bg-zinc-800"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-bold text-zinc-100">{data.program.name}</h3>
        <span
          className={`text-xs font-bold uppercase tracking-wide ${
            data.run.status === 'active'
              ? 'text-white'
              : data.run.status === 'abandoned'
                ? 'text-red-400'
                : 'text-zinc-500'
          }`}
        >
          {data.run.status}
        </span>
      </div>
      {active && (
        <p className="mt-1 text-sm text-zinc-400">
          Week <span className="text-zinc-100 tabular-nums">{data.run.current_week}</span> of{' '}
          <span className="tabular-nums">{data.totalWeeks}</span>
          {data.adherence !== null && (
            <>
              {' '}· adherence{' '}
              <span className="text-zinc-100 tabular-nums" data-testid="adherence-pct">
                {data.adherence}%
              </span>
            </>
          )}
        </p>
      )}
      {active && data.nextName && (
        <p className="mt-0.5 text-sm text-zinc-500">
          Next: {data.nextName} on <span className="tabular-nums">{data.nextDate}</span>
        </p>
      )}
      {!active && (
        <p className="mt-1 text-sm text-zinc-500">
          Started <span className="tabular-nums">{data.run.started_on}</span>
        </p>
      )}
    </Link>
  );
}