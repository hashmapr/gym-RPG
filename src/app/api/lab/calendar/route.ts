// Calendar: daily + weekly training volume.
import { NextResponse } from "next/server";
import { getAnalytics, seedNow } from "@/lib/server/lab";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = getAnalytics();
  return NextResponse.json({
    seed_now: seedNow(),
    daily_volume: r.daily_volume,
    weekly_volume: r.weekly_volume,
  });
}
