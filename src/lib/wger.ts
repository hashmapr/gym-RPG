// wger public API client — exercise search/discovery ONLY.
// Selected exercises are cached locally (Dexie) with their wger ID.
// https://wger.de/api/v2/

import type { Exercise } from './types';
import { db } from './db';

const WGER_BASE = 'https://wger.de/api/v2';
const LANGUAGE_EN = 2;

export interface WgerSearchResult {
  wgerId: number;
  name: string;
  category: string | null;
  primaryMuscle: string | null;
}

interface WgerMuscle {
  id: number;
  name: string;
  name_en?: string;
}

interface WgerExerciseInfo {
  id: number;
  category: { id: number; name: string } | null;
  muscles: WgerMuscle[];
  translations: { name: string; language: number }[];
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function mapResult(r: WgerExerciseInfo): WgerSearchResult | null {
  const en = r.translations.find((t) => t.language === LANGUAGE_EN);
  const name = (en ?? r.translations[0])?.name?.trim();
  if (!name || !r.id) return null;
  const m = r.muscles?.[0];
  return {
    wgerId: r.id,
    name,
    category: r.category?.name ?? null,
    primaryMuscle: m ? (m.name_en ?? m.name) : null,
  };
}

export async function searchWgerExercises(
  query: string,
  signal?: AbortSignal,
): Promise<WgerSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${WGER_BASE}/exerciseinfo/?language=${LANGUAGE_EN}&search=${encodeURIComponent(q)}&limit=20`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`wger search failed: ${res.status}`);
  const data = (await res.json()) as { results: WgerExerciseInfo[] };
  const seen = new Set<number>();
  const out: WgerSearchResult[] = [];
  for (const r of data.results ?? []) {
    const mapped = mapResult(r);
    if (mapped && !seen.has(mapped.wgerId)) {
      seen.add(mapped.wgerId);
      out.push(mapped);
    }
  }
  return out;
}

/** Persist a selected wger exercise into the local library (idempotent by wger_id). */
export async function cacheWgerExercise(sel: WgerSearchResult): Promise<Exercise> {
  const existing = await db.exercises.where('wger_id').equals(sel.wgerId).first();
  if (existing) return existing;
  const row: Exercise = {
    id: newId(),
    wger_id: sel.wgerId,
    custom_name: sel.name, // English display name from wger
    category: sel.category,
    primary_muscle: sel.primaryMuscle,
    is_custom: false,
    created_at: new Date().toISOString(),
  };
  await db.exercises.put(row);
  return row;
}

/** Create a local custom exercise (no wger id). */
export async function createCustomExercise(name: string): Promise<Exercise> {
  const row: Exercise = {
    id: newId(),
    wger_id: null,
    custom_name: name.trim(),
    category: null,
    primary_muscle: null,
    is_custom: true,
    created_at: new Date().toISOString(),
  };
  await db.exercises.put(row);
  return row;
}

/** Display name for an exercise row. */
export function exerciseName(e: Exercise): string {
  return e.custom_name ?? `wger #${e.wger_id}`;
}