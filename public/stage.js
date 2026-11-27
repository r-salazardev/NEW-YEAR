'use strict';
/* Pantalla de revelación para proyectar en la cena. Depende de ui.js.
   El organizador va eligiendo a cada invitado: se revela a quién le regala y la tabla de
   quinielas se recalcula en vivo con lo revelado hasta ese momento. */

const stage = (() => {
  const { $, $$, esc, icon, avatar, money, confetti, reducedMotion, sleep } = ui;
  const BOARD_LIMIT = 10;
  const svg = (d) =>
    `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON_EXPAND = svg('<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/>');
  const ICON_SHRINK = svg('<path d="M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5"/>');

  let root = null;
  let D = null; // datos de /api/admin/presentation
  let guestById = new Map();
  let truth = new Map(); // quien da → quien recibe
  let order = []; // ids de quien da, en el orden en que se revelaron
  let storageKey = '';
  let spot = null; // revelación en pantalla: { el, giverId, fresh, landed }
  let prevStanding = new Map(); // id de quiniela → { rank, hits }
  let prevLeader = '';
  let onCloseCb = null;

  // ---------------------------------------------------------------- Pantalla completa
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function enterFullscreen() {
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
      p?.catch?.(() => {});
    } catch {}
  }
  function exitFullscreen() {
    if (!fsElement()) return;
    try {
      const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.();
      p?.catch?.(() => {});
    } catch {}
  }
  const syncFsButton = () => {
    const b = root && $('#st-fs', root);
    if (b) {
      b.innerHTML = fsElement() ? ICON_SHRINK : ICON_EXPAND;
      b.title = fsElement() ? 'Salir de pantalla completa (F)' : 'Pantalla completa (F)';
    }
  };

  // ---------------------------------------------------------------- Avance guardado en este dispositivo
  function signature(d) {
    // Huella del sorteo (no reversible) para no mezclar el avance de un sorteo con otro.
    const s = d.pairs.map((p) => p.join('>')).sort().join(',') + '|' + d.quinielas.map((q) => q.id).join(',');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h.toString(36);
  }
  function loadOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(saved) ? [...new Set(saved.filter((id) => truth.has(id)))] : [];
    } catch {
      return [];
    }
  }
  function saveOrder() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {}
  }

  // ---------------------------------------------------------------- Cálculos
  const isRevealed = (id) => order.includes(id);
  /** Quien recibió del último revelado es el siguiente en dar, si no ha dado todavía.
   *  null al inicio o cuando el ciclo se cerró: entonces se elige al azar o tocando un nombre. */
  function nextInChain() {
    if (!order.length) return null;
    const r = truth.get(order[order.length - 1]);
    return r !== undefined && !isRevealed(r) ? r : null;
  }
  const hittersOf = (giverId) => D.quinielas.filter((q) => q.pred.get(giverId) === truth.get(giverId));

  /** Ranking de quinielas contando sólo lo revelado. Empates comparten lugar. */
  function standings() {
    const rows = D.quinielas.map((q) => {
      let hits = 0;
      for (const g of order) if (q.pred.get(g) === truth.get(g)) hits++;
      return { q, hits };
    });
    rows.sort((a, b) => b.hits - a.hits || a.q.idx - b.q.idx);
    let rank = 0;
    let last = null;
    rows.forEach((r, i) => {
      if (r.hits !== last) {
        rank = i + 1;
        last = r.hits;
      }
      r.rank = rank;
    });
    return rows;
  }

  // ---------------------------------------------------------------- Estructura
  function frameHTML() {
    return `
      <div class="st-bg" aria-hidden="true"><i class="st-blob a"></i><i class="st-blob b"></i><i class="st-blob c"></i><i class="st-stars"></i><i class="st-stars s2"></i></div>
      <header class="st-head">
        <div class="st-title">
          <p class="st-eyebrow">${icon('sparkles')}${esc(D.eventName)}</p>
          <h1>¿Quién le regala a quién?</h1>
        </div>
        <div class="st-progress" aria-live="polite">
          <div class="st-progress-num"><b id="st-count">0</b><span>de ${D.guests.length} revelados</span></div>
          <div class="st-bar"><i id="st-bar"></i></div>
        </div>
        <div class="st-tools">
          <button class="st-btn gold" type="button" id="st-next"></button>
          <button class="st-btn gold" type="button" id="st-finale" hidden>${icon('trophy')}<span>Ver ganador</span></button>
          <button class="st-icon-btn" type="button" id="st-reset" title="Empezar de nuevo">${icon('refresh')}</button>
          <button class="st-icon-btn" type="button" id="st-fs" title="Pantalla completa (F)">${ICON_EXPAND}</button>
          <button class="st-icon-btn" type="button" id="st-close" title="Salir">${icon('xmark')}</button>
        </div>
      </header>
      <main class="st-main">
        <section class="st-guests-wrap" aria-label="Invitados">
          <p class="st-hint">${icon('gift')}Quien recibe es el siguiente en dar. Toca otro nombre para cambiar el orden.</p>
          <div class="st-guests" id="st-guests"></div>
        </section>
        <aside class="st-board" aria-label="Quiniela en vivo">
          <div class="st-board-head">
            <h2><span class="st-live"></span>Quiniela en vivo</h2>
            ${D.potCents ? `<span class="st-pot-chip">Premio <b>${money(D.potCents)}</b></span>` : ''}
          </div>
          <div class="st-lead" id="st-lead"></div>
          <ol class="st-list" id="st-list"></ol>
          <p class="st-more" id="st-more"></p>
        </aside>
      </main>`;
  }

  function guestCardHTML(g, i) {
    const done = isRevealed(g.id);
    const r = done ? guestById.get(truth.get(g.id)) : null;
    return `<button type="button" class="st-guest${done ? ' done' : ''}" data-g="${g.id}" style="--i:${i}" aria-label="${esc(
      done ? `${g.name} le regala a ${r?.name}` : `Revelar a quién le regala ${g.name}`
    )}">
      <span class="st-g-glow" aria-hidden="true"></span>
      ${avatar(g.name)}
      <span class="st-g-name">${esc(g.name)}</span>
      <span class="st-g-fam">${esc(g.family)}</span>
      <span class="st-g-foot">${
        done ? `<span class="st-g-arrow">${icon('arrowRight')}</span><b>${esc(r?.name || '—')}</b>` : `${icon('gift')}<span>Por revelar</span>`
      }</span>
    </button>`;
  }

  function renderGuests() {
    $('#st-guests', root).innerHTML = D.guests.map(guestCardHTML).join('');
  }

  function updateCard(id) {
    const old = $(`[data-g="${id}"]`, root);
    if (!old) return;
    const i = D.guests.findIndex((g) => g.id === id);
    const tmp = document.createElement('div');
    tmp.innerHTML = guestCardHTML(D.guests[i], i);
    const card = tmp.firstElementChild;
    card.classList.add('just');
    old.replaceWith(card);
  }

  function updateProgress() {
    const n = order.length;
    const total = D.guests.length;
    $('#st-count', root).textContent = n;
    $('#st-bar', root).style.width = `${total ? (n / total) * 100 : 0}%`;
    const done = n === total && total > 0;
    const btn = $('#st-next', root);
    btn.hidden = done;
    const next = nextInChain();
    const nextGuest = next !== null ? guestById.get(next) : null;
    btn.innerHTML = nextGuest
      ? `${icon('arrowRight')}<span>Sigue ${esc(nextGuest.name)}</span>`
      : `${icon('dice')}<span>${order.length ? 'Al azar' : 'Empezar al azar'}</span>`;
    btn.title = nextGuest
      ? `Revelar a quién le regala ${nextGuest.name} (espacio)`
      : order.length
      ? 'Se cerró el ciclo: revelar a alguien al azar (espacio)'
      : 'Revelar a alguien al azar para empezar (espacio)';
    $$('.st-guest', root).forEach((c) => c.classList.toggle('next', Number(c.dataset.g) === next));
    $('#st-finale', root).hidden = !done || !D.quinielas.length;
    root.classList.toggle('all-done', done);
  }

  // ---------------------------------------------------------------- Tabla en vivo
  function leadHTML(rows) {
    if (!D.quinielas.length) {
      return `<span class="st-lead-label">Quinielas</span><span class="st-lead-name">Nadie llenó quinielas</span>`;
    }
    if (!order.length) {
      return `<span class="st-lead-label">Va ganando</span><span class="st-lead-name">Todos empatados</span><span class="st-lead-sub">${D.quinielas.length} ${
        D.quinielas.length === 1 ? 'quiniela compite' : 'quinielas compiten'
      }. Revela el primer papelito.</span>`;
    }
    const top = rows.filter((r) => r.rank === 1);
    if (!top[0].hits) {
      return `<span class="st-lead-label">Va ganando</span><span class="st-lead-name">Nadie ha atinado</span><span class="st-lead-sub">Todo puede pasar todavía…</span>`;
    }
    const hits = `${top[0].hits} ${top[0].hits === 1 ? 'acierto' : 'aciertos'}`;
    if (top.length === 1) {
      const q = top[0].q;
      return `<span class="st-lead-trophy">${icon('trophy')}</span><span class="st-lead-label">Va ganando</span>
        <span class="st-lead-name">${esc(q.name)}</span><span class="st-lead-sub">${esc(q.author)} · ${hits}</span>`;
    }
    const names = top.slice(0, 3).map((r) => esc(r.q.author));
    return `<span class="st-lead-trophy">${icon('trophy')}</span><span class="st-lead-label">Empate en primer lugar</span>
      <span class="st-lead-name">${top.length} quinielas</span><span class="st-lead-sub">${names.join(', ')}${top.length > 3 ? ` y ${top.length - 3} más` : ''} · ${hits}</span>`;
  }

  function rowHTML(r, { hit, moved }) {
    const total = D.guests.length;
    const medal = r.hits > 0 && r.rank <= 3 ? ` m${r.rank}` : '';
    return `<li class="st-row${medal}${hit ? ' hit' : ''}" data-q="${r.q.id}">
      <span class="st-rank">${r.hits > 0 ? r.rank : '·'}</span>
      <span class="st-row-body">
        <span class="st-row-name">${esc(r.q.name)}</span>
        <span class="st-row-sub">${esc(r.q.author)}${moved > 0 ? `<span class="st-move">▲ ${moved}</span>` : ''}</span>
        <span class="st-row-bar"><i style="width:${total ? (r.hits / total) * 100 : 0}%"></i></span>
      </span>
      <span class="st-score"><b>${r.hits}</b><small>/${order.length}</small>${hit ? '<span class="st-plus">+1</span>' : ''}</span>
    </li>`;
  }

  /** Repinta la tabla. Si `giverId` viene, anima: filas que suben, +1 a quien le atinó. */
  function updateBoard(giverId = null) {
    const list = $('#st-list', root);
    const rows = standings();
    const animate = giverId !== null && !reducedMotion();
    const before = new Map($$('.st-row', list).map((li) => [li.dataset.q, li.getBoundingClientRect().top]));
    const hitIds = new Set(giverId !== null ? hittersOf(giverId).map((q) => String(q.id)) : []);
    const shown = rows.slice(0, BOARD_LIMIT);
    list.innerHTML = shown
      .map((r) => {
        const prev = prevStanding.get(String(r.q.id));
        const moved = giverId !== null && prev && r.hits > 0 ? prev.rank - r.rank : 0;
        return rowHTML(r, { hit: hitIds.has(String(r.q.id)), moved });
      })
      .join('');
    $('#st-more', root).textContent = rows.length > BOARD_LIMIT ? `y ${rows.length - BOARD_LIMIT} quinielas más` : '';

    const lead = $('#st-lead', root);
    lead.innerHTML = leadHTML(rows);
    lead.classList.toggle('no-trophy', !lead.querySelector('.st-lead-trophy'));
    const top = rows.filter((r) => r.rank === 1 && r.hits > 0);
    const leaderKey = top.map((r) => r.q.id).join(',');
    if (giverId !== null && leaderKey && leaderKey !== prevLeader) {
      lead.classList.remove('pop');
      void lead.offsetWidth;
      lead.classList.add('pop');
    }
    prevLeader = leaderKey;

    if (animate) {
      $$('.st-row', list).forEach((li, i) => {
        const from = before.get(li.dataset.q);
        const to = li.getBoundingClientRect().top;
        if (from === undefined) {
          li.animate([{ opacity: 0, transform: 'translateY(28px) scale(0.96)' }, { opacity: 1, transform: 'none' }], {
            duration: 650,
            delay: 120 + i * 30,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'backwards',
          });
        } else if (from !== to) {
          li.animate([{ transform: `translateY(${from - to}px)` }, { transform: 'none' }], {
            duration: 900,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          });
        }
      });
    }
    prevStanding = new Map(rows.map((r) => [String(r.q.id), { rank: r.rank, hits: r.hits }]));
  }

  // ---------------------------------------------------------------- Revelación
  function reelNames(giver, receiver, count) {
    const pool = D.guests.filter((x) => x.id !== giver.id);
    const names = [];
    let last = '';
    for (let i = 0; i < count - 1; i++) {
      let pick = pool[(Math.random() * pool.length) | 0]?.name || receiver.name;
      // Al final evita mostrar al destinatario antes de tiempo y nombres repetidos seguidos.
      for (let t = 0; t < 6 && (pick === last || (i > count - 6 && pick === receiver.name)); t++) pick = pool[(Math.random() * pool.length) | 0].name;
      names.push(pick);
      last = pick;
    }
    names.push(receiver.name);
    return names;
  }

  function hitsHTML(giverId) {
    if (!D.quinielas.length) return '';
    const hitters = hittersOf(giverId);
    if (!hitters.length) {
      return `<p class="st-hits-title miss">Ninguna quiniela le atinó</p>`;
    }
    const chips = hitters
      .slice(0, 10)
      .map((q, i) => `<span class="st-chip" style="--i:${i}">${avatar(q.author)}<span><b>${esc(q.name)}</b>${q.name.includes(q.author) ? '' : `<small>${esc(q.author)}</small>`}</span></span>`)
      .join('');
    return `<p class="st-hits-title">${icon('sparkles')}${hitters.length === 1 ? '1 quiniela le atinó' : `${hitters.length} quinielas le atinaron`}</p>
      <div class="st-chips">${chips}${hitters.length > 10 ? `<span class="st-chip more" style="--i:10">+${hitters.length - 10}</span>` : ''}</div>`;
  }

  async function reveal(giverId) {
    if (spot || !root) return;
    const giver = guestById.get(giverId);
    const receiver = guestById.get(truth.get(giverId));
    if (!giver || !receiver) return;
    const fresh = !isRevealed(giverId);
    // Si quien recibe ya dio su regalo, este papelito cierra el ciclo.
    const closesCycle = fresh && isRevealed(receiver.id);
    const animate = fresh && !reducedMotion();
    const names = animate ? reelNames(giver, receiver, Math.max(26, Math.min(40, D.guests.length * 3))) : [receiver.name];

    const el = document.createElement('div');
    el.className = 'st-spot' + (animate ? '' : ' instant');
    el.innerHTML = `
      <div class="st-spot-card" role="status" aria-live="assertive">
        <div class="st-spot-giver">${avatar(giver.name, 'xl')}<h2>${esc(giver.name)}</h2><p>${esc(giver.family)}</p>${
          giver.note ? `<span class="st-note">${esc(giver.note)}</span>` : ''
        }</div>
        <p class="st-says">le regala a<span class="st-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
        <div class="st-reel-wrap">
          <span class="st-rays" aria-hidden="true"></span>
          <div class="st-reel"><div class="st-reel-track" style="--idx:0">${names.map((n, i) => `<span${i === names.length - 1 ? ' class="final"' : ''}>${esc(n)}</span>`).join('')}</div></div>
        </div>
        <p class="st-spot-fam">${avatar(receiver.name)}<span>${esc(receiver.family)}</span></p>
        ${receiver.note ? `<p class="st-spot-fam st-spot-note"><span class="st-note">${esc(receiver.note)}</span></p>` : ''}
        <div class="st-spot-hits">${hitsHTML(giverId)}</div>
        ${
          !fresh
            ? ''
            : closesCycle
            ? `<p class="st-chain cycle">${icon('refresh')}<span>¡Se cerró el ciclo! ${
                order.length + 1 === D.guests.length ? 'Ya se revelaron todos los papelitos' : 'El siguiente se elige al azar o tocando un nombre'
              }</span></p>`
            : `<p class="st-chain">${avatar(receiver.name)}<span>Ahora <b>${esc(receiver.name)}</b> revela a quién le regala</span></p>`
        }
        <button class="st-continue" type="button">Continuar <kbd>espacio</kbd></button>
      </div>`;
    root.appendChild(el);
    spot = { el, giverId, fresh, landed: false };

    // La tarjeta "sale" del lugar del invitado en la cuadrícula.
    const card = $(`[data-g="${giverId}"]`, root);
    const giverBox = $('.st-spot-giver', el);
    if (card && animate) {
      const a = card.getBoundingClientRect();
      const b = giverBox.getBoundingClientRect();
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      giverBox.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.4 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 750, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
      card.classList.add('picked');
    }

    const track = $('.st-reel-track', el);
    const last = names.length - 1;
    if (animate) {
      await sleep(1100);
      if (spot?.el !== el) return;
      el.classList.add('spinning');
      track.style.transition = 'transform 3.6s cubic-bezier(0.12, 0.7, 0.1, 1)';
      track.style.setProperty('--idx', last);
      await Promise.race([new Promise((r) => track.addEventListener('transitionend', r, { once: true })), sleep(3900)]);
      if (spot?.el !== el) return;
    } else {
      track.style.setProperty('--idx', last);
    }
    el.classList.remove('spinning');
    el.classList.add('landed');
    if (animate) setTimeout(() => el.classList.add('compact'), 550);
    else el.classList.add('compact');
    spot.landed = true;
    if (fresh) {
      order.push(giverId);
      saveOrder();
      confetti({ count: 160, duration: 3000 });
    }
    $('.st-continue', el).focus({ preventScroll: true });
  }

  async function closeSpot() {
    if (!spot?.landed) return;
    const { el, giverId, fresh } = spot;
    spot = null;
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
    $(`[data-g="${giverId}"]`, root)?.classList.remove('picked');
    if (!fresh) return;
    updateCard(giverId);
    updateProgress();
    await sleep(reducedMotion() ? 0 : 280);
    if (root) updateBoard(giverId);
    if (order.length === D.guests.length && D.quinielas.length) {
      await sleep(1200);
      if (root && !spot) finale();
    }
  }

  /** Lo automático: sigue la cadena (quien recibió da); al inicio o al cerrar el ciclo, al azar. */
  function revealNext() {
    const next = nextInChain();
    if (next !== null) reveal(next);
    else revealRandom();
  }

  function revealRandom() {
    const pending = D.guests.filter((g) => !isRevealed(g.id));
    if (pending.length) reveal(pending[(Math.random() * pending.length) | 0].id);
  }

  // ---------------------------------------------------------------- Final: quiniela ganadora
  async function finale() {
    if (spot || !root || !D.quinielas.length) return;
    const rows = standings();
    const top = rows.filter((r) => r.rank === 1);
    const tie = top.length > 1;
    const total = D.guests.length;
    const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
    const podiumHTML = podium
      .map((r) => {
        const pos = rows.indexOf(r) + 1;
        return `<div class="st-pod p${pos} r${Math.min(r.rank, 4)}">
          <div class="st-pod-who">${avatar(r.q.author)}<b>${esc(r.q.name)}</b><span>${r.hits} ${r.hits === 1 ? 'acierto' : 'aciertos'}</span></div>
          <div class="st-pod-block"><span>${r.rank}</span></div>
        </div>`;
      })
      .join('');
    const el = document.createElement('div');
    el.className = 'st-spot st-final' + (reducedMotion() ? ' instant' : '');
    el.innerHTML = `
      <div class="st-final-card" role="status" aria-live="assertive">
        <p class="st-says">${tie ? 'Tenemos un empate' : 'La quiniela ganadora es'}<span class="st-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
        <div class="st-final-reveal">
          <span class="st-trophy">${icon('trophy')}</span>
          <h2 class="st-winner">${tie ? top.map((r) => esc(r.q.name)).slice(0, 3).join(' · ') : esc(top[0].q.name)}</h2>
          <p class="st-winner-sub">${
            tie
              ? `${top.length} quinielas con ${top[0].hits} de ${total} aciertos`
              : `${esc(top[0].q.author)} · ${top[0].hits} de ${total} aciertos`
          }</p>
          ${D.potCents ? `<p class="st-final-pot">Premio <b>${money(D.potCents)}</b>${tie ? ' a repartir' : ''}</p>` : ''}
          <div class="st-podium">${podiumHTML}</div>
          <button class="st-continue" type="button">Cerrar</button>
        </div>
      </div>`;
    root.appendChild(el);
    spot = { el, giverId: null, fresh: false, landed: false };
    if (!reducedMotion()) await sleep(2200);
    if (spot?.el !== el) return;
    el.classList.add('landed');
    spot.landed = true;
    $('.st-continue', el).focus({ preventScroll: true });
    confetti({ count: 220, duration: 3600 });
    setTimeout(() => spot?.el === el && confetti({ count: 160, duration: 3200 }), 1400);
  }

  // ---------------------------------------------------------------- Eventos
  async function onClick(e) {
    const t = e.target;
    if (spot) {
      if (t.closest('.st-continue') || t === spot.el) closeSpot();
      return;
    }
    const g = t.closest('[data-g]');
    if (g) return reveal(Number(g.dataset.g));
    if (t.closest('#st-next')) return revealNext();
    if (t.closest('#st-finale')) return finale();
    if (t.closest('#st-fs')) return fsElement() ? exitFullscreen() : enterFullscreen();
    if (t.closest('#st-close')) return close();
    if (t.closest('#st-reset')) {
      if (!order.length) return;
      const ok = await ui.confirm('¿Empezar de nuevo?', 'Se ocultarán otra vez todos los papelitos revelados en esta pantalla. No cambia el sorteo ni las quinielas.', {
        confirmLabel: 'Empezar de nuevo',
        destructive: true,
      });
      if (!ok || !root) return;
      order = [];
      saveOrder();
      prevStanding = new Map();
      prevLeader = '';
      renderGuests();
      updateBoard();
      updateProgress();
    }
  }

  function onKey(e) {
    if (!root || document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (spot) {
        e.preventDefault();
        closeSpot();
      } else if (e.key === ' ' || !e.target.closest?.('button')) {
        e.preventDefault();
        if (order.length < D.guests.length) revealNext();
        else finale();
      }
    } else if (e.key === 'Escape' && spot) {
      closeSpot();
    } else if (e.key === 'f' || e.key === 'F') {
      fsElement() ? exitFullscreen() : enterFullscreen();
    }
  }

  // ---------------------------------------------------------------- API pública
  function open(data, { onClose } = {}) {
    if (root) close();
    D = data;
    guestById = new Map(D.guests.map((g) => [g.id, g]));
    truth = new Map(D.pairs);
    D.quinielas.forEach((q, i) => {
      q.pred = new Map(q.predictions);
      q.idx = i;
    });
    storageKey = 'ny_stage_' + signature(D);
    order = loadOrder();
    onCloseCb = onClose || null;
    spot = null;
    prevStanding = new Map();
    prevLeader = '';

    root = document.createElement('div');
    root.className = 'st';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Pantalla de revelación');
    root.innerHTML = frameHTML();
    document.body.appendChild(root);
    document.documentElement.classList.add('st-lock');
    renderGuests();
    updateBoard();
    updateProgress();
    syncFsButton();
    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', syncFsButton);
    document.addEventListener('webkitfullscreenchange', syncFsButton);
    requestAnimationFrame(() => root?.classList.add('in'));
  }

  function close() {
    if (!root) return;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', syncFsButton);
    document.removeEventListener('webkitfullscreenchange', syncFsButton);
    root.remove();
    root = null;
    spot = null;
    D = null;
    document.documentElement.classList.remove('st-lock');
    exitFullscreen();
    const cb = onCloseCb;
    onCloseCb = null;
    cb?.();
  }

  return { open, close, enterFullscreen, exitFullscreen, isOpen: () => !!root };
})();
