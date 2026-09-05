// Exercise stats: plateaus + velocity + baselines + volume series.
import { NextResponse } from "next/server";
import { exerciseDirectory, getAnalytics, seedNow } from "@/lib/server/lab";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = getAnalytics();
  return NextResponse.json({
    seed_now: seedNow(),
    exercises: exerciseDirectory(),
    plateaus: r.plateaus,
    velocity: r.velocity,
    baselines: r.baselines,
    daily_volume: r.daily_volume,
    weekly_volume: r.weekly_volume,
  });
}
