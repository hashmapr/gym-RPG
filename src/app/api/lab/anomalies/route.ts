// Anomalies: unusual sessions + volume spikes/dips.
import { NextResponse } from "next/server";
import { getAnalytics, seedNow } from "@/lib/server/lab";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ seed_now: seedNow(), ...getAnalytics().anomalies });
}
