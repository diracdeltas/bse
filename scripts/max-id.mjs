// Finds the top of SoundCloud's live track ID range and raises MAX_ID in app.js to match.
// The widget only runs in a browser, so this serves a probe page and waits for its result.
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const APP = new URL('../app.js', import.meta.url);
const MAX_ID_LINE = /^const MAX_ID = ([\d_]+);.*$/m;
const PAGES = {
  '/': ['probe.html', 'text/html'],
  '/probe.js': ['probe.js', 'text/javascript'],
};

const source = readFileSync(APP, 'utf8');
const match = source.match(MAX_ID_LINE);
if (!match) throw new Error('Could not find the MAX_ID line in app.js');
const current = Number(match[1].replaceAll('_', ''));

const format = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, '_');

// Any web page can POST to localhost, so only accept the shapes probe.js sends.
const isValid = (r) => (typeof r?.error === 'string')
  || (Number.isSafeInteger(r?.frontier) && r.frontier <= current * 2);

const finish = (result) => {
  if (result.error) {
    console.error(`Failed: ${result.error.replace(/[^\x20-\x7e]/g, '')}. app.js unchanged.`);
    process.exitCode = 1;
  } else if (result.frontier > current) {
    const month = new Date().toISOString().slice(0, 7);
    const line = `const MAX_ID = ${format(result.frontier)}; // live track IDs top out around here (measured ${month})`;
    writeFileSync(APP, source.replace(MAX_ID_LINE, line));
    console.log(`MAX_ID raised: ${format(current)} -> ${format(result.frontier)}`);
  } else {
    console.log(`MAX_ID is still current (${format(current)}). app.js unchanged.`);
  }
  server.close();
  server.closeAllConnections();
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/current') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ max: current }));
  }
  if (req.method === 'GET' && PAGES[req.url]) {
    const [file, type] = PAGES[req.url];
    res.setHeader('content-type', type);
    return res.end(readFileSync(new URL(file, import.meta.url)));
  }
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let result;
    try { result = JSON.parse(body); } catch { /* rejected below */ }
    if (!isValid(result)) {
      res.statusCode = 400;
      return res.end('bad request');
    }
    res.end('ok');
    return finish(result);
  }
  res.statusCode = 404;
  res.end();
});

server.listen(0, '127.0.0.1', () => {
  console.log(`Current MAX_ID: ${format(current)}`);
  console.log(`Open http://127.0.0.1:${server.address().port}/ in a browser and leave it open until it finishes.`);
});
