// Generates tests/golden/*.golden.json from the deterministic seed fixture.
//
// IMPORTANT: these computations are deliberately INDEPENDENT of the analytics
// engine (src/lib/analytics) — they reuse only the locked Sprint 1 primitives
// (e1rm, evaluatePR, setVolume, getTrainingDate) and re-derive everything else
// with straightforward code. If engine output and goldens disagree, the
// GOLDENS WIN and the engine is wrong.
//
// Run: npm run seed:dev && npx tsx scripts/generate-goldens.ts

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { e1rm } from '../src/lib/e1rm';
import { evaluatePR } from '../src/lib/pr';
import { setVolume } from '../src/lib/volume';
import { getTrainingDate } from '../src/lib/day-boundary';

interface Row {
  [k: string]: unknown;
}

const ROOT = resolve(__dirname, '..');
const db = JSON.parse(readFileSync(resolve(ROOT, 'mock-db.json'), 'utf8')) as {
  tables: Record<string, Row[]>;
};

const exercises = db.tables.exercises as Row[];
const sessions = db.tables.workout_sessions as Row[];
const sets = db.tables.workout_sets as Row[];
const goals = db.tables.goals as Row[];
const settings = db.tables.settings as Row[];

const seedNowRow = settings.find((s) => s.key === 'seed_now');
const NOW = String(seedNowRow?.value ?? new Date().toISOString());
const today = getTrainingDate(new Date(NOW), 4, 'UTC');

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (!xs.length) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

const DAY = 86400000;
const shift = (iso: string, days: number) =>
  new Date(new Date(iso).getTime() + days * DAY).toISOString();
const dateShift = (d: string, days: number) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
const mondayOf = (d: string) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
};

// ---- shared naive prep (independent of engine internals) ----
const working = sets
  .filter((s) => (s.set_type ?? 'working') === 'working' && s.weight != null && s.reps != null)
  .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

const tDateOfSet = new Map<string, string>();
for (const s of working) tDateOfSet.set(String(s.id), getTrainingDate(new Date(String(s.timestamp)), 4, 'UTC'));

// Analytics only speaks about exercises the athlete actually trains —
// the exercises table may carry catalog entries with no logged sets.
const trainedExercises = exercises.filter((e) => working.some((s) => String(s.exercise_id) === String(e.id)));

const sessionsSorted = [...sessions].sort((a, b) =>
  String(a.start_time).localeCompare(String(b.start_time)),
);
const tDateOfSession = new Map<string, string>();
for (const s of sessionsSorted)
  tDateOfSession.set(String(s.id), getTrainingDate(new Date(String(s.start_time)), 4, 'UTC'));

const setsOfSession = new Map<string, Row[]>();
for (const s of working) {
  const k = String(s.workout_id);
  if (!setsOfSession.has(k)) setsOfSession.set(k, []);
  setsOfSession.get(k)!.push(s);
}

const setsOfExercise = new Map<string, Row[]>();
for (const s of working) {
  const k = String(s.exercise_id);
  if (!setsOfExercise.has(k)) setsOfExercise.set(k, []);
  setsOfExercise.get(k)!.push(s);
}

// sessions per exercise, chronological
const sessionsOfExercise = new Map<string, Row[]>();
for (const s of sessionsSorted) {
  for (const set of setsOfSession.get(String(s.id)) ?? []) {
    const ex = String(set.exercise_id);
    const list = sessionsOfExercise.get(ex) ?? [];
    if (!list.includes(s)) list.push(s);
    sessionsOfExercise.set(ex, list);
  }
}

const sessionBestE = new Map<string, number>(); // key: `${sessionId}|${exerciseId}`
const sessionTopW = new Map<string, number>(); // key: `${sessionId}|${exerciseId}`
const sessionTopRpe = new Map<string, number | null>(); // key: `${sessionId}|${exerciseId}`
const sessionTopRpeAll = new Map<string, number | null>(); // key: sessionId (top set across exercises)
for (const [sid, list] of setsOfSession) {
  const byEx = new Map<string, Row[]>();
  for (const s of list) {
    const k = String(s.exercise_id);
    if (!byEx.has(k)) byEx.set(k, []);
    byEx.get(k)!.push(s);
  }
  for (const [exId, exSets] of byEx) {
    let best = 0;
    let topW = -Infinity;
    let topRpe: number | null = null;
    for (const s of exSets) {
      const e = e1rm(s.weight as number, s.reps as number);
      if (e != null && e > best) best = e;
      if ((s.weight as number) > topW) {
        topW = s.weight as number;
        topRpe = (s.rpe as number | null) ?? null;
      }
    }
    sessionBestE.set(`${sid}|${exId}`, best);
    sessionTopW.set(`${sid}|${exId}`, topW);
    sessionTopRpe.set(`${sid}|${exId}`, topRpe);
  }
  let allTopW = -Infinity;
  let allTopRpe: number | null = null;
  for (const s of list) {
    if ((s.weight as number) > allTopW) {
      allTopW = s.weight as number;
      allTopRpe = (s.rpe as number | null) ?? null;
    }
  }
  sessionTopRpeAll.set(sid, allTopRpe);
}

// PRs over full history
const prIds = new Set<string>();
for (const [, list] of setsOfExercise) {
  const hist: Row[] = [];
  for (const s of list) {
    if (evaluatePR(s as never, hist as never).isPR) prIds.add(String(s.id));
    hist.push(s);
  }
}

const weekTonnage = new Map<string, number>();
const weekSets = new Map<string, number>();
for (const s of working) {
  const ws = mondayOf(tDateOfSet.get(String(s.id)) as string);
  weekTonnage.set(ws, (weekTonnage.get(ws) ?? 0) + setVolume(s.weight as number, s.reps as number));
  weekSets.set(ws, (weekSets.get(ws) ?? 0) + 1);
}
const allWeeks = [...weekTonnage.keys()].sort();
const completeWeeks = allWeeks.filter((ws) => dateShift(ws, 6) <= today);

// ---- 1. plateaus ----
const plateaus: Record<string, unknown> = {};
for (const ex of trainedExercises) {
  const id = String(ex.id);
  const ses = sessionsOfExercise.get(id) ?? [];
  if (ses.length < 6) {
    plateaus[id] = { status: 'insufficient_data', best_a: null, best_b: null, ratio: null };
    continue;
  }
  const bestA = Math.max(...ses.slice(-3).map((s) => sessionBestE.get(`${String(s.id)}|${id}`) ?? 0));
  const bestB = Math.max(...ses.slice(-6, -3).map((s) => sessionBestE.get(`${String(s.id)}|${id}`) ?? 0));
  const ratio = bestB > 0 ? bestA / bestB : 0;
  plateaus[id] = {
    status: ratio < 0.99 ? 'regressing' : ratio < 1.01 ? 'plateau' : 'progressing',
    best_a: r4(bestA),
    best_b: r4(bestB),
    ratio: r4(ratio),
  };
}

// ---- 2. velocity (84d window) ----
const velocity: Record<string, unknown> = {};
const vFrom = dateShift(today, -83);
for (const ex of trainedExercises) {
  const id = String(ex.id);
  const ses = (sessionsOfExercise.get(id) ?? []).filter(
    (s) => (tDateOfSession.get(String(s.id)) as string) >= vFrom && (tDateOfSession.get(String(s.id)) as string) <= today,
  );
  if (ses.length < 4) {
    velocity[id] = null;
    continue;
  }
  const pts = ses.map((s) => ({
    x: Math.round((new Date(`${tDateOfSession.get(String(s.id))}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY),
    y: sessionBestE.get(`${String(s.id)}|${id}`) ?? 0,
  }));
  const n = pts.length;
  const mx = avg(pts.map((p) => p.x));
  const my = avg(pts.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  const slope = (sxy / sxx) * 7;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  velocity[id] = {
    slope_per_week: r4(slope),
    r2: r4(r2),
    status: slope >= 1 ? 'progressing' : slope <= -1 ? 'declining' : 'stalled',
    sessions: n,
  };
}

// ---- 3. anomalies ----
const sessionAnomalies: unknown[] = [];
const perExerciseBaseline: Record<string, unknown> = {};
const aFrom = dateShift(today, -55);
for (const ex of trainedExercises) {
  const id = String(ex.id);
  const ses = (sessionsOfExercise.get(id) ?? []).filter(
    (s) => (tDateOfSession.get(String(s.id)) as string) >= aFrom && (tDateOfSession.get(String(s.id)) as string) <= today,
  );
  const tops = ses.map((s) => sessionTopW.get(`${String(s.id)}|${id}`) as number);
  const rpes = ses.map((s) => sessionTopRpe.get(`${String(s.id)}|${id}`)).filter((r) => r != null) as number[];
  perExerciseBaseline[id] = {
    top_weight_mean: r4(avg(tops)),
    top_weight_std: r4(sd(tops)),
    rpe_mean: r4(avg(rpes)),
    rpe_std: r4(sd(rpes)),
  };
  for (let i = 0; i < ses.length; i++) {
    const others = tops.filter((_, j) => j !== i);
    if (others.length < 4) continue;
    const s = sd(others);
    if (s === 0) continue;
    const z = (tops[i] - avg(others)) / s;
    if (Math.abs(z) >= 2) {
      sessionAnomalies.push({
        exercise_id: id,
        session_id: String(ses[i].id),
        training_date: tDateOfSession.get(String(ses[i].id)),
        top_weight: r4(tops[i]),
        z: r4(z),
        direction: z < 0 ? 'low' : 'high',
      });
    }
  }
}

const volumeAnomalies: unknown[] = [];
for (let i = 0; i < completeWeeks.length; i++) {
  const prior: number[] = [];
  for (let j = Math.max(0, i - 8); j < i; j++) prior.push(weekTonnage.get(completeWeeks[j]) as number);
  if (prior.length < 4) continue;
  const s = sd(prior);
  if (s === 0) continue;
  const t = weekTonnage.get(completeWeeks[i]) as number;
  const z = (t - avg(prior)) / s;
  if (Math.abs(z) >= 2) {
    volumeAnomalies.push({
      week_start: completeWeeks[i],
      tonnage: r4(t),
      z: r4(z),
      direction: z < 0 ? 'low' : 'high',
    });
  }
}

// ---- 4. landmarks ----
// Only muscles the athlete actually trains (≥1 working set in history) —
// the exercises table may carry catalog entries that never appear in logs.
const muscles = [
  ...new Set(
    working
      .map((s) => String(exercises.find((e) => String(e.id) === String(s.exercise_id))?.primary_muscle))
      .filter((m) => m && m !== 'undefined'),
  ),
].sort() as string[];
const firstWeek = allWeeks[0] ?? mondayOf(today);
const currentWeek = mondayOf(today);
const landmarkWeeks: unknown[] = [];
for (let ws = firstWeek; ws <= currentWeek; ws = dateShift(ws, 7)) {
  const we = dateShift(ws, 6);
  const entry: { week_start: string; muscles: Record<string, unknown> } = { week_start: ws, muscles: {} };
  for (const m of muscles) {
    const n = working.filter(
      (s) =>
        (tDateOfSet.get(String(s.id)) as string) >= ws &&
        (tDateOfSet.get(String(s.id)) as string) <= we &&
        String(exercises.find((e) => String(e.id) === String(s.exercise_id))?.primary_muscle) === m,
    ).length;
    entry.muscles[m] = {
      sets: n,
      zone: n < 6 ? 'undertrained' : n <= 9 ? 'low' : n <= 20 ? 'optimal' : n <= 25 ? 'high' : 'very_high',
    };
  }
  landmarkWeeks.push(entry);
}
const neglected: unknown[] = [];
for (const m of muscles) {
  let zeros = 0;
  for (let i = completeWeeks.length - 1; i >= 0; i--) {
    const ws = completeWeeks[i];
    const we = dateShift(ws, 6);
    const n = working.filter(
      (s) =>
        (tDateOfSet.get(String(s.id)) as string) >= ws &&
        (tDateOfSet.get(String(s.id)) as string) <= we &&
        String(exercises.find((e) => String(e.id) === String(s.exercise_id))?.primary_muscle) === m,
    ).length;
    if (n === 0) zeros++;
    else break;
  }
  if (zeros >= 2) neglected.push({ muscle: m, weeks_zero: zeros });
}

// ---- 5. compare ----
const y = today.slice(0, 4);
const mth = today.slice(5, 7);
const ranges: Record<string, { cf: string; ct: string; pf: string; pt: string }> = {
  month: { cf: `${y}-${mth}-01`, ct: today, pf: dateShift(`${y}-${mth}-01`, -1).slice(0, 7) + '-01', pt: dateShift(`${y}-${mth}-01`, -1) },
  week: { cf: dateShift(today, -6), ct: today, pf: dateShift(today, -13), pt: dateShift(today, -7) },
  year: { cf: `${y}-01-01`, ct: today, pf: `${Number(y) - 1}-01-01`, pt: `${Number(y) - 1}-12-31` },
};

const metricsFor = (from: string, to: string) => {
  const ses = sessionsSorted.filter((s) => (tDateOfSession.get(String(s.id)) as string) >= from && (tDateOfSession.get(String(s.id)) as string) <= to);
  const sesSets = working.filter((s) => (tDateOfSet.get(String(s.id)) as string) >= from && (tDateOfSet.get(String(s.id)) as string) <= to);
  const durs = ses.filter((s) => s.end_time != null).map((s) => (new Date(String(s.end_time)).getTime() - new Date(String(s.start_time)).getTime()) / 60000);
  const rpes = ses.map((s) => sessionTopRpeAll.get(String(s.id))).filter((r) => r != null) as number[];
  const perEx: Record<string, { best: number | null }> = {};
  for (const ex of exercises) {
    const exSets = sesSets.filter((s) => String(s.exercise_id) === String(ex.id));
    if (exSets.length === 0) continue;
    let best: number | null = null;
    for (const s of exSets) {
      const e = e1rm(s.weight as number, s.reps as number);
      if (e != null && (best == null || e > best)) best = e;
    }
    perEx[String(ex.id)] = { best: best == null ? null : r4(best) };
  }
  return {
    workout_count: ses.length,
    total_volume: r4(sesSets.reduce((sum, s) => sum + setVolume(s.weight as number, s.reps as number), 0)),
    total_sets: sesSets.length,
    avg_session_duration_min: durs.length ? r4(avg(durs)) : null,
    pr_count: sesSets.filter((s) => prIds.has(String(s.id))).length,
    avg_top_set_rpe: rpes.length ? r4(avg(rpes)) : null,
    per_exercise_e1rm: perEx,
  };
};

const compare: Record<string, unknown> = {};
for (const [k, r] of Object.entries(ranges)) {
  const cur = metricsFor(r.cf, r.ct);
  const prev = metricsFor(r.pf, r.pt);
  const isNew = prev.workout_count === 0;
  const pct = (a: number, b: number) => (b > 0 ? r4((a - b) / b) : null);
  const delta: Record<string, unknown> = {};
  for (const [exId, c] of Object.entries(cur.per_exercise_e1rm)) {
    const p = prev.per_exercise_e1rm[exId];
    if (p?.best != null && c.best != null)
      delta[exId] = { delta: r4(c.best - p.best), best: c.best, prev_best: p.best };
  }
  compare[k] = {
    current: cur,
    previous: prev,
    is_new: isNew,
    volume_pct_change: isNew ? null : pct(cur.total_volume, prev.total_volume),
    workout_count_pct_change: isNew ? null : pct(cur.workout_count, prev.workout_count),
    per_exercise_e1rm_delta: delta,
  };
}

// ---- 6. forecast ----
const forecastGoals = goals.map((g) => {
  const list = setsOfExercise.get(String(g.exercise_id)) ?? [];
  let achievedAt: string | null = null;
  let bestAtTarget = 0;
  let bestE = 0;
  for (const s of list) {
    const w = s.weight as number;
    const reps = s.reps as number;
    if (w >= (g.target_weight as number) && reps >= (g.target_reps as number)) {
      if (!achievedAt || String(s.timestamp) < achievedAt) achievedAt = String(s.timestamp);
    }
    if (reps >= (g.target_reps as number) && w > bestAtTarget) bestAtTarget = w;
    const e = e1rm(w, reps);
    if (e != null && e > bestE) bestE = e;
  }
  const v = velocity[String(g.exercise_id)] as { slope_per_week: number } | null;
  const slope = v?.slope_per_week ?? null;
  let eta: number | null = null;
  if (slope != null && slope > 0.25) {
    const tE = e1rm(g.target_weight as number, g.target_reps as number);
    if (tE != null) eta = Math.max(0, (tE - bestE) / slope);
  }
  return {
    goal_id: String(g.id),
    exercise_id: String(g.exercise_id),
    target_weight: g.target_weight,
    target_reps: g.target_reps,
    achieved: achievedAt != null,
    achieved_at: achievedAt,
    progress_pct: r4((bestAtTarget / (g.target_weight as number)) * 100),
    eta_weeks: eta == null ? null : r4(eta),
    projection: eta == null ? 'no_reliable_projection' : 'reliable',
  };
});

// ---- write ----
const outDir = resolve(ROOT, 'tests/golden');
mkdirSync(outDir, { recursive: true });
const files: Record<string, unknown> = {
  'plateaus.golden.json': plateaus,
  'velocity.golden.json': velocity,
  'anomalies.golden.json': { sessions: sessionAnomalies, volume: volumeAnomalies },
  'landmarks.golden.json': { weeks: landmarkWeeks, neglected },
  'compare.golden.json': compare,
  'forecast.golden.json': { goals: forecastGoals },
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(resolve(outDir, name), JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote tests/golden/${name}`);
}
console.log(`now=${NOW} today=${today} completeWeeks=${completeWeeks.length}`);