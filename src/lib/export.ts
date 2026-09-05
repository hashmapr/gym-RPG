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