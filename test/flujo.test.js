'use strict';
// Prueba de punta a punta: levanta el servidor con una base temporal y recorre todas las fases.
// Correr con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Sorteo = require('../public/draw.js');

const ADMIN = 'clave-de-prueba';
const LIST = `Familia García: Juan, María, Pedro, Lucía
Familia López: Ana, Luis, Sofía
Familia Pérez: Rosa, Toño
Familia Ruiz: Carmen, Diego
Familia Sola: Beto`;

let server;
let base;
let dir;

async function startServer() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intercambio-test-'));
  const port = 41000 + Math.floor(Math.random() * 2000);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: ADMIN, DB_PATH: path.join(dir, 'db.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  server.stderr.on('data', (d) => (err += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/healthz')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El servidor no arrancó: ' + err);
}

async function call(method, url, { body, cookie, admin, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(admin ? { 'x-admin-key': admin } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, res };
}
const adm = (method, url, body) => call(method, '/api/admin' + url, { body, admin: ADMIN });

test.before(startServer);
test.after(() => {
  server?.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('flujo completo: lista → quinielas → sorteo → papelitos → resultados', async () => {
  assert.equal((await adm('POST', '/settings', { avoidSameFamily: true })).status, 200);
  assert.equal((await adm('POST', '/guests', { text: LIST })).status, 200);
  assert.equal((await adm('POST', '/open')).status, 200);

  const { data: st } = await call('GET', '/api/state');
  const guests = st.guests;
  assert.equal(guests.length, 12);
  const famOf = new Map(guests.map((g) => [g.id, g.family_id]));

  // Todos entran con PIN.
  const cookies = new Map();
  for (const g of guests) {
    const r = await call('POST', '/api/claim', { body: { guestId: g.id, pin: '1234' } });
    assert.equal(r.status, 200);
    cookies.set(g.id, r.res.headers.get('set-cookie').split(';')[0]);
  }
  const me = (g) => ({ cookie: cookies.get(g.id) });

  // Quinielas inválidas: todas rechazadas con 400 (nunca 500).
  const good = [...Sorteo.generate(guests, { avoidFamily: true }).draw].map(([giver_id, receiver_id]) => ({ giver_id, receiver_id }));
  const g0 = guests[0];
  const bad = [
    good.slice(1), // incompleta
    good.map((p, i) => (i === 0 ? { ...p, receiver_id: p.giver_id } : p)), // a sí mismo
    good.map((p, i) => (i === 1 ? { ...p, receiver_id: good[0].receiver_id } : p)), // receptor duplicado
    good.map((p, i) => (i === 1 ? { ...p, giver_id: good[0].giver_id } : p)), // da dos veces
    [null, ...good.slice(1)], // basura
    'no soy un arreglo',
    good.map((p, i) => (i === 0 ? { ...p, receiver_id: 99999 } : p)), // invitado inexistente
  ];
  for (const predictions of bad) {
    const r = await call('POST', '/api/quinielas', { ...me(g0), body: { predictions } });
    assert.equal(r.status, 400, `debió rechazarse: ${JSON.stringify(r.data)}`);
  }

  // En la quiniela SÍ se permite predecir un regalo dentro de la misma familia (aunque el sorteo
  // real lo evite); sólo regalarse a sí mismo está prohibido.
  const quinielas = new Map();
  const sameFam = good.map((p) => ({ ...p }));
  const a = sameFam.find((p) => famOf.get(p.giver_id) === 1);
  const mate = guests.find((x) => x.family_id === 1 && x.id !== a.giver_id).id;
  const other = sameFam.find((p) => p.receiver_id === mate);
  [a.receiver_id, other.receiver_id] = [mate, a.receiver_id];
  assert.ok(sameFam.every((p) => p.giver_id !== p.receiver_id), 'la prueba no debe incluir a nadie regalándose a sí mismo');
  const famRes = await call('POST', '/api/quinielas', { ...me(g0), body: { name: 'Q familia', predictions: sameFam } });
  assert.equal(famRes.status, 200, `debió aceptarse: ${JSON.stringify(famRes.data)}`);
  quinielas.set(famRes.data.id, sameFam);

  // Cada quien llena una quiniela "al azar".
  for (const g of guests) {
    const predictions = [...Sorteo.generate(guests, { avoidFamily: true }).draw].map(([giver_id, receiver_id]) => ({ giver_id, receiver_id }));
    const r = await call('POST', '/api/quinielas', { ...me(g), body: { name: `Q ${g.name}`, predictions, acceptedCostCents: 0 } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    quinielas.set(r.data.id, predictions);
  }
  // No se puede editar la quiniela de otro.
  const [qid] = quinielas.keys();
  assert.equal((await call('PUT', `/api/quinielas/${qid}`, { ...me(guests[5]), body: { predictions: good } })).status, 404);
  assert.equal((await call('DELETE', `/api/quinielas/${qid}`, { ...me(guests[5]) })).status, 404);

  // Antes del sorteo no hay papelitos ni resultados.
  assert.equal((await call('POST', '/api/draw', me(g0))).status, 400);
  assert.equal((await call('GET', '/api/results')).status, 400);

  // Nota de quién es: se guarda en cualquier fase, se limpia de espacios y tiene tope.
  const noted = guests[4];
  const noteRes = await adm('POST', `/guests/${noted.id}/note`, { note: '  es la mamá   de Anette ' });
  assert.equal(noteRes.status, 200);
  assert.equal(noteRes.data.note, 'es la mamá de Anette');
  assert.equal((await adm('POST', `/guests/${noted.id}/note`, { note: 'x'.repeat(121) })).status, 400);
  assert.equal((await adm('POST', '/guests/99999/note', { note: 'hola' })).status, 404);
  assert.equal((await call('POST', `/api/admin/guests/${noted.id}/note`, { body: { note: 'hola' } })).status, 401);
  const withNote = (await call('GET', '/api/state')).data.guests.find((g) => g.id === noted.id);
  assert.equal(withNote.note, 'es la mamá de Anette');
  assert.equal(withNote.note_families, undefined, 'la lista de familias de la nota no se publica');

  // Nota sólo para ciertas familias: la ven ellas; los demás (y quien no ha entrado) no.
  const famName = (id) => guests.find((g) => g.family_id === id).family;
  const noteState = async (cookie) => (await call('GET', '/api/state', cookie ? { cookie } : {})).data.guests.find((g) => g.id === noted.id).note;
  const inFam = guests.find((g) => g.family_id === 2);
  const outFam = guests.find((g) => g.family_id === 3);
  assert.equal((await adm('POST', `/guests/${noted.id}/note`, { note: 'es la mamá de Anette', families: [famName(2)] })).status, 200);
  assert.equal(await noteState(cookies.get(inFam.id)), 'es la mamá de Anette');
  assert.equal(await noteState(cookies.get(outFam.id)), '');
  assert.equal(await noteState(null), '');
  assert.equal((await adm('POST', `/guests/${noted.id}/note`, { note: 'x', families: ['Familia Inventada'] })).status, 400);
  assert.equal((await adm('POST', `/guests/${noted.id}/note`, { note: 'x', families: 'no' })).status, 400);
  const adminNoted = (await adm('GET', '/state')).data.guests.find((g) => g.id === noted.id);
  assert.deepEqual(adminNoted.note_families, [famName(2)]);
  // Sin `families` se conservan; con [] vuelve a ser para todos.
  assert.deepEqual((await adm('POST', `/guests/${noted.id}/note`, { note: 'es la mamá de Anette' })).data.families, [famName(2)]);
  assert.deepEqual((await adm('POST', `/guests/${noted.id}/note`, { note: 'es la mamá de Anette', families: [] })).data.families, []);
  assert.equal(await noteState(cookies.get(outFam.id)), 'es la mamá de Anette');

  // Inicia el sorteo.
  assert.equal((await adm('POST', '/start-draw')).status, 200);
  assert.equal((await adm('POST', '/start-draw')).status, 400, 'no se puede volver a sortear sin reiniciar');

  // Ya no se puede crear, editar ni borrar quinielas.
  assert.equal((await call('POST', '/api/quinielas', { ...me(g0), body: { predictions: good } })).status, 400);
  assert.equal((await call('PUT', `/api/quinielas/${qid}`, { ...me(guests[0]), body: { predictions: good } })).status, 400);
  assert.equal((await call('DELETE', `/api/quinielas/${qid}`, { ...me(guests[0]) })).status, 400);

  // Todos sacan papelito; el resultado es un sorteo válido.
  const byName = new Map(guests.map((g) => [g.name, g]));
  const draw = new Map();
  for (const g of guests) {
    const r = await call('POST', '/api/draw', me(g));
    assert.equal(r.status, 200);
    assert.equal(r.data.firstTime, true);
    draw.set(g.id, byName.get(r.data.receiver.name).id);
    // Quien le toca a la persona con nota la ve en su papelito; los demás reciben nota vacía.
    assert.equal(r.data.receiver.note, r.data.receiver.name === noted.name ? 'es la mamá de Anette' : '');
    const again = await call('POST', '/api/draw', me(g));
    assert.equal(again.data.receiver.name, r.data.receiver.name, 'el papelito no cambia');
    assert.equal(again.data.firstTime, false);
    assert.equal((await call('GET', '/api/my-draw', me(g))).data.receiver.name, r.data.receiver.name);
  }
  assert.ok(Sorteo.isValidDraw(guests, true, draw), 'el sorteo guardado debe ser válido');

  // El papelito respeta qué familias ven la nota.
  const giverOfNoted = guests.find((g) => draw.get(g.id) === noted.id);
  const papelNote = async () => (await call('GET', '/api/my-draw', me(giverOfNoted))).data.receiver.note;
  await adm('POST', `/guests/${noted.id}/note`, { note: 'es la mamá de Anette', families: [giverOfNoted.family] });
  assert.equal(await papelNote(), 'es la mamá de Anette');
  const otherFam = guests.find((g) => g.family !== giverOfNoted.family && g.family !== noted.family).family;
  await adm('POST', `/guests/${noted.id}/note`, { note: 'es la mamá de Anette', families: [otherFam] });
  assert.equal(await papelNote(), '');

  // Panel: el estado general NO trae los papelitos; sólo /draw con la contraseña escrita de nuevo.
  const { data: adminState } = await adm('GET', '/state');
  assert.ok(!JSON.stringify(adminState).includes('receiver'), 'el estado del panel no debe incluir papelitos');
  assert.equal((await adm('POST', '/draw')).status, 403);
  assert.equal((await adm('POST', '/draw', { password: 'otra' })).status, 403);
  const unlocked = await adm('POST', '/draw', { password: ADMIN });
  assert.equal(unlocked.status, 200);
  assert.deepEqual(unlocked.data.check, { guests: 12, givers: 12, receivers: 12, valid: true });
  for (const p of unlocked.data.pairs) assert.equal(p.receiver_id, draw.get(p.giver_id));
  // Sin la llave de admin no sirve aunque sepa la contraseña en el cuerpo.
  assert.equal((await call('POST', '/api/admin/draw', { body: { password: ADMIN } })).status, 401);
  assert.equal(new Set(draw.values()).size, guests.length, 'cada quien recibe exactamente un regalo');

  // Pantalla de revelación: antes de revelar pide la contraseña otra vez; trae parejas y quinielas.
  assert.equal((await adm('POST', '/presentation')).status, 403);
  assert.equal((await adm('POST', '/presentation', { password: 'otra' })).status, 403);
  const pres = await adm('POST', '/presentation', { password: ADMIN });
  assert.equal(pres.status, 200);
  assert.equal(pres.data.guests.length, 12);
  assert.equal(pres.data.guests.find((g) => g.id === noted.id).note, undefined, 'la pantalla de revelación no muestra notas');
  assert.equal(pres.data.pairs.length, 12);
  for (const [g, r] of pres.data.pairs) assert.equal(r, draw.get(g));
  assert.equal(pres.data.quinielas.length, quinielas.size);
  for (const q of pres.data.quinielas) {
    assert.deepEqual(
      new Map(q.predictions),
      new Map(quinielas.get(q.id).map((p) => [p.giver_id, p.receiver_id]))
    );
  }
  assert.equal((await call('POST', '/api/admin/presentation', { body: { password: ADMIN } })).status, 401);

  // Resultados: parejas y aciertos cuadran.
  assert.equal((await adm('POST', '/reveal')).status, 200);
  assert.equal((await adm('POST', '/presentation')).status, 200, 'ya revelados no pide contraseña');
  const { data: res } = await call('GET', '/api/results');
  for (const p of res.pairs) assert.equal(byName.get(p.receiver).id, draw.get(byName.get(p.giver).id));
  for (const q of res.leaderboard) {
    const preds = quinielas.get(q.id);
    const hits = preds.filter((p) => draw.get(p.giver_id) === p.receiver_id).length;
    assert.equal(q.hits, hits);
    assert.equal(q.total, guests.length);
  }
});

test('50 sorteos seguidos (reiniciar → abrir → sortear) siempre válidos', async () => {
  const { data: st } = await call('GET', '/api/state');
  const guests = st.guests;
  for (let k = 0; k < 50; k++) {
    assert.equal((await adm('POST', '/reset', { confirm: 'REINICIAR' })).status, 200);
    assert.equal((await adm('POST', '/open')).status, 200);
    assert.equal((await adm('POST', '/start-draw')).status, 200);
    const { data } = await adm('POST', '/draw', { password: ADMIN });
    const draw = new Map(data.pairs.map((p) => [p.giver_id, p.receiver_id]));
    assert.ok(Sorteo.isValidDraw(guests, true, draw), `sorteo ${k} inválido`);
    assert.equal(data.check.valid, true);
  }
});

test('seguridad: encabezados, cookie malformada, PIN y contraseña de admin', async () => {
  const home = await fetch(base + '/');
  assert.match(home.headers.get('content-security-policy') || '', /script-src 'self'/);

  // Cookie malformada no tumba el servidor.
  assert.equal((await call('GET', '/api/state', { cookie: 'sid=%E0%A4%A' })).status, 200);

  // PIN: 5 fallos → bloqueado (aunque después se use el PIN correcto).
  const { data: st } = await call('GET', '/api/state');
  const g = st.guests[3];
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/claim', { body: { guestId: g.id, pin: String(1000 + i) } })).status, 403);
  assert.equal((await call('POST', '/api/claim', { body: { guestId: g.id, pin: '1234' } })).status, 429);

  // Desbloquear la pestaña Sorteo: 5 fallos → bloqueado, incluso con la contraseña correcta.
  for (let i = 0; i < 5; i++) assert.equal((await adm('POST', '/draw', { password: 'mala' + i })).status, 403);
  assert.equal((await adm('POST', '/draw', { password: ADMIN })).status, 429);

  // Admin: 8 fallos → bloqueado, incluso con la contraseña correcta.
  for (let i = 0; i < 8; i++) assert.equal((await call('GET', '/api/admin/state', { admin: 'mala' + i })).status, 401);
  assert.equal((await call('GET', '/api/admin/state', { admin: ADMIN })).status, 429);
});
