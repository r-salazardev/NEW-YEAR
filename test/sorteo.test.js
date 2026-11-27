'use strict';
// Pruebas del algoritmo de sorteo (public/draw.js). Correr con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const Sorteo = require('../public/draw.js');

/** Invitados a partir de tamaños de familia: [3,2,1] → 6 invitados en 3 familias. */
function makeGuests(sizes) {
  const guests = [];
  let id = 1;
  sizes.forEach((s, f) => {
    for (let k = 0; k < s; k++) guests.push({ id: id++, family_id: f + 1 });
  });
  return guests;
}

/** Verificación independiente (no reutiliza isValidDraw). */
function assertValid(guests, avoid, draw) {
  assert.equal(draw.size, guests.length, 'todos deben tener a quién regalar');
  const fam = new Map(guests.map((g) => [g.id, g.family_id]));
  const receivers = [];
  for (const g of guests) {
    const r = draw.get(g.id);
    assert.ok(fam.has(r), `receptor inexistente ${r}`);
    assert.notEqual(r, g.id, 'nadie se regala a sí mismo');
    if (avoid) assert.notEqual(fam.get(r), g.family_id, 'nadie regala a su familia');
    receivers.push(r);
  }
  assert.equal(new Set(receivers).size, guests.length, 'nadie recibe dos veces y todos reciben');
}

/** Todas las permutaciones válidas (sólo para casos chicos). */
function allValid(guests, avoid) {
  const out = [];
  const n = guests.length;
  const used = new Array(n).fill(false);
  const cur = [];
  const rec = (i) => {
    if (i === n) return out.push(cur.join(','));
    for (let j = 0; j < n; j++) {
      if (used[j] || j === i || (avoid && guests[j].family_id === guests[i].family_id)) continue;
      used[j] = true;
      cur.push(guests[j].id);
      rec(i + 1);
      cur.pop();
      used[j] = false;
    }
  };
  rec(0);
  return out;
}

/** Prueba chi-cuadrada contra la distribución uniforme (umbral p ≈ 1e-4, para no dar falsos rojos). */
function chiSquareUniform(counts, k, samples) {
  const expected = samples / k;
  let chi = 0;
  for (const c of counts.values()) chi += (c - expected) ** 2 / expected;
  chi += (k - counts.size) * expected; // permutaciones válidas que nunca salieron
  const df = k - 1;
  const z = 3.719;
  const crit = df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3; // Wilson–Hilferty
  return { chi, crit, df };
}

function checkUniform(sizes, avoid, samples, opts = {}) {
  const guests = makeGuests(sizes);
  const valid = allValid(guests, avoid);
  const validSet = new Set(valid);
  const counts = new Map();
  for (let s = 0; s < samples; s++) {
    const { draw } = Sorteo.generate(guests, { avoidFamily: avoid, ...opts });
    const key = guests.map((g) => draw.get(g.id)).join(',');
    assert.ok(validSet.has(key), 'salió un sorteo inválido');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const { chi, crit, df } = chiSquareUniform(counts, valid.length, samples);
  assert.ok(chi < crit, `no uniforme: chi²=${chi.toFixed(1)} > ${crit.toFixed(1)} (gl=${df}) para ${JSON.stringify(sizes)}`);
  assert.equal(counts.size, valid.length, 'todas las combinaciones válidas deben poder salir');
  return { valid: valid.length, chi, crit };
}

test('siempre válido: cada quien da una vez, recibe una vez, sin sí mismo ni familia', () => {
  const configs = [
    [1, 1, 1],
    [2, 1],
    [3, 3],
    [2, 2, 2],
    [4, 3, 2, 1, 1, 1],
    [5, 5, 5, 5],
    [6, 1, 1, 1, 1, 1, 1],
    [10, 10],
    [8, 4, 4, 3, 3, 2, 2, 1, 1],
    [15, 5, 5, 5],
    [20, 20],
  ];
  for (const sizes of configs) {
    const guests = makeGuests(sizes);
    const n = guests.length;
    const half = Math.max(...sizes) * 2 <= n;
    for (const avoid of [false, true]) {
      if (avoid && !half) continue;
      if (!avoid && n < 3) continue;
      for (let k = 0; k < 100; k++) assertValid(guests, avoid, Sorteo.generate(guests, { avoidFamily: avoid, timeLimitMs: 50 }).draw);
    }
  }
});

test('configuraciones al azar (3 a 45 invitados), 2,000 sorteos', () => {
  for (let k = 0; k < 2000; k++) {
    const fams = 1 + Sorteo.randomInt(12);
    const sizes = Array.from({ length: fams }, () => 1 + Sorteo.randomInt(6));
    const guests = makeGuests(sizes);
    const avoid = Sorteo.randomInt(2) === 1;
    const err = Sorteo.feasibilityError(guests, avoid);
    const n = guests.length;
    const max = Math.max(...sizes);
    const shouldWork = n >= 3 && (!avoid || max <= n - max);
    assert.equal(err === null, shouldWork, `factibilidad mal detectada para ${JSON.stringify(sizes)} avoid=${avoid}`);
    if (!shouldWork) {
      assert.throws(() => Sorteo.generate(guests, { avoidFamily: avoid }));
      continue;
    }
    assertValid(guests, avoid, Sorteo.generate(guests, { avoidFamily: avoid }).draw);
  }
});

test('uniforme: todas las combinaciones válidas salen con la misma frecuencia', () => {
  checkUniform([1, 1, 1, 1, 1], false, 60_000); // 44 desarreglos
  checkUniform([2, 2, 1], true, 60_000);
  checkUniform([3, 2, 2], true, 80_000);
  checkUniform([3, 1, 1, 1], true, 30_000); // familia con la mitad exacta
  checkUniform([1, 1, 1], false, 20_000); // sólo 2 combinaciones posibles
});

test('el método de respaldo (mezcla) también es uniforme', () => {
  const opts = { maxTries: 0, mixSteps: 1500 }; // fuerza el respaldo
  checkUniform([1, 1, 1, 1, 1], false, 30_000, opts);
  checkUniform([2, 2, 1], true, 30_000, opts);
  checkUniform([3, 2, 2], true, 40_000, opts);
  checkUniform([3, 1, 1, 1], true, 20_000, opts);
  checkUniform([1, 1, 1], false, 10_000, opts);
});

test('cada pareja tiene la probabilidad que le toca (marginales), 16 invitados sin familias', () => {
  const guests = makeGuests(new Array(16).fill(1));
  const N = 64_000;
  const count = new Map();
  for (let s = 0; s < N; s++) {
    for (const [g, r] of Sorteo.generate(guests).draw) count.set(`${g}>${r}`, (count.get(`${g}>${r}`) || 0) + 1);
  }
  assert.equal(count.size, 16 * 15, 'todas las parejas posibles deben salir');
  const p = 1 / 15;
  const sd = Math.sqrt(N * p * (1 - p));
  for (const [pair, c] of count) assert.ok(Math.abs(c - N * p) < 5 * sd, `pareja ${pair} sesgada: ${c} vs ${N * p}`);
});

test('casos extremos: familia con la mitad exacta y grupos grandes terminan rápido', () => {
  for (const sizes of [[15, ...new Array(15).fill(1)], [20, 20], [25, 10, 10, 5]]) {
    const guests = makeGuests(sizes);
    const t = Date.now();
    const { draw } = Sorteo.generate(guests, { avoidFamily: true, timeLimitMs: 500 });
    assertValid(guests, true, draw);
    assert.ok(Date.now() - t < 5000, 'tardó demasiado');
  }
});

test('imposibles se rechazan con mensaje claro', () => {
  assert.match(Sorteo.feasibilityError(makeGuests([1, 1]), false), /al menos 3/);
  assert.match(Sorteo.feasibilityError(makeGuests([4, 1, 1]), true), /más de la mitad/);
  assert.equal(Sorteo.feasibilityError(makeGuests([4, 1, 1]), false), null);
  assert.match(Sorteo.feasibilityError([{ id: 1, family_id: 1 }, { id: 1, family_id: 2 }, { id: 2, family_id: 3 }], false), /repetidos/);
});

test('randomInt no tiene sesgo', () => {
  const n = 7;
  const N = 140_000;
  const c = new Array(n).fill(0);
  for (let i = 0; i < N; i++) c[Sorteo.randomInt(n)]++;
  const e = N / n;
  const chi = c.reduce((s, x) => s + (x - e) ** 2 / e, 0);
  assert.ok(chi < 27.9, `chi²=${chi}`); // gl=6, p≈1e-4
});
