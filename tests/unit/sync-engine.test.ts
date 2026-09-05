// Sync engine tests with a fake client + fake-indexeddb.
// Invariants: original timestamps, syncedAt marking, retry on failure,
// remote dedup, no silent cap, parent-before-child ordering, kill-safe resume.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncAll, SYNC_TABLE_ORDER, type SyncClient } from '@/lib/sync/engine';
import { LabDB } from '@/lib/db';
import type { WorkoutSession, WorkoutSet, Exercise } from '@/lib/types';

interface Call {
  table: string;
  rows: Record<string, unknown>[];
}

function makeClient(opts: { failOn?: string } = {}) {
  const calls: Call[] = [];
  const remote = new Map<string, Record<string, unknown>>();
  const client: SyncClient & { calls: Call[]; remote: Map<string, Record<string, unknown>> } = {
    name: 'Fake backend',
    calls,
    remote,
    async upsert(table, rows) {
      if (opts.failOn === table) {
        throw new Error(`network failure on ${table}`);
      }
      calls.push({ table, rows });
      for (const r of rows) {
        remote.set(String(r.id ?? r.date), r);
      }
    },
  };
  return client;
}

const session: WorkoutSession = {
  id: 'sess-1',
  gym_id: null,
  session_type: 'strength',
  start_time: '2024-01-15T18:30:05.000Z',
  end_time: '2024-01-15T19:25:00.000Z',
  mood: null,
  energy: null,
  caffeine: null,
  notes: 'Push Day A',
  total_volume: null,
  total_sets: null,
  created_at: '2024-01-15T19:25:00.000Z',
};

const exercise: Exercise = {
  id: 'ex-1',
  wger_id: 123,
  custom_name: 'Barbell Bench Press',
  category: 'Barbell',
  primary_muscle: 'Chest',
  is_custom: false,
  created_at: '2024-01-01T00:00:00.000Z',
};

const mkSet = (id: string, timestamp: string): WorkoutSet => ({
  id,
  workout_id: 'sess-1',
  exercise_id: 'ex-1',
  set_order: 1,
  weight: 102.5,
  reps: 5,
  rpe: 8,
  rir: null,
  tempo: null,
  set_type: 'working',
  rest_before: null,
  rest_after: null,
  duration: null,
  mean_velocity: null,
  peak_velocity: null,
  timestamp,
  source: 'app',
  local_id: id,
  created_at: timestamp,
});

describe('sync engine', () => {
  let db: LabDB;

  beforeEach(async () => {
    db = new LabDB();
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('pushes unsynced rows with their ORIGINAL timestamp', async () => {
    await db.workout_sessions.put(session);
    await db.workout_sets.put(mkSet('set-1', '2024-01-15T18:31:00.000Z'));
    const client = makeClient();
    await syncAll(db, client);
    const pushedSet = client.remote.get('set-1') as Record<string, unknown>;
    expect(pushedSet.timestamp).toBe('2024-01-15T18:31:00.000Z');
    expect(pushedSet.syncedAt).toBeUndefined();
  });

  it('successful push sets syncedAt; row is not re-pushed next cycle', async () => {
    await db.workout_sessions.put(session);
    const client = makeClient();
    await syncAll(db, client);
    const stored = await db.workout_sessions.get('sess-1');
    expect(stored?.syncedAt).toBeTruthy();
    client.calls.length = 0;
    await syncAll(db, client);
    expect(client.calls.length).toBe(0);
  });

  it('network failure mid-push → rows remain unsynced, retried next cycle', async () => {
    await db.workout_sessions.put(session);
    const failing = makeClient({ failOn: 'workout_sessions' });
    const r1 = await syncAll(db, failing);
    expect(r1.failed).toBe(1);
    expect((await db.workout_sessions.get('sess-1'))?.syncedAt).toBeUndefined();
    const working = makeClient();
    const r2 = await syncAll(db, working);
    expect(r2.pushed).toBe(1);
    expect(working.remote.has('sess-1')).toBe(true);
  });

  it('duplicate local_id → no duplicate row in remote (upsert dedup)', async () => {
    await db.workout_sets.put(mkSet('set-1', '2024-01-15T18:31:00.000Z'));
    const client = makeClient();
    // Simulate a kill after push but before syncedAt marking: push twice.
    await syncAll(db, client);
    await db.workout_sets.update('set-1', { syncedAt: undefined });
    await syncAll(db, client);
    const setCalls = client.calls.filter((c) => c.table === 'workout_sets');
    expect(setCalls.length).toBe(2);
    expect(client.remote.size).toBe(1); // deduped by id
  });

  it('500 queued sets → all push (batched, no silent cap)', async () => {
    await db.workout_sessions.put(session);
    await db.workout_sets.bulkPut(
      Array.from({ length: 500 }, (_, i) =>
        mkSet(`set-${i}`, `2024-01-15T18:31:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`),
      ),
    );
    const client = makeClient();
    const r = await syncAll(db, client, { batchSize: 200 });
    expect(r.pushed).toBe(501); // 500 sets + 1 parent session
    expect(client.remote.size).toBe(501);
  });

  it('parent workout_sessions sync BEFORE their children (FK ordering)', async () => {
    await db.exercises.put(exercise);
    await db.workout_sessions.put(session);
    await db.workout_sets.put(mkSet('set-1', '2024-01-15T18:31:00.000Z'));
    const client = makeClient();
    await syncAll(db, client);
    const order = client.calls.map((c) => c.table);
    expect(order.indexOf('workout_sessions')).toBeLessThan(
      order.indexOf('workout_sets'),
    );
    expect(order.indexOf('exercises')).toBeLessThan(
      order.indexOf('workout_sets'),
    );
    expect(SYNC_TABLE_ORDER.indexOf('workout_sessions')).toBeLessThan(
      SYNC_TABLE_ORDER.indexOf('workout_sets'),
    );
  });

  it('app killed mid-sync → next launch resumes without data loss or duplicates', async () => {
    await db.workout_sessions.put(session);
    await db.workout_sets.put(mkSet('set-1', '2024-01-15T18:31:00.000Z'));
    // First cycle: sessions sync, then the process "dies" during sets.
    const dying = makeClient({ failOn: 'workout_sets' });
    await syncAll(db, dying);
    expect((await db.workout_sessions.get('sess-1'))?.syncedAt).toBeTruthy();
    expect((await db.workout_sets.get('set-1'))?.syncedAt).toBeUndefined();
    // Next launch: only the unsynced set pushes; session not duplicated.
    const client = makeClient();
    await syncAll(db, client);
    const sessionCalls = client.calls.filter(
      (c) => c.table === 'workout_sessions',
    );
    expect(sessionCalls.length).toBe(0);
    expect(client.remote.get('set-1')).toBeDefined();
    expect(client.remote.size).toBe(1);
  });
});