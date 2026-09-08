// Per-exercise Lab detail: plateau + velocity + baseline + e1RM series.
// The e1RM series is per working set (chronological), same e1rm() consensus
// the engine uses — read-only over the snapshot.
import { NextResponse } from "next/server";
import { exerciseDirectory, getAnalytics, seedNow } from "@/lib/server/lab";
import { e1rm } from "@/lib/e1rm";
import { getTrainingDate } from "@/lib/day-boundary";
import type { WorkoutSet } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = getAnalytics();
  const plateau = r.plateaus[id] ?? null;
  const velocity = r.velocity[id] ?? null;
  const baseline = r.baselines.per_exercise[id] ?? null;

  // e1RM series from the snapshot's sets for this exercise.
  const { mockTable } = await import("@/lib/server/mock-db");
  const sets = Array.from(
    mockTable("workout_sets").values() as unknown as Iterable<WorkoutSet>,
  ).filter((s) => s.exercise_id === id && (s.set_type ?? "working") === "working")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const series = sets
    .map((s) => ({
      date: getTrainingDate(new Date(s.timestamp), 4, "UTC"),
      weight: s.weight,
      reps: s.reps,
      e1rm: s.weight != null && s.reps != null ? e1rm(s.weight, s.reps) : null,
    }))
    .filter((p) => p.e1rm != null);

  return NextResponse.json({
    seed_now: seedNow(),
    exercise: exerciseDirectory()[id] ?? null,
    plateau,
    velocity,
    baseline,
    session_count: new Set(sets.map((s) => s.workout_id)).size,
    e1rm_series: series,
  });
}