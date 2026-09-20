const API = 'https://greatest-track.jenuis.workers.dev';
const MAX_ID = 2_400_000_000; // live track IDs top out around here (measured 2026-09)
const PARALLEL = 4; // candidate widgets probed at once per slot (~20% of random IDs are live)
const TIMEOUT_MS = 10_000;
const CHAMPION_ODDS = 0.5; // chance one side is a leaderboard track instead of a random one

const statusEl = document.getElementById('status');
const boardEl = document.getElementById('board');
const probesEl = document.getElementById('probes');
const slots = [...document.querySelectorAll('.slot')].map((el) => ({
  frames: el.querySelector('.frames'),
  button: el.querySelector('button'),
}));

const sounds = new Map(); // id -> { title, url }, so the leaderboard doesn't reload known tracks
let board = [];
let current = [];

const say = (msg, isError = false) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
};
const setBusy = (busy) => slots.forEach((s) => { s.button.disabled = busy; });
const randomId = () => 1 + Math.floor(Math.random() * MAX_ID);

// DRM streams don't play without decryption support, and the widget picks them even when
// plain streams exist, so tracks that list any encrypted stream get skipped.
const isEncrypted = (sound) => sound.media?.transcodings?.some((t) => t.format?.protocol?.includes('encrypted'));

// Loads a track into a hidden iframe under `host`. Dead tracks still fire READY but
// come back with no title, so a missing title (or a timeout) means "skip it".
const load = (id, host) => new Promise((resolve, reject) => {
  const frame = document.createElement('iframe');
  frame.className = 'probe';
  frame.title = 'SoundCloud player';
  // show_teaser=false stops mobile browsers from showing a "Play on SoundCloud" app prompt over the player.
  frame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://api.soundcloud.com/tracks/${id}`)}&show_teaser=false`;
  host.append(frame);
  const fail = () => {
    clearTimeout(timer);
    frame.remove();
    reject(new Error(`track ${id} unavailable`));
  };
  const timer = setTimeout(fail, TIMEOUT_MS);
  SC.Widget(frame).bind(SC.Widget.Events.READY, () => {
    SC.Widget(frame).getCurrentSound((sound) => {
      if (!sound?.title || isEncrypted(sound)) return fail();
      clearTimeout(timer);
      sounds.set(id, { title: sound.title, url: sound.permalink_url });
      resolve({ id, frame });
    });
  });
});

// Shows the first candidate that loads and discards the rest.
const reveal = (host, winner) => {
  host.querySelectorAll('.probe').forEach((f) => { if (f !== winner.frame) f.remove(); });
  winner.frame.classList.remove('probe');
  return winner;
};

// Keeps PARALLEL random candidates in flight, replacing each dead one, until one loads.
const findTrack = (host) => new Promise((resolve) => {
  let found = false;
  const attempt = () => load(randomId(), host).then(
    (track) => { if (!found) { found = true; resolve(reveal(host, track)); } },
    () => { if (!found) attempt(); },
  );
  for (let i = 0; i < PARALLEL; i++) attempt();
});

const findChampion = async (host, id) => {
  try {
    return reveal(host, await load(id, host));
  } catch {
    return findTrack(host);
  }
};

const refreshBoard = async () => {
  try {
    const res = await fetch(`${API}/board`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    board = await res.json(); // the Worker returns the top tracks already ranked by Elo
  } catch (e) {
    board = [];
    say(`Couldn't load leaderboard: ${e.message}`, true);
    return;
  }
  boardEl.replaceChildren(...board.map((t) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    const record = document.createElement('span');
    record.className = 'record';
    record.textContent = `${Math.round(t.rating)} ELO · ${t.wins}W ${t.losses}L`;
    li.append(label, record);
    const setLabel = ({ title, url }) => {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = title;
      label.replaceChildren(a);
    };
    if (sounds.has(t.id)) setLabel(sounds.get(t.id));
    else {
      label.textContent = `Track ${t.id}`;
      load(t.id, probesEl).then(({ frame }) => { frame.remove(); setLabel(sounds.get(t.id)); }, () => {});
    }
    return li;
  }));
};

const round = async () => {
  setBusy(true);
  say('Finding songs…');
  slots.forEach((s) => s.frames.replaceChildren());
  const champion = board.length && Math.random() < CHAMPION_ODDS
    ? { side: Math.random() < 0.5 ? 0 : 1, id: board[Math.floor(Math.random() * board.length)].id }
    : null;
  current = await Promise.all(slots.map((s, i) => (champion?.side === i
    ? findChampion(s.frames, champion.id)
    : findTrack(s.frames))));
  say('');
  setBusy(false);
};

const castVote = async (winner, loser) => {
  const res = await fetch(`${API}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, loser }),
  });
  if (res.status === 429) throw new Error('too many votes, try again later');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};

const vote = async (winnerIdx) => {
  setBusy(true);
  try {
    await castVote(current[winnerIdx].id, current[1 - winnerIdx].id);
  } catch (e) {
    say(`Vote failed: ${e.message}`, true);
    setBusy(false);
    return;
  }
  await refreshBoard();
  await round();
};

slots.forEach((s, i) => s.button.addEventListener('click', () => vote(i)));

if (typeof SC === 'undefined') {
  say("Couldn't load the SoundCloud widget script.", true);
} else {
  await refreshBoard();
  await round();
}
