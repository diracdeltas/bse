const ID_LIMIT = 5_000_000_000; // loose sanity bound, well above the app's MAX_ID so the two needn't stay in sync
const BOARD_ROWS = 10;
const VOTES_PER_HOUR = 100;
const HOUR_MS = 3_600_000;
const START_RATING = 1500;
const K = 32; // most a single vote can move a rating
const MAX_ATTEMPTS = 5; // recompute-and-retry rounds when concurrent votes touch the same tracks

// Elo: chance that a track rated `a` beats one rated `b`.
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));

// IPv6 users control a whole /64, so bucket by that prefix instead of the full address.
const clientKey = (ip) => {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const before = head ? head.split(':') : [];
  const after = tail ? tail.split(':') : [];
  const groups = [...before, ...Array(8 - before.length - after.length).fill('0'), ...after];
  return groups.slice(0, 4).join(':');
};

const validId = (n) => Number.isSafeInteger(n) && n >= 1 && n <= ID_LIMIT;

const vote = async (request, env, reply) => {
  // Browsers always send Origin on cross-origin POSTs, so this stops other sites from
  // using their visitors' IPs to stuff votes. Scripts can spoof it; the IP limit covers those.
  if (request.headers.get('Origin') !== env.ALLOWED_ORIGIN) return reply({ error: 'forbidden origin' }, 403);

  let body;
  try { body = await request.json(); } catch { /* rejected below */ }
  const { winner, loser } = body ?? {};
  if (!validId(winner) || !validId(loser) || winner === loser) return reply({ error: 'bad ids' }, 400);

  const ip = clientKey(request.headers.get('CF-Connecting-IP') ?? 'unknown');
  const hour = Math.floor(Date.now() / HOUR_MS);
  // Cheap early reject so ordinary over-limit requests cost a read, not a write. Not the real
  // guard: parallel requests can all pass this, so the batch below enforces the cap atomically.
  const used = await env.DB.prepare('SELECT count FROM limits WHERE ip = ? AND hour = ?').bind(ip, hour).first();
  if (used && used.count >= VOTES_PER_HOUR) return reply({ error: 'rate limited' }, 429);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { results: rated } = await env.DB.prepare('SELECT id, rating FROM tracks WHERE id IN (?, ?)').bind(winner, loser).all();
    const before = (id) => rated.find((r) => r.id === id)?.rating ?? null; // null: not rated yet
    const [rw, rl] = [before(winner), before(loser)];
    const delta = K * (1 - expected(rw ?? START_RATING, rl ?? START_RATING));

    // D1 runs a batch as one transaction. The vote rows are written only while this IP is within
    // its cap AND both tracks still have the ratings the delta was computed from. Otherwise
    // concurrent votes would all use the same stale ratings and their deltas would pile up.
    const rows = (id, other, mine, theirs, wins, losses, sign) => env.DB.prepare(
      `INSERT INTO tracks (id, wins, losses, rating) SELECT ?1, ${wins}, ${losses}, ?5 ${sign} ?2
        WHERE (SELECT count FROM limits WHERE ip = ?3) <= ?4
          AND (SELECT rating FROM tracks WHERE id = ?1) IS ?6 AND (SELECT rating FROM tracks WHERE id = ?7) IS ?8
        ON CONFLICT (id) DO UPDATE SET wins = wins + ${wins}, losses = losses + ${losses}, rating = rating ${sign} ?2`,
    ).bind(id, delta, ip, VOTES_PER_HOUR, START_RATING, mine, other, theirs);
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO limits (ip, hour, count) VALUES (?, ?, 1)
        ON CONFLICT (ip) DO UPDATE SET count = CASE WHEN hour = excluded.hour THEN count + 1 ELSE 1 END, hour = excluded.hour`)
        .bind(ip, hour),
      env.DB.prepare('DELETE FROM limits WHERE hour < ?').bind(hour),
      rows(winner, loser, rw, rl, 1, 0, '+'),
      // by now the winner row holds rw + delta, and the same guard still holds for the loser
      rows(loser, winner, rl, (rw ?? START_RATING) + delta, 0, 1, '-'),
    ]);
    if (results[2].meta.changes === 1) return reply({ ok: true });

    const now = await env.DB.prepare('SELECT count FROM limits WHERE ip = ?').bind(ip).first();
    if (now.count > VOTES_PER_HOUR) return reply({ error: 'rate limited' }, 429);
    // otherwise another vote moved one of these ratings first: recompute and try again
  }
  return reply({ error: 'busy, try again' }, 503);
};

const board = async (env, reply) => {
  const { results } = await env.DB
    .prepare('SELECT id, rating, wins, losses FROM tracks WHERE wins > 0 ORDER BY rating DESC LIMIT ?')
    .bind(BOARD_ROWS)
    .all();
  return reply(results);
};

export default {
  async fetch(request, env) {
    if (!env.ALLOWED_ORIGIN) return new Response('ALLOWED_ORIGIN is not configured', { status: 500 });
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const reply = (data, status = 200) => Response.json(data, { status, headers: cors });
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && pathname === '/board') return board(env, reply);
    if (request.method === 'POST' && pathname === '/vote') return vote(request, env, reply);
    return reply({ error: 'not found' }, 404);
  },
};
