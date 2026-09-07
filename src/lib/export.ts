// Full JSON export — every table row, for backup/migration.

import { db } from './db';

export interface ExportPayload {
  exportedAt: string;
  version: 1;
  tables: Record<string, unknown[]>;
}

export async function buildExport(): Promise<ExportPayload> {
  const [
    exercises,
    gym_profiles,
    workout_sessions,
    workout_sets,
    cardio_entries,
    daily_metrics,
    programs,
    program_templates,
    template_exercises,
    rpg_character,
    settings,
    hevy_mappings,
  ] = await Promise.all([
    db.exercises.toArray(),
    db.gym_profiles.toArray(),
    db.workout_sessions.toArray(),
    db.workout_sets.toArray(),
    db.cardio_entries.toArray(),
    db.daily_metrics.toArray(),
    db.programs.toArray(),
    db.program_templates.toArray(),
    db.template_exercises.toArray(),
    db.rpg_character.toArray(),
    db.settings.toArray(),
    db.hevy_mappings.toArray(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    tables: {
      exercises,
      gym_profiles,
      workout_sessions,
      workout_sets,
      cardio_entries,
      daily_metrics,
      programs,
      program_templates,
      template_exercises,
      rpg_character,
      settings,
      hevy_mappings,
    },
  };
}

export async function downloadExport(): Promise<void> {
  const payload = await buildExport();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `the-lab-export-${payload.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Hevy-compatible CSV export (M1 §9) — portability + round-trip proof.
// ---------------------------------------------------------------------------

const MILES_PER_METER_EXPORT = 1 / 1609.344;

/** App SetType -> Hevy set_type (inverse of hevySetTypeToApp; top_set is
 *  app-only and exports as "normal" — lossy, documented). */
function appSetTypeToHevy(t: string): string {
  switch (t) {
    case 'warmup': return 'warmup';
    case 'drop': return 'dropset';
    case 'failure': return 'failure';
    default: return 'normal';
  }
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** "YYYY-MM-DD HH:mm:ss" (UTC) — parseHevyTimestamp reads this back to the
 *  exact same instant, so a re-import never duplicates sessions. */
function hevyTimestamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

export interface HevyCsvExport {
  workoutsCsv: string;
  measurementsCsv: string;
}

export async function buildHevyCsvExport(): Promise<HevyCsvExport> {
  const [sessions, sets, cardio, exercises, metrics] = await Promise.all([
    db.workout_sessions.toArray(),
    db.workout_sets.toArray(),
    db.cardio_entries.toArray(),
    db.exercises.toArray(),
    db.daily_metrics.toArray(),
  ]);
  const exerciseName = new Map(
    exercises.map((e) => [e.id, e.custom_name ?? (e.wger_id != null ? `wger #${e.wger_id}` : e.id)]),
  );
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const rows: string[][] = [];
  for (const s of sets.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const session = sessionById.get(s.workout_id);
    rows.push([
      session?.notes ?? '',
      hevyTimestamp(s.timestamp),
      session?.end_time ? hevyTimestamp(session.end_time) : '',
      '',
      exerciseName.get(s.exercise_id) ?? '',
      '',
      '',
      String(s.set_order),
      appSetTypeToHevy(s.set_type),
      s.weight != null ? String(s.weight) : '',
      s.reps != null ? String(s.reps) : '',
      '',
      '',
      s.rpe != null ? String(s.rpe) : '',
    ]);
  }
  for (const c of cardio.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const session = sessionById.get(c.workout_id);
    rows.push([
      session?.notes ?? '',
      hevyTimestamp(c.timestamp),
      session?.end_time ? hevyTimestamp(session.end_time) : '',
      '',
      c.activity,
      '',
      c.notes ?? '',
      '0',
      'normal',
      '',
      '',
      c.distance_m != null
        ? String(Math.round(c.distance_m * MILES_PER_METER_EXPORT * 100) / 100)
        : '',
      String(c.duration_seconds),
      '',
    ]);
  }
  rows.sort((a, b) => a[1].localeCompare(b[1]) || a[4].localeCompare(b[4]) || Number(a[7]) - Number(b[7]));
  const workoutsCsv = [
    'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe',
    ...rows.map((r) => r.map(csvCell).join(',')),
  ].join('\n');

  const measurementRows = metrics
    .filter((m) => m.body_weight != null || m.body_fat_pct != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) =>
      [
        m.date,
        m.body_weight != null ? String(m.body_weight) : '',
        m.body_fat_pct != null ? String(m.body_fat_pct) : '',
      ].map(csvCell).join(','),
    );
  const measurementsCsv = [
    'date,weight_lbs,fat_percent',
    ...measurementRows,
  ].join('\n');

  return { workoutsCsv, measurementsCsv };
}

function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** One tap -> two CSV downloads (workout history + measurements). */
export async function downloadHevyCsvExport(): Promise<void> {
  const { workoutsCsv, measurementsCsv } = await buildHevyCsvExport();
  const day = new Date().toISOString().slice(0, 10);
  downloadText(workoutsCsv, `hevy-workouts-${day}.csv`, 'text/csv');
  downloadText(measurementsCsv, `hevy-measurements-${day}.csv`, 'text/csv');
}