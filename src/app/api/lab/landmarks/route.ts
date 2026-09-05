// Landmarks: weekly sets per muscle + neglected muscles.
import { NextResponse } from "next/server";
import { getAnalytics, seedNow } from "@/lib/server/lab";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ seed_now: seedNow(), ...getAnalytics().landmarks });
}
