'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const Sorteo = require('./public/draw.js'); // mismo algoritmo que usa el botón "Al azar"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'intercambio.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  console.warn('[aviso] ADMIN_PASSWORD no está definido: el panel de admin quedará deshabilitado.');
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    pin_hash TEXT,
    claimed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    user_agent TEXT
  );

  CREATE TABLE IF NOT EXISTS assignments (
    giver_id INTEGER PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    drawn_at TEXT
  );

  CREATE TABLE IF NOT EXISTS quinielas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS predictions (
    quiniela_id INTEGER NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
    giver_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    PRIMARY KEY (quiniela_id, giver_id)
  );
`);

const DEFAULT_SETTINGS = {
  phase: 'setup', // setup → open (quinielas) → drawing (papelitos) → revealed
  avoid_same_family: '1',
  event_name: 'Intercambio Familiar',
  min_quinielas: '1',
  quiniela_cost_cents: '0', // costo por quiniela, en centavos; se paga antes de iniciar el sorteo
  payment_contact: 'Richi', // a quién buscar para pagar las quinielas antes de la cena
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

// Migración: cada quiniela guarda el costo vigente al crearla.
if (!db.prepare('PRAGMA table_info(quinielas)').all().some((c) => c.name === 'cost_cents')) {
  db.exec('ALTER TABLE quinielas ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0');
}

// Migración: nota por invitado para quien no lo conoce (p. ej. "es la mamá de Anette"). Se muestra a
// quien le toque regalarle, en las quinielas y en la pantalla de revelación.
if (!db.prepare('PRAGMA table_info(guests)').all().some((c) => c.name === 'note')) {
  db.exec("ALTER TABLE guests ADD COLUMN note TEXT NOT NULL DEFAULT ''");
}
// Qué familias ven la nota: arreglo JSON con NOMBRES de familia (los ids cambian al volver a guardar
// la lista). Vacío = la ven todos. La pantalla de revelación (organizador) siempre la muestra.
if (!db.prepare('PRAGMA table_info(guests)').all().some((c) => c.name === 'note_families')) {
  db.exec("ALTER TABLE guests ADD COLUMN note_families TEXT NOT NULL DEFAULT '[]'");
}
const MAX_NOTE = 120;
function noteFamilies(json) {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
/** La nota tal como la ve alguien de la familia `viewerFamily` (nombre; null si no ha entrado). */
function noteFor(note, familiesJson, viewerFamily) {
  if (!note) return '';
  const fams = noteFamilies(familiesJson);
  return !fams.length || (viewerFamily != null && fams.includes(viewerFamily)) ? note : '';
}

// Candado a nivel base de datos: nadie puede recibir dos papelitos (giver_id ya es llave primaria,
// así que nadie puede dar dos).
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS assignments_receiver_unique ON assignments(receiver_id)');

// Migración: en versiones anteriores "open" ya tenía papelitos generados.
if (
  db.prepare("SELECT value FROM settings WHERE key = 'phase'").get()?.value === 'open' &&
  db.prepare('SELECT COUNT(*) AS c FROM assignments').get().c > 0
) {
  db.prepare("UPDATE settings SET value = 'drawing' WHERE key = 'phase'").run();
}

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const MAX_QUINIELAS_PER_GUEST = 50;
const MAX_COST_CENTS = 10_000_000; // $100,000
const formatMoney = (cents) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPin(pin, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // cookie malformada: se ignora
    }
  }
  return out;
}

/**
 * Freno contra adivinar contraseñas/PINs. Cada `max` fallos dentro de la ventana bloquea la
 * llave; cada bloqueo nuevo dura el doble que el anterior (tope: maxLockMs). Vive en memoria.
 */
function makeLimiter({ max, windowMs, lockMs, maxLockMs = 24 * 60 * 60 * 1000 }) {
  const map = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of map) if (v.until < now && now - v.first > windowMs && now - v.lastLock > maxLockMs) map.delete(k);
  }, 10 * 60 * 1000).unref();
  return {
    /** Milisegundos que faltan de bloqueo (0 si no está bloqueado). */
    blockedFor(key) {
      const v = map.get(key);
      return v && v.until > Date.now() ? v.until - Date.now() : 0;
    },
    fail(key) {
      const now = Date.now();
      let v = map.get(key);
      if (!v) map.set(key, (v = { count: 0, first: now, until: 0, locks: 0, lastLock: 0 }));
      if (now - v.first > windowMs) {
        v.count = 0;
        v.first = now;
      }
      if (++v.count >= max) {
        v.until = now + Math.min(lockMs * 2 ** v.locks, maxLockMs);
        v.locks++;
        v.lastLock = now;
        v.count = 0;
        v.first = now;
      }
    },
    clear(key) {
      map.delete(key);
    },
  };
}
const minutes = (ms) => Math.max(1, Math.ceil(ms / 60000));
// PIN: 5 fallos → 10 min, luego 20, 40, 80… (por invitado). Además, por IP: 30 fallos en 15 min.
const pinLimiter = makeLimiter({ max: 5, windowMs: 10 * 60 * 1000, lockMs: 10 * 60 * 1000 });
const pinIpLimiter = makeLimiter({ max: 30, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });
// Admin: 8 fallos en 15 min por IP → 15 min, luego 30, 60…
const adminLimiter = makeLimiter({ max: 8, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });
// Desbloquear la pestaña Sorteo: 5 fallos en 15 min por IP → 15 min, luego 30, 60…
const drawUnlockLimiter = makeLimiter({ max: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });

function allGuests() {
  return db
    .prepare(
      `SELECT g.id, g.name, g.family_id, f.name AS family, g.note, g.note_families, g.claimed_at IS NOT NULL AS claimed
       FROM guests g JOIN families f ON f.id = g.family_id
       ORDER BY f.id, g.id`
    )
    .all()
    .map((g) => ({ ...g, claimed: !!g.claimed }));
}

/**
 * Genera un sorteo válido y uniforme (ver public/draw.js): nadie se regala a sí mismo,
 * (opcional) nadie regala a su familia, cada quien da una vez y recibe una vez.
 */
function generateDraw(guests, avoidFamily) {
  const err = Sorteo.feasibilityError(guests, avoidFamily);
  if (err) throw new HttpError(400, err);
  const { draw, method } = Sorteo.generate(guests, { avoidFamily });
  if (method !== 'exact') console.log(`[sorteo] reglas muy estrictas: se usó el método de mezcla (${guests.length} invitados).`);
  return draw;
}

function parseGuestList(text) {
  // Formatos aceptados:
  //   Familia García: Juan, María, Pedro
  //   o bien
  //   # Familia García
  //   Juan
  //   María
  const families = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (line.startsWith('#')) {
      current = { name: line.replace(/^#+/, '').trim(), members: [] };
      families.push(current);
    } else if (colon > -1) {
      current = { name: line.slice(0, colon).trim(), members: [] };
      families.push(current);
      const rest = line.slice(colon + 1);
      for (const m of rest.split(',')) if (m.trim()) current.members.push(m.trim());
    } else {
      if (!current) {
        current = { name: 'Sin familia', members: [] };
        families.push(current);
      }
      for (const m of line.split(',')) if (m.trim()) current.members.push(m.trim());
    }
  }
  const clean = families.filter((f) => f.name && f.members.length);
  const seen = new Set();
  for (const f of clean) {
    if (f.name.length > 60) throw new HttpError(400, `El nombre de familia "${f.name.slice(0, 30)}…" es demasiado largo.`);
    for (const m of f.members) {
      const k = m.toLowerCase();
      if (m.length > 40) throw new HttpError(400, `El nombre "${m.slice(0, 30)}…" es demasiado largo (máx. 40 caracteres).`);
      if (seen.has(k)) throw new HttpError(400, `Nombre repetido: "${m}". Agrega un apellido o apodo para distinguirlos.`);
      seen.add(k);
    }
  }
  return clean;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // solo Caddy va al frente
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    // HTML/JS/CSS siempre revalidan para que los cambios lleguen al instante.
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    next(e);
  }
};

// Sesión del invitado
app.use((req, _res, next) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db
      .prepare(
        `SELECT g.id, g.name, g.family_id, f.name AS family
         FROM sessions s JOIN guests g ON g.id = s.guest_id JOIN families f ON f.id = g.family_id
         WHERE s.token = ?`
      )
      .get(token);
    if (row) {
      req.me = row;
      req.sid = token;
    }
  }
  next();
});
const requireMe = (req) => {
  if (!req.me) throw new HttpError(401, 'Primero elige tu nombre.');
  return req.me;
};
const requireAdmin = (req, _res, next) => {
  const wait = adminLimiter.blockedFor(req.ip);
  if (wait) return next(new HttpError(429, `Demasiados intentos. Espera ${minutes(wait)} min.`));
  const key = req.headers['x-admin-key'];
  if (!ADMIN_PASSWORD || !key || !safeEqual(key, ADMIN_PASSWORD)) {
    adminLimiter.fail(req.ip);
    return next(new HttpError(401, 'Contraseña de admin incorrecta.'));
  }
  adminLimiter.clear(req.ip);
  next();
};

function meInfo(me) {
  if (!me) return null;
  const a = db.prepare('SELECT drawn_at FROM assignments WHERE giver_id = ?').get(me.id);
  const q = db.prepare('SELECT COUNT(*) AS c FROM quinielas WHERE author_id = ?').get(me.id).c;
  const owedCents = db.prepare('SELECT COALESCE(SUM(cost_cents), 0) AS t FROM quinielas WHERE author_id = ?').get(me.id).t;
  return { id: me.id, name: me.name, family: me.family, family_id: me.family_id, hasDrawn: !!a?.drawn_at, quinielas: q, owedCents };
}

// --- Público --------------------------------------------------------------
app.get(
  '/api/state',
  wrap((req) => {
    // Cada quien sólo recibe las notas que su familia puede ver (y nunca la lista de familias).
    const guests = allGuests().map(({ note_families, ...g }) => ({ ...g, note: noteFor(g.note, note_families, req.me?.family) }));
    const drawn = db.prepare('SELECT COUNT(*) AS c FROM assignments WHERE drawn_at IS NOT NULL').get().c;
    const totalQ = db.prepare('SELECT COUNT(*) AS c FROM quinielas').get().c;
    const withQuiniela = db.prepare('SELECT COUNT(DISTINCT author_id) AS c FROM quinielas').get().c;
    const potCents = db.prepare('SELECT COALESCE(SUM(cost_cents), 0) AS t FROM quinielas').get().t;
    return {
      phase: getSetting('phase'),
      eventName: getSetting('event_name'),
      avoidSameFamily: getSetting('avoid_same_family') === '1',
      minQuinielas: Number(getSetting('min_quinielas')),
      quinielaCostCents: Number(getSetting('quiniela_cost_cents')),
      paymentContact: getSetting('payment_contact') || '',
      guests,
      stats: { guests: guests.length, drawn, quinielas: totalQ, withQuiniela, potCents },
      me: meInfo(req.me),
    };
  })
);

app.post(
  '/api/claim',
  wrap((req, res) => {
    const { guestId, pin } = req.body || {};
    if (!/^\d{4}$/.test(String(pin || ''))) throw new HttpError(400, 'El PIN debe ser de 4 dígitos.');
    const g = db.prepare('SELECT id, pin_hash FROM guests WHERE id = ?').get(Number(guestId));
    if (!g) throw new HttpError(404, 'Invitado no encontrado.');
    if (g.pin_hash) {
      const wait = Math.max(pinLimiter.blockedFor(g.id), pinIpLimiter.blockedFor(req.ip));
      if (wait) throw new HttpError(429, `Demasiados intentos. Espera ${minutes(wait)} min o pide al organizador que restablezca tu PIN.`);
      if (!checkPin(pin, g.pin_hash)) {
        pinLimiter.fail(g.id);
        pinIpLimiter.fail(req.ip);
        throw new HttpError(403, 'PIN incorrecto. Si lo olvidaste, pide al organizador que lo restablezca.');
      }
      pinLimiter.clear(g.id);
    } else {
      db.prepare("UPDATE guests SET pin_hash = ?, claimed_at = datetime('now') WHERE id = ?").run(hashPin(pin), g.id);
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, guest_id, user_agent) VALUES (?, ?, ?)').run(token, g.id, String(req.headers['user-agent'] || '').slice(0, 200));
    res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${req.secure ? '; Secure' : ''}`);
    return { ok: true };
  })
);

app.post(
  '/api/logout',
  wrap((req, res) => {
    if (req.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sid);
    res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { ok: true };
  })
);

app.get(
  '/api/quinielas/mine',
  wrap((req) => {
    const me = requireMe(req);
    const qs = db.prepare('SELECT id, name, created_at, cost_cents FROM quinielas WHERE author_id = ? ORDER BY id DESC').all(me.id);
    const preds = db.prepare('SELECT giver_id, receiver_id FROM predictions WHERE quiniela_id = ?');
    return qs.map((q) => ({ ...q, predictions: preds.all(q.id) }));
  })
);

// Una quiniela válida: cada invitado regala exactamente una vez y recibe exactamente una vez, y
// nadie se regala a sí mismo. A diferencia del sorteo real, en la quiniela sí se permite predecir
// un regalo dentro de la misma familia.
function validatePredictions(predictions) {
  const guests = allGuests();
  const byId = new Map(guests.map((g) => [g.id, g]));
  if (!Array.isArray(predictions) || predictions.length !== guests.length) throw new HttpError(400, 'La quiniela debe estar completa: un destinatario para cada invitado.');
  const givers = new Set();
  const receivers = new Set();
  for (const p of predictions) {
    const g = byId.get(Number(p?.giver_id));
    const r = byId.get(Number(p?.receiver_id));
    if (!g || !r) throw new HttpError(400, 'Hay invitados inválidos en la quiniela.');
    if (g.id === r.id) throw new HttpError(400, `${g.name} no puede regalarse a sí mismo.`);
    if (givers.has(g.id)) throw new HttpError(400, `${g.name} aparece dos veces como quien regala.`);
    if (receivers.has(r.id)) throw new HttpError(400, `${r.name} recibe más de un regalo.`);
    givers.add(g.id);
    receivers.add(r.id);
  }
}

app.post(
  '/api/quinielas',
  wrap((req) => {
    const me = requireMe(req);
    const phase = getSetting('phase');
    if (phase === 'setup') throw new HttpError(400, 'Las quinielas todavía no están abiertas.');
    if (phase !== 'open') throw new HttpError(400, 'Las quinielas se cerraron cuando inició el sorteo.');
    const info = meInfo(me);
    if (info.quinielas >= MAX_QUINIELAS_PER_GUEST) throw new HttpError(400, `Llegaste al máximo de ${MAX_QUINIELAS_PER_GUEST} quinielas.`);
    const { name, predictions, acceptedCostCents } = req.body || {};
    const costCents = Number(getSetting('quiniela_cost_cents'));
    // Si el organizador cambió el costo mientras la persona llenaba su quiniela, pedir que lo confirme de nuevo.
    if (acceptedCostCents !== undefined && Number(acceptedCostCents) !== costCents) {
      throw new HttpError(409, `El costo por quiniela cambió a ${formatMoney(costCents)}. Revísalo y vuelve a guardar.`);
    }
    validatePredictions(predictions);
    const qName = String(name || '').trim().slice(0, 60) || `Quiniela de ${me.name}`;
    const id = tx(() => {
      const { lastInsertRowid } = db.prepare('INSERT INTO quinielas (author_id, name, cost_cents) VALUES (?, ?, ?)').run(me.id, qName, costCents);
      const ins = db.prepare('INSERT INTO predictions (quiniela_id, giver_id, receiver_id) VALUES (?, ?, ?)');
      for (const p of predictions) ins.run(lastInsertRowid, Number(p.giver_id), Number(p.receiver_id));
      return Number(lastInsertRowid);
    });
    return { ok: true, id };
  })
);

// Editar una quiniela propia mientras las quinielas sigan abiertas. Conserva su costo original.
app.put(
  '/api/quinielas/:id',
  wrap((req) => {
    const me = requireMe(req);
    if (getSetting('phase') !== 'open') throw new HttpError(400, 'Las quinielas se cerraron cuando inició el sorteo; ya no se pueden editar.');
    const id = Number(req.params.id);
    const q = db.prepare('SELECT id FROM quinielas WHERE id = ? AND author_id = ?').get(id, me.id);
    if (!q) throw new HttpError(404, 'Quiniela no encontrada.');
    const { name, predictions } = req.body || {};
    validatePredictions(predictions);
    const qName = String(name || '').trim().slice(0, 60) || `Quiniela de ${me.name}`;
    tx(() => {
      db.prepare('UPDATE quinielas SET name = ? WHERE id = ?').run(qName, id);
      db.prepare('DELETE FROM predictions WHERE quiniela_id = ?').run(id);
      const ins = db.prepare('INSERT INTO predictions (quiniela_id, giver_id, receiver_id) VALUES (?, ?, ?)');
      for (const p of predictions) ins.run(id, Number(p.giver_id), Number(p.receiver_id));
    });
    return { ok: true, id };
  })
);

app.delete(
  '/api/quinielas/:id',
  wrap((req) => {
    const me = requireMe(req);
    if (getSetting('phase') !== 'open') throw new HttpError(400, 'Las quinielas se cerraron cuando inició el sorteo.');
    const r = db.prepare('DELETE FROM quinielas WHERE id = ? AND author_id = ?').run(Number(req.params.id), me.id);
    if (!r.changes) throw new HttpError(404, 'Quiniela no encontrada.');
    return { ok: true };
  })
);

/** A quién le regala `me`, con la nota sólo si su familia puede verla. */
function receiverFor(receiverId, me) {
  const r = db
    .prepare('SELECT g.name, f.name AS family, g.note, g.note_families FROM guests g JOIN families f ON f.id = g.family_id WHERE g.id = ?')
    .get(receiverId);
  return { name: r.name, family: r.family, note: noteFor(r.note, r.note_families, me.family) };
}

app.post(
  '/api/draw',
  wrap((req) => {
    const me = requireMe(req);
    const phase = getSetting('phase');
    if (phase === 'setup' || phase === 'open') throw new HttpError(400, 'El organizador todavía no inicia el sorteo.');
    const a = db.prepare('SELECT receiver_id, drawn_at FROM assignments WHERE giver_id = ?').get(me.id);
    if (!a) throw new HttpError(400, 'No tienes papelito asignado. Avisa al organizador.');
    if (!a.drawn_at) {
      if (phase !== 'drawing') throw new HttpError(400, 'El sorteo ya está cerrado.');
      db.prepare("UPDATE assignments SET drawn_at = datetime('now') WHERE giver_id = ?").run(me.id);
    }
    return { receiver: receiverFor(a.receiver_id, me), firstTime: !a.drawn_at };
  })
);

app.get(
  '/api/my-draw',
  wrap((req) => {
    const me = requireMe(req);
    const a = db.prepare('SELECT receiver_id, drawn_at FROM assignments WHERE giver_id = ?').get(me.id);
    if (!a?.drawn_at) return { receiver: null };
    return { receiver: receiverFor(a.receiver_id, me) };
  })
);

function buildResults() {
  const guests = allGuests();
  const byId = new Map(guests.map((g) => [g.id, g]));
  const truth = new Map(db.prepare('SELECT giver_id, receiver_id FROM assignments').all().map((a) => [a.giver_id, a.receiver_id]));
  const qs = db
    .prepare('SELECT q.id, q.name, q.author_id, g.name AS author, q.created_at FROM quinielas q JOIN guests g ON g.id = q.author_id')
    .all();
  const preds = db.prepare('SELECT giver_id, receiver_id FROM predictions WHERE quiniela_id = ?');
  const leaderboard = qs
    .map((q) => {
      const p = preds.all(q.id);
      const hits = p.filter((x) => truth.get(x.giver_id) === x.receiver_id).length;
      return { ...q, hits, total: p.length };
    })
    .sort((a, b) => b.hits - a.hits || a.created_at.localeCompare(b.created_at));
  const pairs = guests.map((g) => ({ giver: g.name, giverFamily: g.family, receiver: byId.get(truth.get(g.id))?.name || '—' }));
  const potCents = db.prepare('SELECT COALESCE(SUM(cost_cents), 0) AS t FROM quinielas').get().t;
  return { leaderboard, pairs, potCents };
}

app.get(
  '/api/results',
  wrap(() => {
    if (getSetting('phase') !== 'revealed') throw new HttpError(400, 'Los resultados aún no se revelan.');
    return buildResults();
  })
);

// --- Admin ----------------------------------------------------------------
const admin = express.Router();
admin.use(requireAdmin);

admin.get(
  '/state',
  wrap(() => {
    const guests = db
      .prepare(
        `SELECT g.id, g.name, f.name AS family, g.note, g.note_families, g.claimed_at,
                a.drawn_at,
                (SELECT COUNT(*) FROM quinielas q WHERE q.author_id = g.id) AS quinielas,
                (SELECT COALESCE(SUM(cost_cents), 0) FROM quinielas q WHERE q.author_id = g.id) AS owed_cents,
                (SELECT COUNT(*) FROM sessions s WHERE s.guest_id = g.id) AS sessions
         FROM guests g JOIN families f ON f.id = g.family_id
         LEFT JOIN assignments a ON a.giver_id = g.id
         ORDER BY f.id, g.id`
      )
      .all()
      .map((g) => ({ ...g, note_families: noteFamilies(g.note_families) }));
    const families = db
      .prepare(
        `SELECT f.name, (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT name FROM guests WHERE family_id = f.id ORDER BY id)) AS members
         FROM families f ORDER BY f.id`
      )
      .all()
      .filter((f) => f.members);
    const listText = families.map((f) => `${f.name}: ${f.members}`).join('\n');
    return {
      phase: getSetting('phase'),
      eventName: getSetting('event_name'),
      avoidSameFamily: getSetting('avoid_same_family') === '1',
      minQuinielas: Number(getSetting('min_quinielas')),
      quinielaCostCents: Number(getSetting('quiniela_cost_cents')),
      paymentContact: getSetting('payment_contact') || '',
      guests,
      familyNames: families.map((f) => f.name),
      listText,
    };
  })
);

// Quién le regala a quién. El estado general del panel NO lo incluye: sólo se entrega aquí,
// escribiendo otra vez la contraseña (pestaña Sorteo bloqueada).
admin.post(
  '/draw',
  wrap((req) => {
    const wait = drawUnlockLimiter.blockedFor(req.ip);
    if (wait) throw new HttpError(429, `Demasiados intentos. Espera ${minutes(wait)} min.`);
    const password = req.body?.password;
    if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
      drawUnlockLimiter.fail(req.ip);
      throw new HttpError(403, 'Contraseña incorrecta.');
    }
    drawUnlockLimiter.clear(req.ip);
    const pairs = db
      .prepare(
        `SELECT a.giver_id, a.receiver_id, r.name AS receiver, rf.name AS receiver_family
         FROM assignments a JOIN guests r ON r.id = a.receiver_id JOIN families rf ON rf.id = r.family_id`
      )
      .all();
    // Verificación para el organizador: todos dan, todos reciben, sin repetidos ni reglas rotas.
    const guests = allGuests();
    const map = new Map(pairs.map((p) => [p.giver_id, p.receiver_id]));
    const check = {
      guests: guests.length,
      givers: map.size,
      receivers: new Set(map.values()).size,
      valid: Sorteo.isValidDraw(guests, getSetting('avoid_same_family') === '1', map),
    };
    return { pairs, check };
  })
);

// Pantalla de revelación: todo lo necesario para revelar uno por uno quién le regala a quién y
// recalcular las quinielas en vivo. Con los resultados ya revelados no pide contraseña; antes,
// igual que la pestaña Sorteo, hay que escribirla otra vez.
admin.post(
  '/presentation',
  wrap((req) => {
    const phase = getSetting('phase');
    if (phase !== 'drawing' && phase !== 'revealed') throw new HttpError(400, 'La pantalla está disponible cuando inicie el sorteo.');
    if (phase !== 'revealed') {
      const wait = drawUnlockLimiter.blockedFor(req.ip);
      if (wait) throw new HttpError(429, `Demasiados intentos. Espera ${minutes(wait)} min.`);
      const password = req.body?.password;
      if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
        drawUnlockLimiter.fail(req.ip);
        throw new HttpError(403, 'Contraseña incorrecta.');
      }
      drawUnlockLimiter.clear(req.ip);
    }
    // Sin notas: la pantalla se proyecta frente a todos.
    const guests = allGuests().map(({ id, name, family }) => ({ id, name, family }));
    const pairs = db.prepare('SELECT giver_id, receiver_id FROM assignments').all().map((a) => [a.giver_id, a.receiver_id]);
    const preds = db.prepare('SELECT giver_id, receiver_id FROM predictions WHERE quiniela_id = ?');
    const quinielas = db
      .prepare('SELECT q.id, q.name, q.author_id, g.name AS author, q.created_at FROM quinielas q JOIN guests g ON g.id = q.author_id ORDER BY q.created_at, q.id')
      .all()
      .map((q) => ({ ...q, predictions: preds.all(q.id).map((p) => [p.giver_id, p.receiver_id]) }));
    const potCents = db.prepare('SELECT COALESCE(SUM(cost_cents), 0) AS t FROM quinielas').get().t;
    return { eventName: getSetting('event_name'), phase, guests, pairs, quinielas, potCents };
  })
);

admin.post(
  '/settings',
  wrap((req) => {
    const { eventName, avoidSameFamily, minQuinielas, quinielaCostCents, paymentContact } = req.body || {};
    if (quinielaCostCents !== undefined) {
      const c = Math.round(Number(quinielaCostCents));
      if (!Number.isFinite(c) || c < 0 || c > MAX_COST_CENTS) throw new HttpError(400, 'El costo por quiniela no es válido.');
      if (getSetting('phase') === 'drawing' || getSetting('phase') === 'revealed') {
        if (c !== Number(getSetting('quiniela_cost_cents'))) throw new HttpError(400, 'El costo ya no se puede cambiar: las quinielas están cerradas.');
      }
      setSetting('quiniela_cost_cents', c);
    }
    if (paymentContact !== undefined) setSetting('payment_contact', String(paymentContact).trim().slice(0, 40));
    if (eventName !== undefined) setSetting('event_name', String(eventName).trim().slice(0, 80) || 'Intercambio Familiar');
    if (minQuinielas !== undefined) setSetting('min_quinielas', Math.max(0, Math.min(20, Number(minQuinielas) || 0)));
    if (avoidSameFamily !== undefined) {
      if (getSetting('phase') !== 'setup') throw new HttpError(400, 'La regla de familias solo se cambia antes de abrir las quinielas.');
      setSetting('avoid_same_family', avoidSameFamily ? '1' : '0');
    }
    return { ok: true };
  })
);

admin.post(
  '/guests',
  wrap((req) => {
    if (getSetting('phase') !== 'setup') throw new HttpError(400, 'Solo puedes cambiar la lista antes de abrir las quinielas.');
    const families = parseGuestList(req.body?.text);
    if (!families.length) throw new HttpError(400, 'La lista está vacía.');
    // Conserva PIN/sesiones de quienes ya existían con el mismo nombre.
    const old = new Map(db.prepare('SELECT id, name, pin_hash, claimed_at, note, note_families FROM guests').all().map((g) => [g.name.toLowerCase(), g]));
    const oldSessions = db.prepare('SELECT token, guest_id, created_at, user_agent FROM sessions').all();
    tx(() => {
      db.exec('DELETE FROM sessions; DELETE FROM predictions; DELETE FROM quinielas; DELETE FROM assignments; DELETE FROM guests; DELETE FROM families;');
      const idMap = new Map();
      const insF = db.prepare('INSERT INTO families (name) VALUES (?)');
      const insG = db.prepare('INSERT INTO guests (family_id, name, pin_hash, claimed_at, note, note_families) VALUES (?, ?, ?, ?, ?, ?)');
      for (const f of families) {
        const { lastInsertRowid } = insF.run(f.name);
        for (const m of f.members) {
          const prev = old.get(m.toLowerCase());
          const r = insG.run(lastInsertRowid, m, prev?.pin_hash ?? null, prev?.claimed_at ?? null, prev?.note ?? '', prev?.note_families ?? '[]');
          if (prev) idMap.set(prev.id, Number(r.lastInsertRowid));
        }
      }
      const insS = db.prepare('INSERT INTO sessions (token, guest_id, created_at, user_agent) VALUES (?, ?, ?, ?)');
      for (const s of oldSessions) if (idMap.has(s.guest_id)) insS.run(s.token, idMap.get(s.guest_id), s.created_at, s.user_agent);
    });
    return { ok: true, families: families.length, guests: families.reduce((s, f) => s + f.members.length, 0) };
  })
);

// 1) Abre las quinielas. Todavía NO existe ningún papelito, así nadie
//    (ni el organizador) puede saber el resultado mientras se llenan.
admin.post(
  '/open',
  wrap(() => {
    if (getSetting('phase') !== 'setup') throw new HttpError(400, 'Las quinielas ya fueron abiertas.');
    // Sólo valida que el sorteo sea posible con las reglas actuales; no se guarda.
    generateDraw(allGuests(), getSetting('avoid_same_family') === '1');
    tx(() => {
      db.exec('DELETE FROM assignments');
      setSetting('phase', 'open');
    });
    return { ok: true };
  })
);

// 2) Inicia el sorteo: cierra las quinielas y genera los papelitos al azar en este momento.
admin.post(
  '/start-draw',
  wrap(() => {
    if (getSetting('phase') !== 'open') throw new HttpError(400, 'Primero abre las quinielas.');
    const guests = allGuests();
    const avoid = getSetting('avoid_same_family') === '1';
    const draw = generateDraw(guests, avoid);
    tx(() => {
      db.exec('DELETE FROM assignments');
      const ins = db.prepare('INSERT INTO assignments (giver_id, receiver_id) VALUES (?, ?)');
      for (const [g, r] of draw) ins.run(g, r);
      // Doble verificación con lo que quedó guardado: si algo no cuadra, se revierte todo.
      const saved = new Map(db.prepare('SELECT giver_id, receiver_id FROM assignments').all().map((a) => [a.giver_id, a.receiver_id]));
      if (!Sorteo.isValidDraw(guests, avoid, saved)) throw new Error('El sorteo guardado no pasó la verificación.');
      setSetting('phase', 'drawing');
    });
    return { ok: true };
  })
);

admin.post(
  '/reveal',
  wrap(() => {
    if (getSetting('phase') !== 'drawing') throw new HttpError(400, 'Primero inicia el sorteo.');
    setSetting('phase', 'revealed');
    return { ok: true };
  })
);

admin.post(
  '/unreveal',
  wrap(() => {
    if (getSetting('phase') !== 'revealed') throw new HttpError(400, 'Los resultados no están revelados.');
    setSetting('phase', 'drawing');
    return { ok: true };
  })
);

admin.post(
  '/reset',
  wrap((req) => {
    // Regresa a "setup": borra sorteo y quinielas. Conserva lista y PINs.
    if (req.body?.confirm !== 'REINICIAR') throw new HttpError(400, 'Confirmación requerida.');
    tx(() => {
      db.exec('DELETE FROM predictions; DELETE FROM quinielas; DELETE FROM assignments;');
      setSetting('phase', 'setup');
    });
    return { ok: true };
  })
);

// Nota de quién es esta persona, para quien no la conoce, y qué familias la ven (`families`:
// nombres; vacío = todos; si no se manda, se conserva). Se puede cambiar en cualquier fase.
admin.post(
  '/guests/:id/note',
  wrap((req) => {
    const id = Number(req.params.id);
    const g = db.prepare('SELECT id, note_families FROM guests WHERE id = ?').get(id);
    if (!g) throw new HttpError(404, 'Invitado no encontrado.');
    const note = String(req.body?.note ?? '').replace(/\s+/g, ' ').trim();
    if (note.length > MAX_NOTE) throw new HttpError(400, `La nota es demasiado larga (máx. ${MAX_NOTE} caracteres).`);
    let families = noteFamilies(g.note_families);
    if (req.body?.families !== undefined) {
      if (!Array.isArray(req.body.families)) throw new HttpError(400, 'Las familias no son válidas.');
      const known = new Set(db.prepare('SELECT name FROM families').all().map((f) => f.name));
      families = [...new Set(req.body.families.map(String))];
      const bad = families.find((f) => !known.has(f));
      if (bad) throw new HttpError(400, `No existe la familia "${bad.slice(0, 40)}".`);
    }
    db.prepare('UPDATE guests SET note = ?, note_families = ? WHERE id = ?').run(note, JSON.stringify(families), id);
    return { ok: true, note, families };
  })
);

admin.post(
  '/guests/:id/reset-pin',
  wrap((req) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM guests WHERE id = ?').get(id)) throw new HttpError(404, 'Invitado no encontrado.');
    pinLimiter.clear(id);
    tx(() => {
      db.prepare('DELETE FROM sessions WHERE guest_id = ?').run(id);
      db.prepare('UPDATE guests SET pin_hash = NULL, claimed_at = NULL WHERE id = ?').run(id);
    });
    return { ok: true };
  })
);

app.use('/api/admin', admin);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No encontrado')));
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  let message = err.message;
  if (status >= 500) message = 'Error interno del servidor. Intenta de nuevo.';
  else if (err.type === 'entity.parse.failed') message = 'Solicitud inválida.';
  res.status(status).json({ error: message });
});

app.listen(PORT, () => console.log(`Intercambio escuchando en http://localhost:${PORT}`));
