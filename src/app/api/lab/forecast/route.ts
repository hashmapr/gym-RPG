// Goal forecasts: progress + ETA per goal.
import { NextResponse } from "next/server";
import { exerciseDirectory, getAnalytics, seedNow } from "@/lib/server/lab";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    seed_now: seedNow(),
    exercises: exerciseDirectory(),
    ...getAnalytics().forecast,
  });
}
