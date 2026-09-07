// Hevy CSV importer — parser + exercise-name matching.
//
// Hevy export format (documented from real exports):
//   Synthetic fixture: Title,Start Time,End Time,Exercise Title,Set Order,Weight (kg),Reps,RPE,Distance,Duration,Notes
//   Real app export:   title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe
// Header matching is case-insensitive with aliases so both shapes parse.
// Weight values are used AS-IS unless the user selects kg in the import UI
// (then converted to lb at insert time, not parse time).
//
// DOCUMENTED DECISIONS:
//   - Empty weight (bodyweight rows) -> weight = null.
//   - Empty reps + duration present -> CARDIO row (M1): routed to
//     ParsedWorkout.cardio (Treadmill / Stair Machine), distance null when
//     absent, duration preserved as-is (anomalies included).
//   - Empty reps + no duration -> the row is SKIPPED and reported in the
//     import summary (a set without reps is not a set).
//   - RPE: numeric -> number; empty -> null; garbage -> null (never throws).
//     The user's real export has RPE empty everywhere -> rpe_missing=true
//     downstream (0.7 factor).
//   - Timestamps: "YYYY-MM-DD HH:mm:ss UTC", ISO 8601, or Hevy's real
//     "d MMM yyyy, HH:mm" (e.g. "6 Sep 2026, 15:52"). All parse as UTC
//     instants; seconds are preserved. Sets keep ORIGINAL timestamps.
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
  /** Raw Hevy set_type: warmup | normal | dropset | failure | null. */
  setType: string | null;
  timestamp: string; // ISO instant of the workout start (set-level precision = start)
}

export interface ParsedCardio {
  exerciseName: string;
  setOrder: number;
  durationSeconds: number | null;
  distance: number | null; // miles as written; null when absent
  notes: string | null;
  timestamp: string;
}

export interface ParsedWorkout {
  title: string;
  startTime: string; // ISO
  endTime: string | null;
  sets: ParsedSet[];
  cardio: ParsedCardio[];
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
  start_time: 'start_time',
  'end time': 'end_time',
  end_time: 'end_time',
  description: 'description',
  'exercise title': 'exercise',
  exercise_title: 'exercise',
  superset_id: 'superset_id',
  'set order': 'set_order',
  set_index: 'set_order',
  exercise_notes: 'notes',
  set_type: 'set_type',
  'weight (kg)': 'weight',
  'weight (lb)': 'weight',
  weight_lbs: 'weight',
  weight: 'weight',
  reps: 'reps',
  rpe: 'rpe',
  distance: 'distance',
  distance_miles: 'distance',
  duration: 'duration',
  duration_seconds: 'duration',
  notes: 'notes',
  // measurement_data.csv
  date: 'date',
  fat_percent: 'fat_percent',
};

const REQUIRED_COLUMNS = ['start_time', 'exercise', 'reps'];

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase();
  return COLUMN_ALIASES[key] ?? null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse Hevy timestamps: "2024-01-15 18:30:00 UTC", ISO 8601, or the real
 * app export's "d MMM yyyy, HH:mm" (e.g. "6 Sep 2026, 15:52"). Preserves
 * seconds when present. All forms are treated as UTC instants.
 */
export function parseHevyTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  // "6 Sep 2026, 15:52" (also tolerates no comma / seconds)
  const dmy = s.match(/^(\d{1,2}) ([A-Za-z]{3,}) (\d{4})(?:,)? (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dmy) {
    const month = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (month != null) {
      return new Date(
        Date.UTC(
          Number(dmy[3]),
          month,
          Number(dmy[1]),
          Number(dmy[4]),
          Number(dmy[5]),
          dmy[6] ? Number(dmy[6]) : 0,
        ),
      );
    }
  }
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

/** App SetType values (types.ts). */
export type AppSetType = 'warmup' | 'working' | 'drop' | 'top_set' | 'failure';

/**
 * Map Hevy's set_type to the app's SetType. normal→working, dropset→drop,
 * warmup→warmup, failure→failure; missing/unknown→working. (top_set is
 * app-only; it exports as "normal" — lossy, documented.)
 */
export function hevySetTypeToApp(raw: string | null | undefined): AppSetType {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'warmup':
      return 'warmup';
    case 'dropset':
      return 'drop';
    case 'failure':
      return 'failure';
    default:
      return 'working';
  }
}

export function parseHevyCsv(csvText: string): ParseResult {
  // Normalize line endings first: Papa glues a bare-LF row to the next row
  // when the header was CRLF-terminated (mixed-endings exports lose rows).
  const normalized = csvText.replace(/\r\n?/g, '\n');
  const parsed = Papa.parse<Record<string, string>>(normalized, {
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
    const weight = parseNumber((row['weight'] ?? '').toString()); // null = bodyweight
    const rpe = parseNumber((row['rpe'] ?? '').toString());
    const distance = parseNumber((row['distance'] ?? '').toString());
    const durationSeconds = parseDurationSeconds((row['duration'] ?? '').toString());
    const endTime = parseHevyTimestamp((row['end_time'] ?? '').toString());
    const title = (row['title'] ?? '').toString().trim() || 'Imported workout';
    const notes = (row['notes'] ?? '').toString().trim() || null;

    // M1: cardio rows (empty reps + duration present — Treadmill / Stair
    // Machine) route to cardio_entries, not workout_sets. Distance stays
    // null when the export has none; duration is preserved as-is.
    if (reps == null && durationSeconds != null) {
      totalRows += 1;
      // No parse-level dedup: repeated identical cardio rows in one workout
      // (e.g. 6 × Treadmill 600s, all set_index 0) are legitimate separate
      // entries. Re-import dedup happens at insert time (activity + duration).
      const setOrder = Math.max(
        0,
        Math.round(parseNumber((row['set_order'] ?? '').toString()) ?? 0),
      );
      const workoutKey = startDate.toISOString();
      let workout = workouts.get(workoutKey);
      if (!workout) {
        workout = {
          title,
          startTime: startDate.toISOString(),
          endTime: endTime ? endTime.toISOString() : null,
          sets: [],
          cardio: [],
        };
        workouts.set(workoutKey, workout);
      }
      workout.endTime = workout.endTime ?? (endTime ? endTime.toISOString() : null);
      workout.cardio.push({
        exerciseName,
        setOrder,
        durationSeconds,
        distance,
        notes,
        timestamp: startDate.toISOString(),
      });
      return;
    }

    if (reps == null) {
      // DOCUMENTED: empty/garbage reps -> row skipped + reported.
      skipped.push({ row: rowNumber, reason: 'missing or invalid reps' });
      return;
    }

    totalRows += 1;

    // set_index is 0-based in real Hevy exports — preserve it as-is.
    const setOrder = Math.max(0, Math.round(parseNumber((row['set_order'] ?? '').toString()) ?? 0));
    const setTypeRaw = (row['set_type'] ?? '').toString().trim().toLowerCase();

    // Dedup within file: same start_time + exercise + set_index + weight +
    // reps -> one insert. set_index is required in the key: real exports
    // repeat identical weight×reps across sets (3 × 42.5×10) and warmup
    // rows that mirror the working weight — only the index distinguishes
    // them. (Verified: set_index is unique per workout+exercise in Hevy.)
    const dedupKey = [
      startDate.toISOString(),
      normalizeExerciseName(exerciseName),
      setOrder,
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
        cardio: [],
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
      notes,
      setType: setTypeRaw || null,
      timestamp: startDate.toISOString(),
    });
  });

  return { workouts: [...workouts.values()], totalRows, skipped };
}

export interface ParsedMeasurement {
  /** YYYY-MM-DD (date part of the measurement timestamp). */
  date: string;
  weightLbs: number | null;
  fatPct: number | null;
}

/**
 * Parse Hevy's measurement_data.csv (M1): date,weight_lbs,fat_percent,...
 * Timestamps are "d MMM yyyy, HH:mm"; only the date part is kept (one
 * daily_metrics row per day). Garbage rows are skipped silently — the
 * measurement file is auxiliary and never aborts an import.
 */
export function parseMeasurementsCsv(csvText: string): ParsedMeasurement[] {
  const normalized = csvText.replace(/\r\n?/g, '\n');
  const parsed = Papa.parse<Record<string, string>>(normalized, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => normalizeHeader(h) ?? h.trim(),
  });
  const rows = parsed.data ?? [];
  if (rows.length === 0 || !('date' in rows[0])) return [];

  const out: ParsedMeasurement[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ts = parseHevyTimestamp((row['date'] ?? '').toString());
    if (!ts) continue;
    const date = ts.toISOString().slice(0, 10);
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({
      date,
      weightLbs: parseNumber((row['weight'] ?? '').toString()),
      fatPct: parseNumber((row['fat_percent'] ?? '').toString()),
    });
  }
  return out;
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