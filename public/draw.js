'use strict';
/**
 * Sorteo de papelitos: el MISMO código lo usan el servidor (sorteo real) y el navegador
 * (botón "Al azar" de las quinielas).
 *
 * Garantías:
 * - Cada invitado regala exactamente una vez y recibe exactamente una vez (permutación).
 * - Nadie se regala a sí mismo y, si la regla está activa, nadie regala a su propia familia.
 * - Uniforme: todos los sorteos válidos tienen la MISMA probabilidad. No hay parejas
 *   "favoritas" que se puedan aprovechar en una quiniela.
 * - Aleatoriedad criptográfica (crypto.getRandomValues), imposible de predecir.
 *
 * Método: se baraja a todos con Fisher–Yates y se acepta sólo si el resultado cumple las
 * reglas (muestreo por rechazo: exactamente uniforme). Sólo si las reglas son tan estrictas
 * que casi ningún barajeo las cumple (p. ej. una familia con la mitad exacta de los
 * invitados), se parte de un sorteo válido y se revuelve con miles de intercambios
 * aleatorios que respetan las reglas (cadena de Markov simétrica, cuyo equilibrio también
 * es uniforme).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Sorteo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const cryptoObj = globalThis.crypto;

  // ------------------------------------------------------------------ Azar seguro
  const POOL = new Uint32Array(1024);
  let poolIdx = POOL.length;
  function u32() {
    if (poolIdx >= POOL.length) {
      if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
        throw new Error('No hay un generador aleatorio seguro disponible.');
      }
      cryptoObj.getRandomValues(POOL);
      poolIdx = 0;
    }
    return POOL[poolIdx++];
  }
  const TWO32 = 0x100000000;
  /** Entero uniforme en [0, n), sin sesgo de módulo. */
  function randomInt(n) {
    if (!Number.isInteger(n) || n < 1 || n > TWO32) throw new RangeError('randomInt: n inválido');
    const limit = TWO32 - (TWO32 % n);
    let x;
    do x = u32();
    while (x >= limit);
    return x % n;
  }

  // ------------------------------------------------------------------ Reglas
  const allowed = (avoidFamily) => (g, r) => g.id !== r.id && (!avoidFamily || g.family_id !== r.family_id);

  /** Texto del problema si con estas reglas no existe ningún sorteo posible; null si sí existe. */
  function feasibilityError(guests, avoidFamily) {
    const n = guests.length;
    if (n < 3) return 'Se necesitan al menos 3 invitados para un intercambio.';
    if (new Set(guests.map((g) => g.id)).size !== n) return 'Hay invitados repetidos en la lista.';
    if (avoidFamily) {
      const sizes = new Map();
      for (const g of guests) sizes.set(g.family_id, (sizes.get(g.family_id) || 0) + 1);
      const max = Math.max(...sizes.values());
      // Teorema de Hall: existe sorteo sin regalos en familia sii ninguna familia pasa de la mitad.
      if (max > n - max) {
        return 'Una familia tiene más de la mitad de los invitados: imposible sortear sin que se regalen entre ellos. Desactiva la regla de familias o ajusta la lista.';
      }
    }
    return null;
  }

  /** Verifica que `draw` (Map giverId → receiverId) sea un sorteo completo y válido. */
  function isValidDraw(guests, avoidFamily, draw) {
    if (!(draw instanceof Map) || draw.size !== guests.length) return false;
    const byId = new Map(guests.map((g) => [g.id, g]));
    const ok = allowed(avoidFamily);
    const received = new Set();
    for (const g of guests) {
      const r = byId.get(draw.get(g.id));
      if (!r || !ok(g, r) || received.has(r.id)) return false;
      received.add(r.id);
    }
    return received.size === guests.length;
  }

  // ------------------------------------------------------------------ Muestreo
  /** Fisher–Yates hacia adelante con rechazo temprano: uniforme sobre los sorteos válidos. */
  function rejectionSample(guests, ok, maxTries, deadline) {
    const n = guests.length;
    for (let t = 0; t < maxTries; t++) {
      if ((t & 1023) === 1023 && Date.now() > deadline) break;
      const rec = guests.slice();
      let good = true;
      for (let i = 0; i < n; i++) {
        const j = i + randomInt(n - i);
        const tmp = rec[i];
        rec[i] = rec[j];
        rec[j] = tmp;
        if (!ok(guests[i], rec[i])) {
          good = false;
          break;
        }
      }
      if (good) return rec;
    }
    return null;
  }

  /**
   * Un sorteo válido construido directamente: se forman todos en fila, agrupados por
   * familia (la más grande primero), y cada quien le regala a quien está m lugares
   * adelante, con m = tamaño de la familia más grande. Nunca cae en la propia familia.
   */
  function constructValid(guests, avoidFamily) {
    const n = guests.length;
    let order = guests.map((_, i) => i);
    let m = 1;
    if (avoidFamily) {
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        const f = guests[i].family_id;
        if (!groups.has(f)) groups.set(f, []);
        groups.get(f).push(i);
      }
      const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
      m = sorted[0].length;
      order = sorted.flat();
    }
    const rec = new Array(n);
    for (let p = 0; p < n; p++) rec[order[p]] = guests[order[(p + m) % n]];
    return rec;
  }

  /** Revuelve con intercambios de 2 y rotaciones de 3 que respetan las reglas (propuesta simétrica). */
  function mix(guests, ok, rec, steps) {
    const n = guests.length;
    for (let s = 0; s < steps; s++) {
      const i = randomInt(n);
      let j = randomInt(n - 1);
      if (j >= i) j++;
      if (n < 3 || randomInt(2) === 0) {
        if (ok(guests[i], rec[j]) && ok(guests[j], rec[i])) {
          const t = rec[i];
          rec[i] = rec[j];
          rec[j] = t;
        }
      } else {
        let k = randomInt(n - 2);
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        if (k >= lo) k++;
        if (k >= hi) k++;
        if (ok(guests[i], rec[j]) && ok(guests[j], rec[k]) && ok(guests[k], rec[i])) {
          const t = rec[i];
          rec[i] = rec[j];
          rec[j] = rec[k];
          rec[k] = t;
        }
      }
    }
    return rec;
  }

  /**
   * Genera un sorteo. guests: [{ id, family_id }]. Devuelve { draw: Map(giverId → receiverId), method }.
   * Opciones: avoidFamily, maxTries, timeLimitMs (presupuesto del muestreo exacto), mixSteps.
   */
  function generate(guests, { avoidFamily = false, maxTries = 3_000_000, timeLimitMs = 3000, mixSteps } = {}) {
    const err = feasibilityError(guests, avoidFamily);
    if (err) {
      const e = new Error(err);
      e.infeasible = true;
      throw e;
    }
    const ok = allowed(avoidFamily);
    const n = guests.length;
    let method = 'exact';
    let rec = rejectionSample(guests, ok, maxTries, Date.now() + timeLimitMs);
    if (!rec) {
      method = 'mixed';
      rec = mix(guests, ok, constructValid(guests, avoidFamily), mixSteps ?? 10_000 + 200 * n * n);
    }
    const draw = new Map(guests.map((g, i) => [g.id, rec[i].id]));
    if (!isValidDraw(guests, avoidFamily, draw)) throw new Error('El sorteo generado no pasó la verificación.');
    return { draw, method };
  }

  return { generate, isValidDraw, feasibilityError, randomInt };
});
