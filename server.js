'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const express = require('express'), Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
create table if not exists users(id text primary key, username text unique not null, pass text not null, role text not null, data text not null default '{}');
create table if not exists docs(id text primary key, type text not null, owner text, data text not null);
create table if not exists sessions(token text primary key, user_id text not null, exp integer not null);
create index if not exists docs_owner on docs(owner);
`);

/* ---------- helpers ---------- */
const rid = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const verify = (pw, h) => { const [s, k] = String(h).split(':'); const a = Buffer.from(k || '', 'hex'), b = crypto.scryptSync(pw, s || '', 64); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const J = s => { try { return JSON.parse(s); } catch { return {}; } };
const num = x => typeof x === 'number' && isFinite(x);
const str = (x, n) => typeof x === 'string' && x.length <= n;
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };

const TF = ['water', 'ms', 'hist', 'cur', 'act', 'last', 'log', 'pr', 'chk', 'weights', 'checkin', 'lastDone', 'daily', 'day', 'reqs', 'steps', 'meas', 'cia', 'rtime', 'remOff', 'hs', 'rf']; // trainee-owned
const CF = ['name', 'status', 'goal', 'block', 'coachNote', 'progs', 'plan', 'sgoal', 'cif', 'supp', 'cardio', 'phone', 'remT', 'sub'];                                                          // coach-owned
const checks = {
  water: num, ms: Array.isArray, hist: obj, cur: obj, act: x => x === null || obj(x), last: x => x === null || obj(x), log: Array.isArray,
  pr: obj, chk: Array.isArray, weights: Array.isArray, checkin: x => x === null || obj(x), lastDone: x => x === null || obj(x), daily: obj, day: x => str(x, 12), reqs: Array.isArray, steps: x => num(x) && x >= 0 && x <= 200000, sgoal: x => num(x) && x >= 1000 && x <= 60000, cif: x => num(x) && x >= 0 && x <= 60, meas: x => Array.isArray(x) && x.length <= 400, cia: x => str(x, 12), rtime: x => str(x, 5) && /^\d\d:\d\d$/.test(x), remOff: x => typeof x === 'boolean', supp: x => str(x, 4000), cardio: x => str(x, 4000), phone: x => str(x, 20), sub: x => obj(x) && JSON.stringify(x).length < 2000, remT: x => str(x, 5) && (x === '' || /^\d\d:\d\d$/.test(x)),
  rf: x => Array.isArray(x) && x.length <= 60,
  hs: x => x === null || (obj(x) && str(x.d, 12) && num(x.h) && x.h >= 0 && x.h <= 24),
  name: x => str(x, 80) && x.trim().length > 0, status: x => ['פעיל', 'מושהה', 'ארכיון'].includes(x), goal: x => num(x) && x >= 500 && x <= 10000,
  block: x => obj(x) && str(x.n, 60) && num(x.w) && num(x.of), coachNote: x => str(x, 2000), progs: x => Array.isArray(x) && x.every(i => str(i, 40)), plan: x => x === null || str(x, 40)
};
function pick(src, fields) {
  const out = {};
  for (const k of fields) if (src[k] !== undefined) { if (!checks[k](src[k])) fail(400, 'ערך לא תקין: ' + k); out[k] = src[k]; }
  return out;
}
const outUser = r => ({ id: r.id, user: r.username, role: r.role === 'coach' ? 'c' : 't', ...J(r.data) });

/* ---------- starter templates + coach bootstrap ---------- */
const E = (n, sets, rep, rest, tip = '', ss = false) => ({ id: 'e' + rid(6), n, sets, rep, rest, tip, ss, video: '' });
const O = (d, k, p, c, f) => ({ d, k, p, c, f });
function seedTemplates() {
  if (db.prepare("select 1 from docs where type in ('prog','plan') limit 1").get()) return;
  const progs = [{ id: 'g' + rid(6), name: 'דחיפה / משיכה / רגליים', days: [
    { id: 'd' + rid(6), name: 'דחיפה', ex: [E('לחיצת חזה במוט', 3, '8-10', 120, 'שכמות נעולות, ירידה איטית'), E('לחיצת כתפיים בדאמבלים', 3, '8-12', 90), E('פרפר במכונה', 3, '10-12', 60), E('מתח כבלים לתלת', 3, '10-15', 60, '', true)] },
    { id: 'd' + rid(6), name: 'משיכה', ex: [E('מתח (Pull-up)', 3, '6-10', 120), E('חתירה בכבל', 3, '8-12', 90), E('כפיפת מרפק בדאמבלים', 3, '10-12', 60)] },
    { id: 'd' + rid(6), name: 'רגליים', ex: [E('סקוואט', 4, '6-8', 150, 'עומק מלא'), E('דדליפט רומני', 3, '8-10', 120), E('מכבש רגליים', 3, '10-12', 90)] }] }];
  const plans = [
    { id: 'p' + rid(6), name: 'חיטוב 2,100 קל׳', meals: [
      { n: 'ארוחת בוקר', opts: [O('שייק חלבון, שיבולת שועל', 520, 38, 55, 14), O('חביתה מ-3 ביצים, לחם מלא', 500, 32, 38, 24), O('יוגורט, גרנולה, פירות', 480, 28, 62, 12)] },
      { n: 'ארוחת צהריים', opts: [O('חזה עוף, אורז, ירקות', 680, 52, 78, 14), O('סלמון, קינואה, סלט', 700, 46, 52, 30)] },
      { n: 'ארוחת ביניים', opts: [O('יוגורט, בננה', 290, 24, 42, 4), O('טונה, פריכיות', 260, 28, 24, 5)] },
      { n: 'ארוחת ערב', opts: [O('דג, בטטה, סלט', 620, 45, 58, 22), O('אומלט ירקות, גבינה', 560, 40, 20, 34)] }] },
    { id: 'p' + rid(6), name: 'עלייה במסה 2,900 קל׳', meals: [
      { n: 'ארוחת בוקר', opts: [O('3 ביצים, שיבולת שועל, בננה', 720, 40, 80, 24)] },
      { n: 'ארוחת צהריים', opts: [O('בקר, פסטה מלאה, ירקות', 950, 60, 100, 28)] },
      { n: 'ארוחת ערב', opts: [O('עוף, תפוחי אדמה, סלט', 850, 55, 85, 26)] }] }];
  const ins = db.prepare('insert into docs(id,type,owner,data) values(?,?,?,?)');
  progs.forEach(p => ins.run(p.id, 'prog', null, JSON.stringify(p)));
  plans.forEach(p => ins.run(p.id, 'plan', null, JSON.stringify(p)));
}
function ensureCoach() {
  if (db.prepare("select 1 from users where role='coach'").get()) return;
  const user = (process.env.COACH_USER || 'coach').toLowerCase();
  let pass = process.env.COACH_PASS, gen = false;
  if (!pass) { pass = crypto.randomBytes(6).toString('base64url'); gen = true; }
  db.prepare('insert into users(id,username,pass,role,data) values(?,?,?,?,?)').run('coach', user, hash(pass), 'coach', JSON.stringify({ name: process.env.COACH_NAME || 'המאמן' }));
  console.log(gen ? `[setup] coach "${user}" created. GENERATED PASSWORD (save it now): ${pass}` : `[setup] coach "${user}" created`);
}
seedTemplates(); ensureCoach();
if (process.env.COACH_RESET === '1' && process.env.COACH_PASS) {
  const un = (process.env.COACH_USER || 'coach').toLowerCase();
  db.prepare("update users set username=?, pass=? where role='coach'").run(un, hash(process.env.COACH_PASS));
  db.prepare("delete from sessions where user_id in (select id from users where role='coach')").run();
  console.log('[setup] coach credentials reset from env (remove COACH_RESET after this run)');
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self'; frame-ancestors 'none'"
  });
  if (PROD && req.headers['x-forwarded-proto'] === 'http') return res.redirect(301, 'https://' + req.headers.host + req.url);
  next();
});
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a[0]).map(a => [a[0], decodeURIComponent(a.slice(1).join('='))]));
const setCookie = (res, token, maxAge) => res.append('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`);
const wrap = fn => (req, res) => { const h = e => { if (!e.status) console.error(e); if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'שגיאת שרת' }); }; try { const r = fn(req, res); if (r && r.catch) r.catch(h); } catch (e) { h(e); } };

app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.headers['x-app'] !== '1' && !req.path.startsWith('/h/')) return res.status(403).json({ error: 'forbidden' });
  const sid = cookies(req).sid;
  if (sid) {
    const s = db.prepare('select s.exp,u.* from sessions s join users u on u.id=s.user_id where s.token=?').get(sid);
    if (s && s.exp > Date.now()) { req.user = s; req.sid = sid; } else if (s) db.prepare('delete from sessions where token=?').run(sid);
  }
  next();
});
const auth = (req, role) => { if (!req.user) fail(401, 'לא מחובר'); if (role && req.user.role !== role) fail(403, 'אין הרשאה'); };

const tries = new Map();
app.post('/api/login', wrap((req, res) => {
  const ip = req.ip, t = tries.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - t.t > 10 * 60e3) { t.n = 0; t.t = Date.now(); }
  if (t.n >= 10) fail(429, 'יותר מדי ניסיונות');
  const { user, pass } = req.body || {};
  const u = typeof user === 'string' && typeof pass === 'string' ? db.prepare('select * from users where username=?').get(user.trim().toLowerCase()) : null;
  const ok = u && verify(pass, u.pass) && J(u.data).status !== 'ארכיון';
  if (!ok) { t.n++; tries.set(ip, t); fail(401, 'שם משתמש או סיסמה שגויים'); }
  tries.delete(ip);
  const token = crypto.randomBytes(32).toString('hex'), days = 30;
  db.prepare('insert into sessions(token,user_id,exp) values(?,?,?)').run(token, u.id, Date.now() + days * 864e5);
  db.prepare('delete from sessions where exp<?').run(Date.now());
  setCookie(res, token, days * 86400);
  res.json({ ok: true });
}));
app.post('/api/logout', wrap((req, res) => { if (req.sid) db.prepare('delete from sessions where token=?').run(req.sid); setCookie(res, '', 0); res.json({ ok: true }); }));

const docs = type => db.prepare('select data from docs where type=?').all(type).map(r => J(r.data));
const MSG_DEF = [['מה המצב', 'היי {שם}, מה המצב אלוף? 💪'], ['לא התאמן', 'היי {שם}, מה המצב אלוף? 💪 שמתי לב שלא התאמנת כמה ימים. הכול טוב?'], ['המנוי מסתיים', 'היי {שם}, המנוי שלך מסתיים בקרוב, בוא נדבר על ההמשך 🙂'], ['תזונה', 'היי {שם}, איך הולכת התזונה השבוע? אל תשכח לסמן ארוחות באפליקציה 🍽️'], ['מדידות', 'היי {שם}, הגיע הזמן למדידות הבאות. אפשר למלא באפליקציה 📏'], ['עידוד', 'כל הכבוד {שם}! אימון מצוין, ממשיכים 🔥']];
function seedMsgs() {
  db.exec("create table if not exists kv(k text primary key, v text not null)");
  if (db.prepare("select 1 from kv where k='msgs_seeded'").get()) return;
  const ins = db.prepare('insert or ignore into docs(id,type,owner,data) values(?,?,?,?)');
  MSG_DEF.forEach((m, i) => ins.run('m' + (i + 1), 'msg', null, JSON.stringify({ id: 'm' + (i + 1), n: m[0], t: m[1] })));
  db.prepare("insert into kv(k,v) values('msgs_seeded','1')").run();
}
app.get('/api/state', wrap((req, res) => {
  auth(req);
  if (req.user.role === 'coach') return res.json({ me: req.user.id, users: db.prepare('select * from users').all().map(outUser), progs: docs('prog'), plans: docs('plan'), exs: docs('ex'), foods: docs('food'), msgs: (seedMsgs(), docs('msg')) });
  const mine = db.prepare('select * from docs where owner=?').all(req.user.id).map(r => ({ type: r.type, d: J(r.data) }));
  res.json({ me: req.user.id, users: [(({ sub, pays, ...o }) => o)(outUser(req.user))], progs: mine.filter(x => x.type === 'prog').map(x => x.d), plans: mine.filter(x => x.type === 'plan').map(x => x.d), exs: docs('ex'), foods: docs('food') });
}));

app.put('/api/me', wrap((req, res) => {
  auth(req, 'trainee');
  const data = { ...J(req.user.data), ...pick(req.body || {}, TF) };
  db.prepare('update users set data=? where id=?').run(JSON.stringify(data), req.user.id);
  res.json({ ok: true });
}));

/* ---------- iPhone Shortcuts: personal link that receives steps + sleep ---------- */
db.exec("create table if not exists kv(k text primary key, v text not null)");
const hTok = uid => { const r = db.prepare('select v from kv where k=?').get('htok:' + uid); if (r) return r.v; const v = crypto.randomBytes(24).toString('hex'); db.prepare('insert into kv(k,v) values(?,?)').run('htok:' + uid, v); return v; };
const hHits = new Map();
const todayTZ = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TZ || 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const numIn = v => { if (Array.isArray(v)) v = v[0]; if (v === undefined || v === null) return null; const n = parseFloat(String(v).replace(/,/g, '').replace(/[^\d.]/g, '')); return isFinite(n) ? n : null; };
// sleep may arrive as hours, minutes or seconds depending on how the Shortcut sums it
const sleepHours = n => n === null ? null : n <= 24 ? n : n <= 1440 ? n / 60 : n <= 86400 ? n / 3600 : null;
app.post('/api/health/link', wrap((req, res) => {
  auth(req, 'trainee');
  if ((req.body || {}).reset) { db.prepare('delete from kv where k=?').run('htok:' + req.user.id); }
  res.json({ token: hTok(req.user.id) });
}));
app.get('/api/health/pull', wrap((req, res) => { auth(req, 'trainee'); res.json({ hin: J(req.user.data).hin || null }); }));
app.all('/api/h/:token', wrap((req, res) => {
  const t = String(req.params.token || '');
  if (!/^[a-f0-9]{48}$/.test(t)) fail(404, 'קישור לא תקין');
  const now = Date.now(), hits = (hHits.get(t) || []).filter(x => now - x < 60000);
  if (hits.length >= 30) fail(429, 'יותר מדי בקשות');
  hits.push(now); hHits.set(t, hits); if (hHits.size > 500) hHits.clear();
  const row = db.prepare("select u.* from kv k join users u on k.k='htok:'||u.id where k.v=? and u.role='trainee'").get(t);
  if (!row) fail(404, 'קישור לא תקין');
  const q = { ...(req.query || {}), ...(obj(req.body) ? req.body : {}) };
  let steps = numIn(q.steps), sleep = sleepHours(numIn(q.sleep));
  steps = steps !== null && steps > 0 && steps <= 200000 ? Math.round(steps) : null;
  sleep = sleep !== null && sleep > 0 && sleep <= 16 ? Math.round(sleep * 2) / 2 : null;
  if (steps === null && sleep === null) fail(400, 'לא התקבלו צעדים או שינה');
  const data = J(row.data), d = todayTZ(), prev = data.hin && data.hin.d === d ? data.hin : {};
  data.hin = { d, steps: steps !== null ? Math.max(steps, prev.steps || 0) : prev.steps || null, sleep: sleep !== null ? sleep : prev.sleep || null, ts: now };
  db.prepare('update users set data=? where id=?').run(JSON.stringify(data), row.id);
  res.json({ ok: true, steps: data.hin.steps, sleep: data.hin.sleep });
}));
app.post('/api/me/password', wrap((req, res) => {
  auth(req);
  const { old, pass } = req.body || {};
  if (typeof pass !== 'string' || pass.length < 6 || pass.length > 100) fail(400, 'הסיסמה החדשה חייבת להכיל לפחות 6 תווים');
  if (typeof old !== 'string' || !verify(old, req.user.pass)) fail(400, 'הסיסמה הנוכחית שגויה');
  db.prepare('update users set pass=? where id=?').run(hash(pass), req.user.id);
  db.prepare('delete from sessions where user_id=? and token<>?').run(req.user.id, req.sid);
  res.json({ ok: true });
}));

/* ---------- coach ---------- */
const USERNAME = /^[a-z0-9._-]{3,32}$/;
app.post('/api/users', wrap((req, res) => {
  auth(req, 'coach');
  const { name, user, pass } = req.body || {}, uname = String(user || '').trim().toLowerCase();
  if (!str(name, 80) || !name.trim()) fail(400, 'חסר שם');
  if (!USERNAME.test(uname)) fail(400, 'שם משתמש: 3-32 תווים באנגלית, ספרות . _ -');
  if (typeof pass !== 'string' || pass.length < 6) fail(400, 'סיסמה: לפחות 6 תווים');
  if (db.prepare('select 1 from users where username=?').get(uname)) fail(409, 'שם המשתמש תפוס');
  const id = 'u' + rid(8), tpl = docs('plan').find(p => !p.owner);
  let plan = null;
  if (tpl) { plan = { ...JSON.parse(JSON.stringify(tpl)), id: 'p' + rid(8), owner: id, name: tpl.name + ' – ' + name.trim() }; db.prepare('insert into docs(id,type,owner,data) values(?,?,?,?)').run(plan.id, 'plan', id, JSON.stringify(plan)); }
  const data = { name: name.trim(), status: 'פעיל', water: 0, goal: 3000, progs: [], plan: plan && plan.id, ms: [], hist: {}, cur: {}, act: null, last: null, log: [], pr: {}, chk: [], weights: [], checkin: null, lastDone: null, daily: {}, day: '', reqs: [], coachNote: 'ברוכים הבאים! התוכנית שלך מחכה בלשונית אימון.', block: { n: 'התחלה', w: 1, of: 6 }, created: Date.now() };
  db.prepare('insert into users(id,username,pass,role,data) values(?,?,?,?,?)').run(id, uname, hash(pass), 'trainee', JSON.stringify(data));
  res.json({ user: outUser(db.prepare('select * from users where id=?').get(id)), plans: plan ? [plan] : [] });
}));
app.put('/api/users/:id', wrap((req, res) => {
  auth(req, 'coach');
  const row = db.prepare("select * from users where id=? and role='trainee'").get(req.params.id);
  if (!row) fail(404, 'מתאמן לא נמצא');
  const body = req.body || {}, old = J(row.data), upd = pick(body, CF);
  if (body.user !== undefined) {
    const uname = String(body.user).trim().toLowerCase();
    if (!USERNAME.test(uname)) fail(400, 'שם משתמש לא תקין');
    if (db.prepare('select 1 from users where username=? and id<>?').get(uname, row.id)) fail(409, 'שם המשתמש תפוס');
    db.prepare('update users set username=? where id=?').run(uname, row.id);
  }
  const data = { ...old, ...upd };
  if (upd.plan !== undefined && upd.plan !== old.plan) data.ms = [];
  if (upd.progs !== undefined && JSON.stringify(upd.progs) !== JSON.stringify(old.progs)) data.act = null;
  db.prepare('update users set data=? where id=?').run(JSON.stringify(data), row.id);
  if (upd.status === 'ארכיון') db.prepare('delete from sessions where user_id=?').run(row.id);
  res.json({ ok: true });
}));
app.post('/api/users/:id/password', wrap((req, res) => {
  auth(req, 'coach');
  const row = db.prepare("select id from users where id=? and role='trainee'").get(req.params.id);
  if (!row) fail(404, 'מתאמן לא נמצא');
  let pass = (req.body || {}).pass;
  if (pass === undefined || pass === '') pass = crypto.randomBytes(5).toString('base64url');
  if (typeof pass !== 'string' || pass.length < 6) fail(400, 'סיסמה: לפחות 6 תווים');
  db.prepare('update users set pass=? where id=?').run(hash(pass), row.id);
  db.prepare('delete from sessions where user_id=?').run(row.id);
  res.json({ pass });
}));
app.delete('/api/users/:id', wrap((req, res) => {
  auth(req, 'coach');
  const row = db.prepare("select id from users where id=? and role='trainee'").get(req.params.id);
  if (!row) fail(404, 'מתאמן לא נמצא');
  db.transaction(() => {
    for (const t of ['sessions', 'push_subs', 'photos', 'push_log']) db.prepare('delete from ' + t + ' where user_id=?').run(row.id);
    db.prepare('delete from docs where owner=?').run(row.id);
    db.prepare('delete from users where id=?').run(row.id);
  })();
  res.json({ ok: true });
}));
app.put('/api/library', wrap((req, res) => {
  auth(req, 'coach');
  const { progs, plans, exs, foods, msgs } = req.body || {};
  const valid = (a, key) => Array.isArray(a) && a.length < 1000 && a.every(d => obj(d) && str(d.id, 40) && str(d.name, 120) && Array.isArray(d[key]));
  if (!valid(progs, 'days') || !valid(plans, 'meals')) fail(400, 'נתונים לא תקינים');
  let cleanEx = null;
  if (exs !== undefined) {
    if (!Array.isArray(exs) || exs.length > 1000 || !exs.every(d => obj(d) && str(d.id, 40) && str(d.n, 120))) fail(400, 'נתונים לא תקינים');
    const t = (v, m) => (typeof v === 'string' ? v.slice(0, m) : '');
    cleanEx = exs.map(d => ({ id: d.id, n: d.n, g: t(d.g, 30), sets: Math.max(0, Math.min(20, Number(d.sets) || 0)), rep: t(String(d.rep == null ? '' : d.rep), 20), rest: Math.max(0, Math.min(900, Number(d.rest) || 0)), tip: t(d.tip, 500), video: t(d.video, 300) }));
  }
  let cleanMs = null;
  if (msgs !== undefined) {
    if (!Array.isArray(msgs) || msgs.length > 60 || !msgs.every(d => obj(d) && str(d.id, 40))) fail(400, 'נתונים לא תקינים');
    const t = (v, m) => (typeof v === 'string' ? v.slice(0, m) : '');
    cleanMs = msgs.map(d => ({ id: d.id, n: t(d.n, 40), t: t(d.t, 600) }));
  }
  let cleanFd = null;
  if (foods !== undefined) {
    if (!Array.isArray(foods) || foods.length > 2000 || !foods.every(d => obj(d) && str(d.id, 40) && str(d.n, 120))) fail(400, 'נתונים לא תקינים');
    const m = x => Math.max(0, Math.min(5000, Math.round((Number(x) || 0) * 10) / 10));
    cleanFd = foods.map(d => ({ id: d.id, n: d.n, q: typeof d.q === 'string' ? d.q.slice(0, 30) : '', k: m(d.k), p: m(d.p), c: m(d.c), f: m(d.f), b: d.b === 'g' ? 'g' : 's', cat: typeof d.cat === 'string' ? d.cat.slice(0, 30) : '', pu: typeof d.pu === 'string' ? d.pu.slice(0, 30) : '', bc: /^\d{8,14}$/.test(String(d.bc || '')) ? String(d.bc) : '', u: Array.isArray(d.u) ? d.u.filter(x => obj(x) && str(x.n, 30) && num(x.g) && x.g > 0 && x.g <= 5000).slice(0, 12).map(x => ({ n: x.n, g: Math.round(x.g * 10) / 10 })) : [] }));
  }
  const ins = db.prepare('insert into docs(id,type,owner,data) values(?,?,?,?)');
  db.transaction(() => {
    if (cleanFd) { db.prepare("delete from docs where type='food'").run(); cleanFd.forEach(d => ins.run(d.id, 'food', null, JSON.stringify(d))); }
    if (cleanMs) { db.prepare("delete from docs where type='msg'").run(); cleanMs.forEach(d => ins.run(d.id, 'msg', null, JSON.stringify(d))); }
    if (cleanEx) { db.prepare("delete from docs where type='ex'").run(); cleanEx.forEach(d => ins.run(d.id, 'ex', null, JSON.stringify(d))); }
    db.prepare("delete from docs where type in ('prog','plan')").run();
    progs.forEach(d => ins.run(d.id, 'prog', d.owner || null, JSON.stringify(d)));
    plans.forEach(d => ins.run(d.id, 'plan', d.owner || null, JSON.stringify(d)));
  })();
  res.json({ ok: true });
}));

// ---------- daily automatic DB snapshot ----------
const BK_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups'), BK_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
let bkBusy = false;
async function autoBackup(why) {
  if (bkBusy) return; bkBusy = true;
  try {
    fs.mkdirSync(BK_DIR, { recursive: true });
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }), file = path.join(BK_DIR, 'app-' + day + '.db'), tmp = file + '.tmp';
    await db.backup(tmp);
    fs.renameSync(tmp, file);
    db.prepare("insert into kv(k,v) values('last_backup',?) on conflict(k) do update set v=excluded.v").run(String(Date.now()));
    const all = fs.readdirSync(BK_DIR).filter(f => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    all.slice(0, Math.max(0, all.length - BK_KEEP)).forEach(f => { try { fs.unlinkSync(path.join(BK_DIR, f)); } catch (e) {} });
    console.log('[backup] ok (' + why + ') ' + path.basename(file) + ' · ' + Math.round(fs.statSync(file).size / 1024) + 'KB · kept ' + Math.min(all.length, BK_KEEP));
  } catch (e) { console.log('[backup] failed:', e.message); }
  bkBusy = false;
}
db.exec("create table if not exists kv(k text primary key, v text not null)");
setTimeout(() => {
  const r = db.prepare("select v from kv where k='last_backup'").get();
  if (!r || Date.now() - Number(r.v) > 20 * 3600e3) autoBackup('startup');
}, 20000);
setInterval(() => {
  const r = db.prepare("select v from kv where k='last_backup'").get();
  if (!r || Date.now() - Number(r.v) > 23 * 3600e3) autoBackup('daily');
}, 3600e3);

// ---------- AI assistant for the coach (drafts only, coach reviews everything) ----------
const GEM = !!process.env.GEMINI_API_KEY, AI_MODEL = process.env.AI_MODEL || (GEM ? 'gemini-3.6-flash' : 'claude-sonnet-5-5'), AI_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 40;
let exNames = null;
function exByGroup() {
  if (exNames) return exNames;
  const p = [path.join(__dirname, 'exlib.json.gz'), path.join(__dirname, 'public', 'exlib.json.gz')].find(x => fs.existsSync(x));
  const g = {};
  if (p) { try { JSON.parse(require('zlib').gunzipSync(fs.readFileSync(p)).toString()).forEach(r => { (g[r[1] || 'אחר'] = g[r[1] || 'אחר'] || []).push(r[0]); }); } catch (e) {} }
  return (exNames = g);
}
async function aiAsk(system, user) {
  const key = GEM ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) fail(503, 'עוזר ה-AI לא מוגדר: חסר GEMINI_API_KEY בשרת');
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }), k = 'ai:' + day;
  const used = Number((db.prepare('select v from kv where k=?').get(k) || {}).v || 0);
  if (used >= AI_LIMIT) fail(429, 'הגעת למגבלת השימוש היומית ב-AI (' + AI_LIMIT + ')');
  db.prepare("insert into kv(k,v) values(?,?) on conflict(k) do update set v=excluded.v").run(k, String(used + 1));
  let r, j, txt;
  if (GEM) {
    const models = [AI_MODEL, process.env.AI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'].filter((m, i, a) => a.indexOf(m) === i);
    const bodyG = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000, temperature: 0.6 } });
    for (let i = 0; i < 4; i++) {
      const m = models[Math.min(i >> 1, models.length - 1)];
      try {
        r = await fetch((process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com') + '/v1beta/models/' + encodeURIComponent(m) + ':generateContent', { method: 'POST', signal: AbortSignal.timeout(90000), headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: bodyG });
        j = await r.json().catch(() => ({}));
      } catch (e) { r = { ok: false, status: 0 }; j = { error: { message: String(e.message) } }; }
      if (r.ok) break;
      console.log('[ai] gemini', m, r.status, JSON.stringify(j).slice(0, 300));
      if (![0, 429, 500, 503, 504].includes(r.status) && !(r.status === 404 && i < 2)) break;
      await new Promise(f => setTimeout(f, 1500 * (i + 1)));
    }
    if (!r.ok) { db.prepare("update kv set v=? where k=?").run(String(used), k); const em = ((j.error || {}).message || '').slice(0, 120); fail(r.status === 429 ? 429 : 502, r.status === 429 ? 'חריגה ממגבלת ה-AI החינמית, נסה שוב בעוד דקה' : r.status === 503 || r.status === 0 ? 'שירות ה-AI עמוס כרגע, נסה שוב בעוד דקה' : 'שגיאה משירות ה-AI (' + r.status + ')' + (em ? ': ' + em : '')); }
    txt = (((j.candidates || [])[0] || {}).content || {}).parts ? ((j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('') : '';
  } else {
    r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: AI_MODEL, max_tokens: 6000, system, messages: [{ role: 'user', content: user }] }) });
    j = await r.json().catch(() => ({}));
    if (!r.ok) { console.log('[ai] error', r.status, JSON.stringify(j).slice(0, 300)); fail(502, 'שגיאה משירות ה-AI (' + r.status + ')'); }
    txt = (j.content || []).map(c => c.text || '').join('');
  }
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  try { return JSON.parse(txt.slice(a, b + 1)); } catch (e) { fail(502, 'תשובת ה-AI לא הייתה תקינה, נסה שוב'); }
}
app.get('/api/ai/status', wrap((req, res) => { auth(req, 'coach'); res.json({ on: !!(GEM ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY), model: AI_MODEL }); }));
app.post('/api/ai/draft', wrap(async (req, res) => {
  auth(req, 'coach');
  const { kind, uid, brief } = req.body || {};
  if (!['plan', 'prog'].includes(kind) || !obj(brief)) fail(400, 'בקשה לא תקינה');
  const row = db.prepare("select data from users where id=? and role='trainee'").get(String(uid || ''));
  if (!row) fail(404, 'מתאמן לא נמצא');
  const u = J(row.data), t = (v, m) => (typeof v === 'string' ? v.trim().slice(0, m) : ''), n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const w = (u.weights || []).slice(-6).map(x => ({ date: x[0], kg: x[1] }));
  const ctx = { name: String(u.name || '').split(' ')[0], recentWeights: w, supplements: t(u.supp, 200), cardio: t(u.cardio, 200), coachRequest: t(brief.text, 800), goal: t(brief.goal, 60), level: t(brief.level, 40), equipment: t(brief.equip, 200), restrictions: t(brief.restr, 300) };
  const SYS = 'אתה עוזר למאמן כושר ישראלי. אתה מכין טיוטה בלבד, והמאמן יבדוק ויערוך הכול לפני שהמתאמן יראה אותה. כתוב בעברית. אל תיתן ייעוץ רפואי, ואל תציע דיאטות קיצוניות (לא פחות מ-1200 קלוריות ביום). אם יש מגבלה רפואית או פציעה, התחשב בה בזהירות והזכר ב-summary שהמאמן צריך לאמת. החזר JSON תקין בלבד, בלי טקסט לפניו או אחריו.';
  if (kind === 'plan') {
    const P = n(brief.p, 0, 600), C = n(brief.c, 0, 1000), F = n(brief.f, 0, 400), mac = P || C || F, cal = n(brief.kcal, 0, 6000) || (mac ? P * 4 + C * 4 + F * 9 : 0), meals = n(brief.meals, 2, 8) || 5;
    const out = await aiAsk(SYS, 'בנה טיוטת תפריט תזונה יומי למתאמן.\nנתונים: ' + JSON.stringify(ctx) + '\nקלוריות יעד ליום: ' + (cal || 'לפי שיקול דעתך, לפי המטרה והמשקל') + (mac ? '\nיעד מאקרו יומי מדויק: חלבון ' + P + ' גרם, פחמימה ' + C + ' גרם, שומן ' + F + ' גרם. הצמד אליו בטווח של כ-5 אחוזים.' : '') + '\nמספר ארוחות: ' + meals + '\n\nחוקים: לכל ארוחה 1 עד 2 אפשרויות (opts) להחלפה. כל אפשרות כוללת items עם שם מאכל ישראלי נפוץ וכללי בעברית פשוטה (למשל "חזה עוף צלוי", "אורז לבן מבושל", "ביצה קשה", "יוגורט 3%", "לחם מלא פרוס"), וכמות בגרם (g, מספר שלם; ביצה = 60, פרוסת לחם = 30). אל תכתוב מותגים. כוון לסכום קלוריות יומי קרוב ליעד, ולחלבון של כ-1.6 עד 2.2 גרם לק"ג אם המשקל ידוע.\nפורמט: {"name":"שם התפריט","summary":"2-3 שורות למאמן: מה בנית ומה לבדוק","meals":[{"n":"ארוחת בוקר","opts":[{"d":"אפשרות א׳","items":[{"n":"...","g":100}]}]}]}');
    const meals2 = (Array.isArray(out.meals) ? out.meals : []).slice(0, 8).map(m => ({ n: t(m.n, 40) || 'ארוחה', opts: (Array.isArray(m.opts) ? m.opts : []).slice(0, 3).map(o => ({ d: t(o.d, 60), items: (Array.isArray(o.items) ? o.items : []).slice(0, 12).filter(x => obj(x) && t(x.n, 80)).map(x => ({ n: t(x.n, 80), g: n(x.g, 1, 1500) })) })).filter(o => o.items.length) })).filter(m => m.opts.length);
    if (!meals2.length) fail(502, 'ה-AI לא החזיר תפריט, נסה שוב');
    return res.json({ name: t(out.name, 80) || 'תפריט AI', summary: t(out.summary, 600), meals: meals2 });
  }
  const g = exByGroup(), days = n(brief.days, 1, 7) || 3;
  const list = Object.keys(g).map(k => k + ': ' + g[k].join(' | ')).join('\n');
  const out = await aiAsk(SYS, 'בנה טיוטת תוכנית אימון כוח למתאמן.\nנתונים: ' + JSON.stringify(ctx) + '\nמספר ימי אימון בשבוע: ' + days + '\n\nחוקים: בחר תרגילים אך ורק משמות הרשימה למטה, מילה במילה. 5 עד 8 תרגילים ליום, קודם תרגילים מורכבים. לכל תרגיל: sets (1-6), rep (טווח כמו "8-12"), rest (שניות, 30-240). חלק לימים הגיוני (למשל פולבודי, או חזה/גב/רגליים), והתחשב בציוד ובמגבלות.\nרשימת התרגילים לפי קבוצת שריר:\n' + list + '\nפורמט: {"name":"שם התוכנית","summary":"2-3 שורות למאמן","days":[{"name":"יום 1 · חזה וכתפיים","ex":[{"n":"שם מהרשימה","sets":3,"rep":"8-12","rest":90}]}]}');
  const all = new Set(Object.values(g).flat());
  const days2 = (Array.isArray(out.days) ? out.days : []).slice(0, 7).map(d => ({ name: t(d.name, 60) || 'יום', ex: (Array.isArray(d.ex) ? d.ex : []).slice(0, 12).filter(x => obj(x) && t(x.n, 80)).map(x => ({ n: t(x.n, 80), sets: n(x.sets, 1, 8) || 3, rep: t(String(x.rep == null ? '' : x.rep), 10) || '8-12', rest: n(x.rest, 0, 300) || 90, known: all.has(t(x.n, 80)) })) })).filter(d => d.ex.length);
  if (!days2.length) fail(502, 'ה-AI לא החזיר תוכנית, נסה שוב');
  res.json({ name: t(out.name, 80) || 'תוכנית AI', summary: t(out.summary, 600), days: days2 });
}));

// ---------- web push (rest-timer notifications) ----------
let webpush = null; try { webpush = require('web-push'); } catch (e) { console.log('[push] web-push not installed, notifications disabled'); }
db.exec("create table if not exists kv(k text primary key, v text not null); create table if not exists push_subs(endpoint text primary key, user_id text not null, data text not null)");
let VAPID = null;
if (webpush) {
  const r = db.prepare("select v from kv where k='vapid'").get();
  if (r) VAPID = JSON.parse(r.v); else { VAPID = webpush.generateVAPIDKeys(); db.prepare("insert into kv(k,v) values('vapid',?)").run(JSON.stringify(VAPID)); }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@dorfit.app', VAPID.publicKey, VAPID.privateKey);
}
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)\//;
const restTimers = new Map();
async function sendPush(userId, payload) {
  if (!webpush) return;
  for (const row of db.prepare('select endpoint,data from push_subs where user_id=?').all(userId)) {
    try { await webpush.sendNotification(JSON.parse(row.data), JSON.stringify(payload), { TTL: 120, urgency: 'high' }); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('delete from push_subs where endpoint=?').run(row.endpoint); else console.log('[push] send failed', e.statusCode || e.code || e.message); }
  }
}
app.get('/api/push/key', wrap((req, res) => { auth(req); res.json({ key: VAPID ? VAPID.publicKey : null }); }));
app.post('/api/push/sub', wrap((req, res) => {
  auth(req); if (!webpush) fail(503, 'התראות לא זמינות');
  const sub = (req.body || {}).sub;
  if (!obj(sub) || !str(sub.endpoint, 700) || !PUSH_HOST.test(sub.endpoint) || !obj(sub.keys) || !str(sub.keys.p256dh, 200) || !str(sub.keys.auth, 100)) fail(400, 'מנוי לא תקין');
  db.prepare('insert or replace into push_subs(endpoint,user_id,data) values(?,?,?)').run(sub.endpoint, req.user.id, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }));
  const all = db.prepare('select endpoint from push_subs where user_id=? order by rowid').all(req.user.id);
  all.slice(0, Math.max(0, all.length - 5)).forEach(r => db.prepare('delete from push_subs where endpoint=?').run(r.endpoint));
  res.json({ ok: true });
}));
app.post('/api/push/unsub', wrap((req, res) => { auth(req); const ep = (req.body || {}).endpoint; if (str(ep, 700)) db.prepare('delete from push_subs where endpoint=? and user_id=?').run(ep, req.user.id); res.json({ ok: true }); }));
app.post('/api/push/rest', wrap((req, res) => {
  auth(req, 'trainee'); const secs = Math.round(Number((req.body || {}).secs)), name = String((req.body || {}).name || '').slice(0, 60);
  if (!(secs >= 3 && secs <= 1200)) fail(400, 'זמן לא תקין');
  clearTimeout(restTimers.get(req.user.id));
  const uid = req.user.id;
  restTimers.set(uid, setTimeout(() => { restTimers.delete(uid); sendPush(uid, { title: 'המנוחה הסתיימה', body: name ? 'חזור לסט הבא: ' + name : 'חזור לסט הבא', tag: 'rest', url: '/' }); }, secs * 1000));
  res.json({ ok: true });
}));
app.post('/api/push/cancel', wrap((req, res) => { auth(req); clearTimeout(restTimers.get(req.user.id)); restTimers.delete(req.user.id); res.json({ ok: true }); }));

// ---------- progress photos ----------
db.exec("create table if not exists photos(id text primary key, user_id text not null, ts integer not null, data blob not null)");
app.post('/api/photos', wrap((req, res) => {
  auth(req, 'trainee');
  const d = (req.body || {}).data;
  if (typeof d !== 'string' || !d.startsWith('data:image/jpeg;base64,') || d.length > 650000) fail(400, 'תמונה לא תקינה');
  const buf = Buffer.from(d.slice(23), 'base64');
  if (buf.length < 200 || buf[0] !== 0xFF || buf[1] !== 0xD8) fail(400, 'תמונה לא תקינה');
  const id = 'ph' + crypto.randomBytes(8).toString('hex');
  db.prepare('insert into photos(id,user_id,ts,data) values(?,?,?,?)').run(id, req.user.id, Date.now(), buf);
  const all = db.prepare('select id from photos where user_id=? order by ts').all(req.user.id);
  all.slice(0, Math.max(0, all.length - 120)).forEach(r => db.prepare('delete from photos where id=?').run(r.id));
  res.json({ id });
}));
app.get('/api/photos/:id', wrap((req, res) => {
  auth(req);
  const r = db.prepare('select user_id,data from photos where id=?').get(req.params.id);
  if (!r || (req.user.role !== 'coach' && r.user_id !== req.user.id)) fail(404, 'לא נמצא');
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.send(r.data);
}));
app.get('/api/backup/db', wrap(async (req, res) => {
  auth(req, 'coach');
  const tmp = path.join(require('os').tmpdir(), 'dorfit-dl-' + Date.now() + '.db');
  await db.backup(tmp);
  res.download(tmp, 'dorfit-' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }) + '.db', () => { try { fs.unlinkSync(tmp); } catch (e) {} });
}));
app.get('/api/export', wrap((req, res) => {
  auth(req, 'coach');
  res.set('Content-Disposition', 'attachment; filename="dorfit-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.json({ users: db.prepare('select id,username,role,data from users').all().map(r => ({ ...r, data: J(r.data) })), docs: db.prepare('select * from docs').all().map(r => ({ ...r, data: J(r.data) })) });
}));
app.get('/api/moh', wrap((req, res) => {
  auth(req);
  const p = [path.join(__dirname, 'moh-foods.json.gz'), path.join(__dirname, 'public', 'moh-foods.json.gz')].find(x => fs.existsSync(x));
  if (!p) return res.status(404).json({ error: 'המאגר הרשמי לא הועלה' });
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'private, no-cache' });
  res.sendFile(p);
}));
app.get('/api/exlib', wrap((req, res) => {
  auth(req);
  const p = [path.join(__dirname, 'exlib.json.gz'), path.join(__dirname, 'public', 'exlib.json.gz')].find(x => fs.existsSync(x));
  if (!p) return res.status(404).json({ error: 'קטלוג התרגילים לא הועלה' });
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'private, no-cache' });
  res.sendFile(p);
}));
let BCS = null;
const offCache = new Map();
const gtinOk = c => { if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return false; const d = [...c].reverse().map(Number); let t = 0; d.forEach((x, i) => { if (i) t += x * (i % 2 ? 3 : 1); }); return (10 - t % 10) % 10 === d[0]; };
const fromOff = j => {
  const p = j && j.product; if (!p) return null; const n = p.nutriments || {};
  const name = String(p.product_name_he || p.product_name || '').trim(); if (!name) return null;
  let k = Number(n['energy-kcal_100g']); if (!Number.isFinite(k)) { const kj = Number(n['energy_100g']); k = Number.isFinite(kj) ? kj / 4.184 : NaN; }
  const pr = Number(n.proteins_100g), c = Number(n.carbohydrates_100g), f = Number(n.fat_100g);
  if (![k, pr, c, f].every(Number.isFinite) || k < 0 || k > 950 || Math.max(pr, c, f) > 100) return null;
  const est = 4 * pr + 4 * c + 9 * f; if (Math.abs(k - est) > Math.max(60, 0.5 * est)) return null;
  const brand = String(p.brands || '').split(',')[0].trim();
  const r1 = x => Math.round(x * 10) / 10, units = [], sq = Number(p.serving_quantity), pq = Number(String(p.quantity || '').replace(/[^\d.]/g, ''));
  if (sq > 0 && sq <= 2000) units.push(['מנה (' + r1(sq) + ' גרם)', r1(sq)]);
  else if (pq > 0 && pq <= 5000 && /(g|ml|גרם|מל)/i.test(String(p.quantity || ''))) units.push(['אריזה (' + Math.round(pq) + ' גרם)', Math.round(pq)]);
  return [(name + (brand && !name.toLowerCase().includes(brand.toLowerCase()) ? ' · ' + brand : '')).slice(0, 120), 'מוצרים ארוזים', r1(k), r1(pr), r1(c), r1(f), units];
};
app.get('/api/barcode/:code', wrap(async (req, res) => {
  auth(req);
  const code = String(req.params.code || '');
  if (!/^\d{8,14}$/.test(code)) fail(400, 'ברקוד לא תקין');
  if (!BCS) {
    const p = [path.join(__dirname, 'barcodes.json.gz'), path.join(__dirname, 'public', 'barcodes.json.gz')].find(x => fs.existsSync(x));
    try { BCS = p ? JSON.parse(require('zlib').gunzipSync(fs.readFileSync(p)).toString('utf8')) : {}; } catch (e) { BCS = {}; }
  }
  const alt = [code, code.replace(/^0+/, ''), code.padStart(13, '0')];
  for (const c of alt) if (BCS[c] !== undefined) return res.json({ i: BCS[c], code });
  if (offCache.has(code)) return res.json(offCache.get(code));
  let out = { none: true, code };
  try {
    const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + code + '.json?fields=product_name,product_name_he,brands,nutriments,serving_quantity,quantity', { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'DorFit/1.0 (personal training app)' } });
    if (r.ok) { const row = fromOff(await r.json()); if (row) out = { row, code }; }
  } catch (e) { out = { none: true, code, offline: true }; }
  if (!out.offline) { if (offCache.size > 2000) offCache.clear(); offCache.set(code, out); }
  res.json(out);
}));
app.get('/api/config', (req, res) => res.json({ apk: !!process.env.APK_URL }));
app.get('/apk', (req, res) => process.env.APK_URL ? res.redirect(process.env.APK_URL) : res.status(404).type('text/plain').send('APK link is not configured'));
app.get('/healthz', (req, res) => res.send('ok'));
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

const WEB = ['index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'sw.js', 'zxing.min.js'];
const webFile = f => [path.join(__dirname, 'public', f), path.join(__dirname, f)].find(p => fs.existsSync(p));
app.get(['/', '/index.html', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/sw.js', '/zxing.min.js'], (req, res) => {
  const f = req.path === '/' ? 'index.html' : req.path.slice(1);
  const p = WEB.includes(f) && webFile(f);
  if (!p) return res.status(404).send('missing ' + f);
  if (/index\.html$|sw\.js$/.test(f)) res.set('Cache-Control', 'no-cache');
  res.sendFile(p);
});
app.use((req, res) => res.sendFile(webFile('index.html')));

if (require.main === module) app.listen(PORT, () => console.log('DOR FIT listening on :' + PORT));

// ---------- scheduled reminders (daily + periodic check-in) ----------
const TZ = process.env.APP_TZ || 'Asia/Jerusalem';
const nowLocal = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return { d: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute }; };
const isoAdd = (iso, n) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const isoDiff = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
db.exec("create table if not exists push_log(user_id text not null, kind text not null, d text not null, primary key(user_id,kind,d))");
const logged = (u, k, d) => !!db.prepare('select 1 from push_log where user_id=? and kind=? and d=?').get(u, k, d);
const markLogged = (u, k, d) => { db.prepare('insert or ignore into push_log(user_id,kind,d) values(?,?,?)').run(u, k, d); db.prepare("delete from push_log where d < ?").run(isoAdd(d, -30)); };
async function runReminders(now) {
  if (!webpush) return;
  const { d, hm } = now || nowLocal();
  if (hm >= '22:00') return;
  const rows = db.prepare("select id,data from users where role='trainee' and exists(select 1 from push_subs s where s.user_id=users.id)").all();
  for (const r of rows) {
    const data = J(r.data);
    if ((data.status && data.status !== 'פעיל') || data.remOff) continue;
    const okT = v => /^\d\d:\d\d$/.test(v || ''); const t = okT(data.rtime) ? data.rtime : okT(data.remT) ? data.remT : '10:00';
    if (hm < t) continue;
    if (!(data.checkin && data.checkin.done && data.day === d) && !logged(r.id, 'ci', d)) {
      markLogged(r.id, 'ci', d);
      await sendPush(r.id, { title: 'צ׳ק-אין יומי', body: 'כמה שעות ישנת ועד כמה היית רעב אתמול? לוקח דקה.', tag: 'ci', url: '/' });
    }
    const f = data.cif === undefined ? 14 : data.cif;
    if (f > 0 && data.cia !== d && !logged(r.id, 'pci', d)) {
      const created = data.created ? new Date(data.created).toISOString().slice(0, 10) : null;
      const due = data.cia ? isoAdd(data.cia, f) : (created ? isoAdd(created, 3) : null);
      const late = due ? isoDiff(due, d) : -1;
      if (late === 0 || late === 2) { markLogged(r.id, 'pci', d); await sendPush(r.id, { title: 'צ׳ק-אין תקופתי', body: 'הגיע הזמן לעדכן היקפים ולהעלות תמונות התקדמות.', tag: 'pci', url: '/' }); }
    }
  }
}
if (webpush && !process.env.NO_REMINDERS) setInterval(() => runReminders().catch(e => console.log('[reminders]', e.message)), 60000);
module.exports = app;
module.exports.runReminders = runReminders;
module.exports.nowLocal = nowLocal;

