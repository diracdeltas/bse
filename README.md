# Greatest Track Ever

let's vote for the best track on all of soundcloud

## Setup

Needs a free Cloudflare account. Run these in `worker/`:

1. `npx wrangler login`
2. `npx wrangler d1 create greatest-track`, then paste the `database_id` into `wrangler.toml`.
3. Set `ALLOWED_ORIGIN` in `wrangler.toml` to your site's origin, e.g. `https://you.github.io`.
4. `npx wrangler d1 execute greatest-track --remote --file=schema.sql`
5. `npx wrangler deploy`
6. Put the printed `*.workers.dev` URL in `API` at the top of `app.js` and in the CSP `connect-src` in `index.html`.
7. Serve the folder (e.g. GitHub Pages, branch deploy).

## Raising `MAX_ID`

New tracks get new IDs, so `MAX_ID` in `app.js` needs to grow over time. Every few months:

1. Run `node scripts/max-id.mjs`.
2. Open the URL it prints in any browser and leave the tab open. It samples 100M-wide ID windows upward until one has no live tracks (about a minute).
3. It rewrites `MAX_ID` in `app.js` if the range grew, and never lowers it. Commit and push.

The result is accurate to about one 100M window, and can differ by a step between runs near the edge. It needs a browser because the SoundCloud widget only runs in one.

## Limits

- `MAX_ID` is a snapshot of SoundCloud's ID range and goes stale (see above).
- Free-tier Cloudflare caps at roughly 30k votes/day, then errors until 00:00 UTC.
- IP addresses are stored briefly for rate limiting.

MIT licensed.
