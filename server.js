'use strict';
// See Whot multiplayer server. No npm packages needed: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000, FILL_MS = +process.env.FILL_MS || 20000,
  BOT_MS = +process.env.BOT_MS || 2500, TURN_MS = +process.env.TURN_MS || 45000;
const S = ['\u25b2', '\u25a0', '\u25cf', '\u271d', '\u2605'], SPEC = { 1: 1, 2: 1, 5: 1, 8: 1, 14: 1, 20: 1 };
const EMO = new Set([...'😂😍🔥😭😎🤣😒🙏💀👏😤🥺💯🙈']);
const CODES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const conns = new Set(), byPid = new Map(), inGame = new Map(), games = new Set(), rooms = new Map();
const queues = { 2: [], 3: [], 4: [] }, qt = {}, qStart = {};

// ---------- cards and rules (same as the app) ----------
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function newDeck() {
  const d = [];
  S.forEach(s => { for (let n = 1; n <= 14; n++) d.push({ s, n }); });
  for (let k = 0; k < 4; k++) d.push({ s: 'W', n: 20 });
  S.forEach(s => [10, 11].forEach(n => d.push({ s, n })));
  return shuf(d);
}
const can = (g, c) => g.pend ? c.n === g.pendN : (c.n === 20 || c.s === g.shape || c.n === g.pile[g.pile.length - 1].n);
const take = (g, p, k) => { for (let j = 0; j < k && g.market.length; j++) p.hand.push(g.market.pop()); };
const adv = (g, sk) => { g.turn = (g.turn + 1 + sk) % g.pl.length; };

function newGame(seats) {
  shuf(seats);
  const d = newDeck();
  const g = {
    pl: seats.map(s => ({ pid: s.c ? s.c.pid : null, c: s.c || null, name: s.name, bot: !s.c, away: false, awayAt: 0, hand: d.splice(0, 10) })),
    market: null, pile: null, shape: null, turn: 0, pend: 0, pendN: 0, over: false, timer: null, t0: Date.now()
  };
  const rest = d.splice(0, 41);
  let k = rest.findIndex(c => !SPEC[c.n]); if (k < 0) k = 0;
  const top = rest.splice(k, 1)[0];
  g.market = rest; g.pile = [top]; g.shape = top.s;
  games.add(g);
  g.pl.forEach(p => { if (p.c) { inGame.set(p.pid, g); p.c.game = g; } });
  sendAll(g, r => ({ t: 'start', s: view(g, r) }));
  sched(g);
}

// what one player is allowed to see: own hand only (all hands once the game is over)
function view(g, r) {
  const n = g.pl.length;
  return {
    players: g.pl.map((_, j) => g.pl[(r + j) % n]).map((p, j) => ({ name: p.name, bot: p.bot, hand: j === 0 || g.over ? p.hand : p.hand.map(() => 0) })),
    marketN: g.market.length, top: g.pile[g.pile.length - 1], shape: g.shape,
    turn: (g.turn - r + n) % n, pend: g.pend, pendN: g.pendN, over: g.over
  };
}
function rot(ev, r, n) {
  const o = Object.assign({}, ev); o.pi = (ev.pi - r + n) % n;
  if (ev.gm) o.gm = ev.gm.map(j => (j - r + n) % n);
  return o;
}
function sendAll(g, fn) { g.pl.forEach((p, i) => { if (p.c) p.c.send(fn(i)); }); }
function emit(g, ev, over) {
  const n = g.pl.length;
  sendAll(g, r => ({ t: 'ev', ev: rot(ev, r, n), s: view(g, r), over: over ? { w: (over.w - r + n) % n, msg: over.msg } : null }));
}
function retire(g) {
  games.delete(g);
  g.pl.forEach(p => { if (p.pid && inGame.get(p.pid) === g) inGame.delete(p.pid); if (p.c) p.c.game = null; });
}
function end(g, ev, w, msg) { g.over = true; clearTimeout(g.timer); emit(g, ev, { w, msg }); retire(g); return null; }
function endPts(g, ev) {
  const t = g.pl.map(p => p.hand.reduce((a, c) => a + c.n, 0)); let w = 0;
  t.forEach((x, i) => { if (x < t[w]) w = i; });
  return end(g, ev, w, 'The market is finished. Lowest total wins.');
}

function doPlay(g, pi, ci, sh) {
  if (g.over || g.turn !== pi) return 'It is not your turn.';
  const p = g.pl[pi], c = p.hand[ci];
  if (!c) return 'That card is not in your hand.';
  if (!can(g, c)) return 'You can\u2019t play that card.';
  if (c.n === 20 && !S.includes(sh)) return 'Choose a shape.';
  p.hand.splice(ci, 1); g.pile.push(c); g.shape = c.n === 20 ? sh : c.s;
  if (c.n === 2 || c.n === 5) { g.pend += c.n === 2 ? 2 : 3; g.pendN = c.n; }
  const ev = { k: 'play', pi, ci, card: c, sh: g.shape, last: p.hand.length === 1 };
  if (!p.hand.length) return end(g, ev, pi, p.name + ' played the last card.');
  if (c.n === 14) { // General Market: everyone else picks one, same player plays again
    ev.gm = [];
    g.pl.forEach((q, j) => { if (j !== pi) { take(g, q, 1); ev.gm.push(j); } });
    if (!g.market.length) return endPts(g, ev);
  } else if (c.n !== 1) adv(g, c.n === 8 ? 1 : 0); // Hold On keeps the turn, Suspension skips next
  emit(g, ev); sched(g); return null;
}
function doDraw(g, pi) {
  if (g.over || g.turn !== pi) return 'It is not your turn.';
  const p = g.pl[pi], k = g.pend || 1, ev = { k: 'draw', pi, n: Math.min(k, g.market.length) };
  take(g, p, k); g.pend = 0;
  if (!g.market.length) return endPts(g, ev);
  adv(g, 0); emit(g, ev); sched(g); return null;
}

// bots (and auto-play for idle or disconnected players) only look at their own hand and public info
function botMove(g) {
  if (g.over) return;
  const pi = g.turn, p = g.pl[pi], ok = p.hand.map((c, i) => i).filter(i => can(g, p.hand[i]));
  if (!ok.length) return doDraw(g, pi);
  const w = { 2: 8, 5: 6, 14: 5, 8: 5, 1: 5, 20: 1 }, sc = i => (w[p.hand[i].n] || 3) + Math.random();
  let b = ok[0]; ok.forEach(i => { if (sc(i) > sc(b)) b = i; });
  const cnt = {}; p.hand.forEach((c, i) => { if (i !== b && c.s !== 'W') cnt[c.s] = (cnt[c.s] || 0) + 1; });
  const sh = Object.keys(cnt).sort((a, c) => cnt[c] - cnt[a])[0] || S[0];
  if (doPlay(g, pi, b, sh)) doDraw(g, pi);
}
function sched(g) {
  clearTimeout(g.timer); if (g.over) return;
  const p = g.pl[g.turn];
  g.timer = setTimeout(() => botMove(g), p.bot || p.away ? BOT_MS : TURN_MS);
}

// ---------- matchmaking ----------
function leaveWait(c) {
  if (c.q) {
    const s = c.q, a = queues[s], i = a.indexOf(c); if (i >= 0) a.splice(i, 1); c.q = 0;
    if (!a.length) clearInterval(qt[s]); else waitInfo(s);
  }
  if (c.room) {
    const r = rooms.get(c.room); c.room = null;
    if (r) {
      if (r.host === c) { rooms.delete(r.code); r.guests.forEach(x => { x.room = null; x.send({ t: 'err', msg: 'The host closed the room.', back: 1 }); }); }
      else { r.guests = r.guests.filter(x => x !== c); roomInfo(r); }
    }
  }
}
function waitInfo(s) {
  const a = queues[s], left = Math.max(0, Math.ceil((qStart[s] + FILL_MS - Date.now()) / 1000));
  a.forEach(c => c.send({ t: 'wait', label: 'Online match', total: s, have: a.length, left }));
}
function joinQueue(c, size) {
  if (![2, 3, 4].includes(size)) return;
  leaveWait(c);
  const a = queues[size]; a.push(c); c.q = size;
  if (a.length === 1) { qStart[size] = Date.now(); clearInterval(qt[size]); qt[size] = setInterval(() => tickQ(size), 1000); }
  if (a.length >= size) startQueue(size); else waitInfo(size);
}
function tickQ(s) {
  if (!queues[s].length) { clearInterval(qt[s]); return; }
  if (Date.now() >= qStart[s] + FILL_MS) startQueue(s); else waitInfo(s);
}
function startQueue(s) {
  const hum = queues[s].splice(0, s); clearInterval(qt[s]);
  if (!hum.length) return;
  hum.forEach(c => { c.q = 0; });
  const seats = hum.map(c => ({ c, name: c.name }));
  for (let i = 1; seats.length < s; i++) seats.push({ c: null, name: 'BOT ' + i });
  newGame(seats);
}
function roomInfo(r) {
  const all = [r.host, ...r.guests];
  all.forEach(c => c.send({ t: 'wait', label: 'Private room ' + r.code, total: r.size, have: all.length, left: null }));
}
function createRoom(c) {
  leaveWait(c);
  let code; do { code = Array.from({ length: 4 }, () => CODES[crypto.randomInt(CODES.length)]).join(''); } while (rooms.has(code));
  rooms.set(code, { code, size: 2, host: c, guests: [], t: Date.now() }); c.room = code;
  c.send({ t: 'room', code });
}
function joinRoom(c, code) {
  const r = rooms.get(String(code || '').toUpperCase().slice(0, 4));
  if (!r) return c.send({ t: 'err', msg: 'No room found for that code.' });
  if (r.host === c) return c.send({ t: 'err', msg: 'That is your own room. Share the code with a friend.' });
  if (1 + r.guests.length >= r.size) return c.send({ t: 'err', msg: 'That room is full.' });
  leaveWait(c); r.guests.push(c); c.room = r.code;
  const all = [r.host, ...r.guests];
  if (all.length >= r.size) { rooms.delete(r.code); all.forEach(x => { x.room = null; }); newGame(all.map(x => ({ c: x, name: x.name }))); }
  else roomInfo(r);
}

// ---------- messages ----------
const clean = n => String(n || 'Player').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player';
const spam = c => { const t = Date.now(); if (t - c.last < 300) return false; c.last = t; return true; };
const seatOf = (g, c) => g.pl.findIndex(p => p.c === c);
function onMsg(c, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'hello') {
    const pid = String(m.pid || '').slice(0, 64); if (pid.length < 8) return;
    c.pid = pid; c.name = clean(m.name);
    const old = byPid.get(pid); if (old && old !== c) { old.kicked = true; try { old.s.destroy(); } catch (e) { } }
    byPid.set(pid, c);
    const g = inGame.get(pid);
    if (g) { const i = g.pl.findIndex(p => p.pid === pid); if (i >= 0) { const p = g.pl[i]; p.c = c; p.away = false; c.game = g; c.send({ t: 'start', s: view(g, i) }); sched(g); } }
    c.send({ t: 'hi', online: conns.size }); return;
  }
  if (!c.pid) return;
  const g = c.game;
  switch (m.t) {
    case 'queue': if (g) c.send({ t: 'start', s: view(g, seatOf(g, c)) }); else joinQueue(c, +m.size); break;
    case 'create': if (!g) createRoom(c); break;
    case 'join': if (!g) joinRoom(c, m.code); break;
    case 'cancel': leaveWait(c); break;
    case 'play': if (g && Number.isInteger(m.i)) { const e = doPlay(g, seatOf(g, c), m.i, m.shape); if (e) c.send({ t: 'err', msg: e }); } break;
    case 'draw': if (g) { const e = doDraw(g, seatOf(g, c)); if (e) c.send({ t: 'err', msg: e }); } break;
    case 'chat': if (g && typeof m.text === 'string' && spam(c)) g.pl.forEach(p => { if (p.c && p.c !== c) p.c.send({ t: 'chat', who: c.name, text: m.text.slice(0, 60) }); }); break;
    case 'emoji': if (g && EMO.has(m.e) && spam(c)) { const i = seatOf(g, c), n = g.pl.length; g.pl.forEach((p, r) => { if (p.c && p.c !== c) p.c.send({ t: 'emoji', e: m.e, pi: (i - r + n) % n }); }); } break;
    case 'leave': if (g) { // seat is taken over by a bot so the others can finish
      const p = g.pl[seatOf(g, c)]; inGame.delete(c.pid); c.game = null; p.bot = true; p.c = null;
      if (!g.pl.some(q => q.c)) { g.over = true; clearTimeout(g.timer); retire(g); } else sched(g);
    } break;
  }
}
function onClose(c) {
  conns.delete(c);
  if (c.pid && byPid.get(c.pid) === c) byPid.delete(c.pid);
  leaveWait(c);
  if (c.game) { const p = c.game.pl.find(q => q.c === c); if (p) { p.c = null; p.away = true; p.awayAt = Date.now(); sched(c.game); } }
}

// ---------- minimal WebSocket (RFC 6455) ----------
class Conn {
  constructor(s) { this.s = s; this.buf = Buffer.alloc(0); this.alive = true; this.last = 0; this.pid = null; this.name = 'Player'; this.q = 0; this.room = null; this.game = null; conns.add(this);
    s.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.parse(); }); s.on('close', () => this.close()); s.on('error', () => this.close()); }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const op = b[0] & 15, masked = b[1] & 128; let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 65536) { this.s.destroy(); return; }
      const need = off + (masked ? 4 : 0) + len; if (b.length < need) return;
      let p = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const k = b.subarray(off, off + 4); p = Buffer.from(p); for (let i = 0; i < p.length; i++) p[i] ^= k[i & 3]; }
      this.buf = b.subarray(need);
      if (op === 8) { this.s.end(); return; }
      if (op === 9) this.frame(10, p);
      else if (op === 1) { try { onMsg(this, JSON.parse(p.toString())); } catch (e) { console.error(e); } }
    }
  }
  frame(op, p) {
    if (this.s.destroyed) return; const n = p.length; let h;
    if (n < 126) h = Buffer.from([128 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    this.s.write(Buffer.concat([h, p]));
  }
  send(o) { this.frame(1, Buffer.from(JSON.stringify(o))); }
  close() { if (!this.alive) return; this.alive = false; try { this.s.destroy(); } catch (e) { } onClose(this); }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  fs.readFile(path.join(__dirname, 'see-whot.html'), (e, d) => {
    if (e) { res.writeHead(404); res.end('See Whot server is running. Put see-whot.html next to server.js to serve the game here.'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(d);
  });
});
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  new Conn(sock);
});
setInterval(() => {
  const now = Date.now();
  for (const g of [...games]) {
    const hum = g.pl.filter(p => p.pid && !p.bot);
    if ((hum.length && hum.every(p => !p.c && now - p.awayAt > 60000)) || now - g.t0 > 3 * 3600 * 1000) { g.over = true; clearTimeout(g.timer); retire(g); }
  }
  for (const [code, r] of rooms) if (now - r.t > 900000) { rooms.delete(code); [r.host, ...r.guests].forEach(c => { c.room = null; c.send({ t: 'err', msg: 'The room expired.', back: 1 }); }); }
  conns.forEach(c => c.frame(9, Buffer.alloc(0))); // keep connections alive
}, 20000).unref();
if (require.main === module) server.listen(PORT, () => console.log('See Whot server on port ' + PORT));
