// Hevy CSV importer — parser + exercise-name matching.
//
// Hevy export format (documented from real exports):
//   Title,Start Time,End Time,Exercise Title,Set Order,Weight (kg),Reps,RPE,Distance,Duration,Notes
// Header matching is case-insensitive with aliases so minor export variations
// still parse. Weight values are used AS-IS unless the user selects kg in the
// import UI (then converted to lb at insert time, not parse time).
//
// DOCUMENTED DECISIONS:
//   - Empty weight (bodyweight rows) -> weight = null.
//   - Empty reps -> the row is SKIPPED and reported in the import summary
//     (a set without reps is not a set; bodyweight rows always carry reps).
//   - RPE: numeric -> number; empty -> null; garbage -> null (never throws).
//   - Timestamps: Hevy writes "YYYY-MM-DD HH:mm:ss UTC" (or ISO). Both parse
//     as UTC instants; seconds are preserved. Sets keep ORIGINAL timestamps.
//   - Dedup: identical (start_time + exercise + weight + reps) rows collapse
//     to one insert, both within the file and against existing local rows.
//   - A garbage data row is skipped + reported; it never aborts the import.
//   - A structurally malformed file (truncated quotes, missing columns)
//     fails BEFORE any insert with an actionable error.

import Papa from 'papaparse';

export interface ParsedSet {
  exerciseName: string; // raw from CSV
  setOrder: number;
  weight: number | null; // as written in the file (unit per user selection)
  reps: number | null;
  rpe: number | null;
  distance: number | null;
  durationSeconds: number | null;
  notes: string | null;
  timestamp: string; // ISO instant of the workout start (set-level precision = start)
}

export interface ParsedWorkout {
  title: string;
  startTime: string; // ISO
  endTime: string | null;
  sets: ParsedSet[];
}

export interface SkippedRow {
  row: number; // 1-based data row index
  reason: string;
}

export interface ParseResult {
  workouts: ParsedWorkout[];
  totalRows: number;
  skipped: SkippedRow[];
}

export class HevyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HevyParseError';
  }
}

const COLUMN_ALIASES: Record<string, string> = {
  title: 'title',
  'start time': 'start_time',
  'end time': 'end_time',
  'exercise title': 'exercise',
  'set order': 'set_order',
  'weight (kg)': 'weight',
  'weight (lb)': 'weight',
  weight: 'weight',
  reps: 'reps',
  rpe: 'rpe',
  distance: 'distance',
  duration: 'duration',
  notes: 'notes',
};

const REQUIRED_COLUMNS = ['start_time', 'exercise', 'reps'];

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase();
  return COLUMN_ALIASES[key] ?? null;
}

/** Parse Hevy timestamps: "2024-01-15 18:30:00 UTC" or ISO 8601. Preserves seconds. */
export function parseHevyTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let normalized = s.replace(/\s+UTC$/i, 'Z').replace(' ', 'T');
  // "2024-01-15T18:30:00" (no zone) -> treat as UTC, matching Hevy's export
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    normalized += normalized.length === 16 ? ':00Z' : 'Z';
  }
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDurationSeconds(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  // Hevy durations look like "9:32" (m:ss) or plain seconds
  const mmss = s.match(/^(\d+):(\d{1,2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseHevyCsv(csvText: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => normalizeHeader(h) ?? h.trim(),
  });

  // Structural failure (truncated file, unterminated quotes) -> fail loudly,
  // before anything is inserted.
  const fatal = (parsed.errors ?? []).filter(
    (e) => e.type === 'Quotes' || e.type === 'Delimiter',
  );
  if (fatal.length > 0) {
    throw new HevyParseError(
      `CSV file appears malformed or truncated (${fatal.length} parse error(s), first: "${fatal[0].message}" near row ${fatal[0].row ?? '?'}). Fix the file and re-upload — nothing was imported.`,
    );
  }

  const rows = parsed.data ?? [];
  if (rows.length === 0) {
    throw new HevyParseError('CSV contains no data rows. Nothing was imported.');
  }

  const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length > 0) {
    throw new HevyParseError(
      `CSV is missing required column(s): ${missing.join(', ')}. Expected Hevy export headers like "Start Time", "Exercise Title", "Reps". Nothing was imported.`,
    );
  }

  const workouts = new Map<string, ParsedWorkout>();
  const skipped: SkippedRow[] = [];
  const seenDedup = new Set<string>();
  let totalRows = 0;

  rows.forEach((row, i) => {
    const rowNumber = i + 1;
    const exerciseName = (row['exercise'] ?? '').toString().trim();
    const startDate = parseHevyTimestamp((row['start_time'] ?? '').toString());

    if (!exerciseName) {
      skipped.push({ row: rowNumber, reason: 'missing exercise name' });
      return;
    }
    if (!startDate) {
      skipped.push({ row: rowNumber, reason: 'unparseable start time' });
      return;
    }

    const repsRaw = (row['reps'] ?? '').toString().trim();
    const reps = parseNumber(repsRaw);
    if (reps == null) {
      // DOCUMENTED: empty/garbage reps -> row skipped + reported.
      skipped.push({ row: rowNumber, reason: 'missing or invalid reps' });
      return;
    }

    totalRows += 1;

    const weight = parseNumber((row['weight'] ?? '').toString()); // null = bodyweight
    const rpe = parseNumber((row['rpe'] ?? '').toString());
    const distance = parseNumber((row['distance'] ?? '').toString());
    const durationSeconds = parseDurationSeconds((row['duration'] ?? '').toString());
    const setOrder = Math.max(1, Math.round(parseNumber((row['set_order'] ?? '').toString()) ?? 1));
    const endTime = parseHevyTimestamp((row['end_time'] ?? '').toString());
    const title = (row['title'] ?? '').toString().trim() || 'Imported workout';

    // Dedup within file: same start_time + exercise + weight + reps -> one insert.
    const dedupKey = [
      startDate.toISOString(),
      normalizeExerciseName(exerciseName),
      weight ?? '',
      reps,
    ].join('|');
    if (seenDedup.has(dedupKey)) return;
    seenDedup.add(dedupKey);

    const workoutKey = startDate.toISOString();
    let workout = workouts.get(workoutKey);
    if (!workout) {
      workout = {
        title,
        startTime: startDate.toISOString(),
        endTime: endTime ? endTime.toISOString() : null,
        sets: [],
      };
      workouts.set(workoutKey, workout);
    }
    workout.endTime = workout.endTime ?? (endTime ? endTime.toISOString() : null);
    workout.sets.push({
      exerciseName,
      setOrder,
      weight,
      reps,
      rpe,
      distance,
      durationSeconds,
      notes: (row['notes'] ?? '').toString().trim() || null,
      timestamp: startDate.toISOString(),
    });
  });

  return { workouts: [...workouts.values()], totalRows, skipped };
}

/**
 * Match a Hevy exercise name to the local library.
 * Confidence: 1.0 exact (normalized), 0.9 normalized contains, 0.6 either
 * direction partial. Returns null when nothing matches.
 */
export function matchExerciseName(
  hevyName: string,
  library: { id: string; name: string }[],
): { exerciseId: string; confidence: number } | null {
  const target = normalizeExerciseName(hevyName);
  if (!target) return null;
  for (const e of library) {
    if (normalizeExerciseName(e.name) === target) {
      return { exerciseId: e.id, confidence: 1.0 };
    }
  }
  for (const e of library) {
    const n = normalizeExerciseName(e.name);
    if (n.includes(target) || target.includes(n)) {
      return { exerciseId: e.id, confidence: 0.9 };
    }
  }
  for (const e of library) {
    const n = normalizeExerciseName(e.name);
    const tWords = target.split(' ');
    const nWords = n.split(' ');
    const overlap = tWords.filter((w) => nWords.includes(w) && w.length > 2);
    if (overlap.length > 0) {
      return { exerciseId: e.id, confidence: 0.6 };
    }
  }
  return null;
}