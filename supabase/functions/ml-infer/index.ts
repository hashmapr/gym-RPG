// Sprint 8a stub — ml-infer edge function. Serves predictions from the
// pinned registry model; empty registry → deterministic baselines.
// Real inference lands in Sprint 8b after the ml_v1 gate passes.

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const { exercise_id, target_date } = body as {
    exercise_id?: string;
    target_date?: string;
  };
  if (!exercise_id || !target_date) {
    return new Response(
      JSON.stringify({ error: 'exercise_id and target_date required' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  // 8a: no model artifacts exist yet — respond with the baseline contract
  // so clients can build against the shape before 8b lands.
  return new Response(
    JSON.stringify({
      model_version: 'deterministic_velocity',
      exercise_id,
      target_date,
      predicted_e1rm: null,
      note: 'ml-infer stub — deterministic baselines run client-side in 8a; server inference arrives with ml_v1 (8b).',
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});