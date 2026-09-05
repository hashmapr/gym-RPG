// wger public API client — exercise search/discovery ONLY.
// The wger v2 API has no server-side name filter, so the full English
// catalog is pulled once into the local library (Dexie) and searched
// locally. Selected exercises keep their wger ID.
// https://wger.de/api/v2/

import type { Exercise } from './types';
import { db } from './db';

const WGER_BASE = 'https://wger.de/api/v2';
const LANGUAGE_EN = 2;
const PAGE_SIZE = 100;
const CATALOG_FLAG = 'wger_catalog_synced';

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

async function fetchCatalogPage(
  offset: number,
  signal?: AbortSignal,
): Promise<{ count: number; results: WgerExerciseInfo[] }> {
  const url = `${WGER_BASE}/exerciseinfo/?language=${LANGUAGE_EN}&limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`wger catalog failed: ${res.status}`);
  return (await res.json()) as { count: number; results: WgerExerciseInfo[] };
}

/**
 * Pull the full English wger catalog into the local library once. The wger
 * v2 API has no server-side name filter (query params are ignored), so
 * search is done locally over the cached catalog. Idempotent: existing rows
 * keep their ids (workout_sets reference them).
 */
export async function ensureWgerCatalog(signal?: AbortSignal): Promise<void> {
  const flag = await db.settings.get(CATALOG_FLAG);
  if (flag?.value === true) return;

  const first = await fetchCatalogPage(0, signal);
  const pages: WgerExerciseInfo[][] = [first.results];
  const offsets: number[] = [];
  for (let o = PAGE_SIZE; o < first.count; o += PAGE_SIZE) offsets.push(o);
  const rest = await Promise.all(offsets.map((o) => fetchCatalogPage(o, signal)));
  pages.push(...rest.map((p) => p.results));

  const existing = new Map(
    (await db.exercises.filter((e) => e.wger_id !== null).toArray()).map((e) => [
      e.wger_id as number,
      e,
    ]),
  );
  const seen = new Set<number>();
  const fresh: Exercise[] = [];
  for (const page of pages) {
    for (const info of page) {
      const mapped = mapResult(info);
      if (!mapped || seen.has(mapped.wgerId) || existing.has(mapped.wgerId)) continue;
      seen.add(mapped.wgerId);
      fresh.push({
        id: newId(),
        wger_id: mapped.wgerId,
        custom_name: mapped.name,
        category: mapped.category,
        primary_muscle: mapped.primaryMuscle,
        is_custom: false,
        created_at: new Date().toISOString(),
      });
    }
  }
  if (fresh.length > 0) await db.exercises.bulkPut(fresh);
  await db.settings.put({ key: CATALOG_FLAG, value: true });
}

export async function searchWgerExercises(
  query: string,
  signal?: AbortSignal,
): Promise<WgerSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  await ensureWgerCatalog(signal);
  const catalog = await db.exercises
    .filter((e) => e.wger_id !== null)
    .toArray();
  const starts: Exercise[] = [];
  const includes: Exercise[] = [];
  for (const e of catalog) {
    const name = (e.custom_name ?? '').toLowerCase();
    if (name.startsWith(q)) starts.push(e);
    else if (name.includes(q)) includes.push(e);
  }
  return [...starts, ...includes].slice(0, 20).map((e) => ({
    wgerId: e.wger_id as number,
    name: e.custom_name ?? `wger #${e.wger_id}`,
    category: e.category,
    primaryMuscle: e.primary_muscle,
  }));
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