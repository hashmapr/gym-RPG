// Seed status for the DEV SEED banner (settings 'seed_active' + pinned clock).
import { NextResponse } from "next/server";
import { seedActive, seedNow } from "@/lib/server/lab";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ seed_active: seedActive(), seed_now: seedNow() });
}