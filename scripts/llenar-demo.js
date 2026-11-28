'use strict';
// Llena el servidor LOCAL con datos de prueba: la lista de la familia, las notas, el costo y de 1 a 3
// quinielas al azar por invitado, como si todos ya las hubieran llenado. Todos quedan con PIN 1234.
//
//   ADMIN_PASSWORD=demo npm start               # en una terminal
//   ADMIN_PASSWORD=demo npm run demo            # en otra
//   ADMIN_PASSWORD=demo npm run demo -- --sorteo    # además inicia el sorteo (para la pantalla de revelación)
//
// OJO: borra las quinielas y la lista que haya en ese servidor. No lo corras contra producción.

const Sorteo = require('../public/draw.js');

const BASE = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const KEY = process.env.ADMIN_PASSWORD;
const PIN = '1234';
const COSTO_CENTS = Number(process.env.COSTO || 50) * 100;
const conSorteo = process.argv.includes('--sorteo');

const LISTA = `Familia Cuellar Salazar: Amelia, Berenice, Gustavo, Sofia
Familia Guerrero Salazar: Gloria, Luis, Isamar, Alexia
Familia Lopez Salazar: Miriam, Yannin, Luis Chow
Familia Salazar Reyes: Mario, Rosy, Richi, Brandon, Beto, Laura
Familia Renovato Salazar: Yagel, Anette, Ysabella
Familia Renovato Hernandez: Deyanira, Dominic, Ana`;

const NOTAS = {
  Deyanira: { note: 'Es la mamá de Anette', families: ['Familia Cuellar Salazar', 'Familia Guerrero Salazar', 'Familia Lopez Salazar'] },
  Dominic: { note: 'Es el hermano de Anette', families: [] },
  Ana: { note: 'Es la hermana de Anette', families: [] },
};

const NOMBRES = ['', 'La buena', 'Corazonada', 'Puro instinto', 'Ahora sí', 'La segura', 'Al tanteo', 'Plan B'];

if (!KEY) {
  console.error('Falta ADMIN_PASSWORD (la misma con la que arrancaste el servidor).');
  process.exit(1);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE)) {
  console.error(`Por seguridad sólo corre contra un servidor local (BASE_URL=${BASE}).`);
  process.exit(1);
}

async function call(method, url, body, headers = {}) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${data.error || ''}`);
  return { r, data };
}
const admin = (method, url, body) => call(method, '/api/admin' + url, body, { 'x-admin-key': KEY });
const pick = (n) => Sorteo.randomInt(n);

(async () => {
  let { data: st } = await call('GET', '/api/state');
  if (st.phase !== 'setup') {
    await admin('POST', '/reset', { confirm: 'REINICIAR' });
    console.log(`· Estaba en fase "${st.phase}": se reinició a "Preparando".`);
  }

  await admin('POST', '/settings', { quinielaCostCents: COSTO_CENTS, avoidSameFamily: true });
  const lista = await admin('POST', '/guests', { text: LISTA });
  console.log(`· Lista: ${lista.data.families} familias, ${lista.data.guests} invitados.`);

  ({ data: st } = await call('GET', '/api/state'));
  for (const g of st.guests) {
    await admin('POST', `/guests/${g.id}/reset-pin`);
    if (NOTAS[g.name]) await admin('POST', `/guests/${g.id}/note`, NOTAS[g.name]);
  }
  console.log(`· Notas: ${Object.keys(NOTAS).join(', ')}.`);

  await admin('POST', '/open');
  ({ data: st } = await call('GET', '/api/state'));

  let total = 0;
  for (const g of st.guests) {
    const { r } = await call('POST', '/api/claim', { guestId: g.id, pin: PIN });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const cuantas = 1 + pick(3);
    for (let k = 0; k < cuantas; k++) {
      // Misma regla que el botón "Al azar" de las quinielas: cualquiera menos uno mismo.
      const { draw } = Sorteo.generate(st.guests, { avoidFamily: false });
      const predictions = [...draw].map(([giver_id, receiver_id]) => ({ giver_id, receiver_id }));
      const name = k === 0 ? '' : `${NOMBRES[1 + pick(NOMBRES.length - 1)]}`;
      await call('POST', '/api/quinielas', { name, predictions, acceptedCostCents: COSTO_CENTS }, { cookie });
      total++;
    }
  }
  console.log(`· Quinielas: ${total} (de 1 a 3 por invitado), a $${COSTO_CENTS / 100} cada una.`);

  if (conSorteo) {
    await admin('POST', '/start-draw');
    console.log('· Sorteo iniciado: ya puedes abrir la Pantalla de revelación.');
  } else {
    console.log('· Quinielas abiertas. Usa --sorteo para además iniciar el sorteo.');
  }
  console.log(`\nListo. Todos los invitados tienen PIN ${PIN}.`);
  console.log(`  Invitados:    ${BASE}`);
  console.log(`  Organizador:  ${BASE}/admin.html`);
})().catch((e) => {
  console.error('Error:', e.message);
  if (/ECONNREFUSED|fetch failed/.test(e.message + (e.cause?.code || ''))) console.error(`¿Está corriendo el servidor en ${BASE}?`);
  process.exit(1);
});
