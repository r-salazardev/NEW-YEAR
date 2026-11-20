'use strict';
/* Vista de invitados. Depende de ui.js. */

const { $, $$, esc, icon, avatar, relTime, plural, money, request, sheet, confirm, toast, busy } = ui;

const app = $('#app');
const nav = { bar: $('#navbar'), leading: $('#nav-leading'), title: $('#nav-title'), trailing: $('#nav-trailing') };

let state = null; // /api/state
let mine = []; // mis quinielas
let myReceiver = null; // { name, family } cuando ya saqué papelito
let view = 'loading'; // login | home | editor
let search = '';
let slipFlipped = false;
let editor = null; // { dirty, leaving }
let loading = false;
let reloadQueued = null;

const api = (url, opts) => request(url, opts);
const firstName = (n) => String(n).trim().split(/\s+/)[0];

ui.watchNavbar(nav.bar);

function setNav({ title = '', leading = '', trailing = '', alwaysTitle = false } = {}) {
  nav.title.textContent = title;
  nav.leading.innerHTML = leading;
  nav.trailing.innerHTML = trailing;
  nav.bar.classList.toggle('always-title', alwaysTitle);
}

function setView(v, html) {
  view = v;
  app.innerHTML = `<div class="view">${html}</div>`;
}

// ===========================================================================
// Carga de datos
// ===========================================================================
async function load({ keepScroll = false } = {}) {
  if (loading) {
    reloadQueued = { keepScroll };
    return;
  }
  loading = true;
  try {
    state = await api('/api/state');
    document.title = state.eventName;
    if (!state.me) {
      mine = [];
      myReceiver = null;
      renderLogin();
      return;
    }
    const [q, d] = await Promise.all([
      api('/api/quinielas/mine'),
      state.me.hasDrawn ? api('/api/my-draw') : Promise.resolve({ receiver: null }),
    ]);
    mine = q;
    myReceiver = d.receiver;
    const y = window.scrollY;
    await renderHome();
    if (keepScroll) window.scrollTo(0, y);
  } catch (err) {
    if (view === 'loading') {
      setView('error', `<div class="empty">${icon('exclamation')}<h2>No se pudo cargar</h2><p>${esc(err.message)}</p><p style="margin-top:20px"><button class="btn medium" onclick="location.reload()">Reintentar</button></p></div>`);
    } else {
      toast(err.message, 'err');
    }
  } finally {
    loading = false;
    if (reloadQueued) {
      const opts = reloadQueued;
      reloadQueued = null;
      load(opts);
    }
  }
}

// Errores de sesión en cualquier acción → regresar al inicio.
async function act(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'err', 3600);
    if (err.status === 401) await load();
    return undefined;
  }
}

// ===========================================================================
// 1. Elegir nombre
// ===========================================================================
function renderLogin() {
  setNav({ title: state.eventName });
  setView(
    'login',
    `<div class="large-title"><h1>${esc(state.eventName)}</h1><p>Elige tu nombre para entrar.</p></div>
     ${
       state.guests.length
         ? `<label class="search">${icon('search')}<span class="sr-only">Buscar</span>
              <input class="field" id="search" type="search" placeholder="Buscar" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(search)}">
              <button class="clear" id="search-clear" type="button" aria-label="Borrar búsqueda" ${search ? '' : 'hidden'}>${icon('xmark')}</button>
            </label>`
         : ''
     }
     <div id="names"></div>`
  );
  renderNames();
  const input = $('#search');
  if (input) {
    input.addEventListener('input', () => {
      search = input.value;
      $('#search-clear').hidden = !search;
      renderNames();
    });
    $('#search-clear').addEventListener('click', () => {
      search = '';
      input.value = '';
      $('#search-clear').hidden = true;
      renderNames();
      input.focus();
    });
  }
}

function normalize(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function renderNames() {
  const box = $('#names');
  if (!box) return;
  if (!state.guests.length) {
    box.innerHTML = `<div class="empty">${icon('people')}<h2>Aún no hay invitados</h2><p>El organizador todavía no carga la lista. Esta página se actualizará sola.</p></div>`;
    return;
  }
  const q = normalize(search.trim());
  const groups = new Map();
  for (const g of state.guests) {
    if (q && !normalize(g.name).includes(q) && !normalize(g.family).includes(q)) continue;
    if (!groups.has(g.family)) groups.set(g.family, []);
    groups.get(g.family).push(g);
  }
  if (!groups.size) {
    box.innerHTML = `<div class="empty">${icon('search')}<h2>Sin resultados</h2><p>No encontramos “${esc(search.trim())}”.</p></div>`;
    return;
  }
  box.innerHTML = [...groups]
    .map(
      ([fam, gs]) => `<section class="section">
        <div class="section-header"><h2>${esc(fam)}</h2></div>
        <div class="group">${gs
          .map(
            (g) => `<button class="cell has-avatar" type="button" data-guest="${g.id}">
              ${avatar(g.name)}
              <span class="cell-body"><span class="cell-title">${esc(g.name)}</span></span>
              <span class="cell-trailing">${g.claimed ? `<span class="sr-only">Ya tiene PIN</span>${icon('lock')}` : ''}${icon('chevronRight', 'chevron')}</span>
            </button>`
          )
          .join('')}</div>
      </section>`
    )
    .join('');
}

app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-guest]');
  if (b && view === 'login') {
    const g = state.guests.find((x) => x.id === Number(b.dataset.guest));
    if (g) openPinSheet(g);
  }
});

function openPinSheet(guest) {
  // create → confirm (primera vez) | enter (ya tiene PIN)
  let mode = guest.claimed ? 'enter' : 'create';
  let firstPin = '';
  let sending = false;

  return sheet(
    (panel, close) => {
      panel.innerHTML = `
        ${ui.sheetBar('', 'Cancelar')}
        <div class="pin-head">${avatar(guest.name, 'lg')}<h2 id="pin-title"></h2><p id="pin-sub"></p></div>
        <div class="pin-boxes" id="pin-boxes">
          ${'<span class="box"></span>'.repeat(4)}
          <input id="pin-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="PIN de 4 dígitos" data-autofocus>
        </div>
        <p class="pin-msg" id="pin-msg"></p>`;
      const input = $('#pin-input', panel);
      const boxes = $$('.box', panel);
      const wrap = $('#pin-boxes', panel);
      const msgEl = $('#pin-msg', panel);

      const texts = () => {
        $('#pin-title', panel).textContent = mode === 'enter' ? `Hola, ${firstName(guest.name)}` : mode === 'create' ? `Hola, ${firstName(guest.name)}` : 'Confirma tu PIN';
        $('#pin-sub', panel).textContent =
          mode === 'enter'
            ? 'Ingresa tu PIN de 4 dígitos.'
            : mode === 'create'
            ? 'Crea un PIN de 4 dígitos. Lo usarás para volver a entrar y ver tu papelito.'
            : 'Escríbelo otra vez para asegurarnos de que lo recuerdas.';
      };
      const paint = () => {
        const n = input.value.length;
        boxes.forEach((b, i) => {
          b.classList.toggle('filled', i < n);
          b.classList.toggle('active', i === Math.min(n, 3) && document.activeElement === input);
        });
      };
      const setMsg = (t, error = false) => {
        msgEl.textContent = t;
        msgEl.classList.toggle('error', error);
      };
      const fail = (t) => {
        setMsg(t, true);
        wrap.classList.remove('error');
        void wrap.offsetWidth;
        wrap.classList.add('error');
        if (navigator.vibrate) navigator.vibrate(60);
        input.value = '';
        paint();
        setTimeout(() => wrap.classList.remove('error'), 450);
      };

      const submit = async (pin) => {
        sending = true;
        input.disabled = true;
        setMsg('Verificando…');
        try {
          await api('/api/claim', { method: 'POST', body: { guestId: guest.id, pin } });
          close(true);
        } catch (err) {
          input.disabled = false;
          if (mode === 'confirm') {
            mode = 'create';
            texts();
          }
          fail(err.message);
          input.focus();
        } finally {
          sending = false;
        }
      };

      input.addEventListener('input', () => {
        const clean = input.value.replace(/\D/g, '').slice(0, 4);
        if (clean !== input.value) input.value = clean;
        paint();
        if (clean.length) setMsg('');
        if (clean.length < 4 || sending) return;
        if (mode === 'create') {
          firstPin = clean;
          mode = 'confirm';
          input.value = '';
          texts();
          paint();
        } else if (mode === 'confirm') {
          if (clean !== firstPin) {
            mode = 'create';
            firstPin = '';
            texts();
            fail('Los PIN no coinciden. Inténtalo de nuevo.');
          } else submit(clean);
        } else submit(clean);
      });
      input.addEventListener('focus', paint);
      input.addEventListener('blur', paint);
      $('[data-close]', panel).addEventListener('click', () => close(false));
      texts();
      paint();
    },
    { label: `Entrar como ${guest.name}`, size: 'large' }
  ).then((ok) => {
    if (ok) {
      search = '';
      window.scrollTo(0, 0);
      return load();
    }
  });
}

// ===========================================================================
// 2. Panel del invitado
// ===========================================================================
function accountButton() {
  return `<button class="icon-btn" type="button" id="account" aria-label="Cuenta" style="background:none;width:40px;height:40px">${avatar(state.me.name)}</button>`;
}

async function renderHome() {
  const { me, phase } = state;
  setNav({ title: phase === 'revealed' ? 'Resultados' : `Hola, ${firstName(me.name)}`, trailing: accountButton() });

  if (phase === 'setup') {
    setView(
      'home',
      `<div class="large-title"><h1>Hola, ${esc(firstName(me.name))}</h1><p>${esc(state.eventName)}</p></div>
       <div class="hero-card"><div class="glyph gray">${icon('hourglass')}</div><h2>Todavía no empezamos</h2>
       <p>El organizador está terminando la lista de invitados. Esta página se actualizará sola cuando todo esté listo.</p></div>`
    );
    return;
  }
  if (phase === 'revealed') return renderResults();

  // phase: open (quinielas abiertas) | drawing (sorteo iniciado)
  const quinielasOpen = phase === 'open';
  const min = state.minQuinielas;
  const missing = Math.max(0, min - me.quinielas);
  const stepQDone = me.quinielas > 0 && missing === 0;
  const canDraw = phase === 'drawing' && !me.hasDrawn;
  const cost = state.quinielaCostCents || 0;
  const costNotice =
    quinielasOpen && cost > 0
      ? `<section class="section"><div class="group"><div class="cell has-icon"><span class="icon-tile green">${icon('cash')}</span>
          <span class="cell-body"><span class="cell-title">Cada quiniela cuesta ${money(cost)}</span><span class="cell-sub">Se paga el día de la cena.</span></span></div></div></section>`
      : '';

  const qSub = !quinielasOpen
    ? me.quinielas
      ? `${plural(me.quinielas, 'quiniela enviada', 'quinielas enviadas')}`
      : 'No enviaste quinielas'
    : stepQDone
    ? 'Listo. Puedes hacer más si quieres.'
    : min > 1
    ? `Te ${missing === 1 ? 'falta' : 'faltan'} ${plural(missing, 'quiniela', 'quinielas')}`
    : 'Adivina quién le regala a quién';

  const steps = me.hasDrawn
    ? ''
    : `<section class="section">
        <div class="section-header"><h2>Tus pasos</h2></div>
        <div class="group">
          <div class="cell has-icon">${
            me.quinielas > 0 && (stepQDone || !quinielasOpen)
              ? `<span class="step-dot done">${icon('check')}</span>`
              : quinielasOpen
              ? '<span class="step-dot current">1</span>'
              : '<span class="step-dot">–</span>'
          }
            <span class="cell-body"><span class="cell-title">Llena tu quiniela</span><span class="cell-sub">${qSub}</span></span></div>
          <div class="cell has-icon"><span class="step-dot ${canDraw ? 'current' : ''}">2</span>
            <span class="cell-body"><span class="cell-title">Saca tu papelito</span><span class="cell-sub">${canDraw ? 'Disponible' : 'Cuando el organizador inicie el sorteo'}</span></span></div>
        </div>
      </section>`;

  const slip = me.hasDrawn && myReceiver ? `<section class="section"><div class="section-header big"><h2>Tu papelito</h2></div>${slipHTML(myReceiver, slipFlipped)}</section>` : '';

  const quinielas = `<section class="section">
      <div class="section-header ${quinielasOpen ? 'big' : ''}"><h2>Mis quinielas</h2>${mine.length ? `<span>${mine.length}</span>` : ''}</div>
      <div class="group">
        ${mine
          .map(
            (q) => `<button class="cell has-icon" type="button" data-quiniela="${q.id}">
              <span class="icon-tile indigo">${icon('list')}</span>
              <span class="cell-body"><span class="cell-title">${esc(q.name)}</span><span class="cell-sub">${plural(q.predictions.length, 'predicción', 'predicciones')}${q.cost_cents ? ` · ${money(q.cost_cents)}` : ''} · ${esc(relTime(q.created_at))}</span></span>
              <span class="cell-trailing">${quinielasOpen ? '' : icon('lock')}${icon('chevronRight', 'chevron')}</span>
            </button>`
          )
          .join('')}
        ${
          me.owedCents > 0
            ? `<div class="cell has-icon"><span class="icon-tile green">${icon('cash')}</span>
                <span class="cell-body"><span class="cell-title">Total a pagar en la cena</span><span class="cell-sub">${plural(me.quinielas, 'quiniela', 'quinielas')}</span></span>
                <span class="cell-trailing"><span class="score" style="font-size:17px">${money(me.owedCents)}</span></span></div>`
            : ''
        }
        ${
          quinielasOpen
            ? `<button class="cell has-icon accent" type="button" id="new-q"><span class="icon-tile red">${icon('plus')}</span><span class="cell-body"><span class="cell-title">Nueva quiniela</span></span></button>`
            : mine.length
            ? ''
            : `<div class="cell"><span class="cell-body muted">No hiciste quinielas.</span></div>`
        }
      </div>
      <p class="section-footer">${
        quinielasOpen
          ? `Adivina a quién le regalará cada persona. Puedes hacer todas las que quieras hasta que el organizador inicie el sorteo; gana la que tenga más aciertos.${
              cost ? ` Cada quiniela cuesta ${money(cost)} y se paga el día de la cena.` : ''
            }`
          : `Las quinielas se cerraron cuando inició el sorteo. Se calificarán cuando el organizador revele los resultados.${
              me.owedCents > 0 ? ` Recuerda llevar ${money(me.owedCents)} a la cena.` : ''
            }`
      }</p>
    </section>`;

  const draw = me.hasDrawn
    ? ''
    : canDraw
    ? `<section class="section"><div class="hero-card">
        <div class="glyph">${icon('gift')}</div>
        <h2>¡El sorteo empezó!</h2>
        <p>Descubre a quién le vas a regalar. Guárdalo en secreto hasta el intercambio.</p>
        <button class="btn" type="button" id="draw">Sacar papelito</button>
      </div></section>`
    : `<section class="section"><div class="hero-card">
        <div class="glyph gray">${icon('lock')}</div>
        <h2>El sorteo aún no empieza</h2>
        <p>Los papelitos se generarán al azar cuando el organizador inicie el sorteo. Así nadie puede saber el resultado mientras se llenan las quinielas.</p>
        <p class="footnote" style="margin:0">Esta página se actualizará sola.</p>
      </div></section>`;

  const body = me.hasDrawn ? slip + quinielas : canDraw ? draw + steps + quinielas : costNotice + steps + quinielas + draw;
  setView(
    'home',
    `<div class="large-title"><h1>Hola, ${esc(firstName(me.name))}</h1><p>${esc(state.eventName)}</p></div>
     ${body}
     <section class="section"><div class="section-header"><h2>Cómo vamos</h2></div><div id="progress">${progressHTML()}</div></section>`
  );
}

function progressHTML() {
  const { stats, phase } = state;
  const quinielasPhase = phase === 'open';
  const value = quinielasPhase ? stats.withQuiniela : stats.drawn;
  const pct = stats.guests ? Math.round((value / stats.guests) * 100) : 0;
  return `<div class="progress-card">
      <div class="progress-top"><span class="progress-num">${value} <small>de ${stats.guests}</small></span><span class="muted" style="font-size:15px">${
        quinielasPhase ? 'ya llenaron su quiniela' : 'ya sacaron papelito'
      }</span></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <div class="meta-row"><span><b>${stats.quinielas}</b> ${stats.quinielas === 1 ? 'quiniela' : 'quinielas'} en juego</span><span><b>${stats.guests}</b> invitados</span></div>
    </div>`;
}

function slipHTML(r, flipped) {
  return `<div class="slip-wrap">
      <button class="slip ${flipped ? 'flipped' : ''}" type="button" id="slip" aria-pressed="${flipped}" aria-label="${flipped ? 'Ocultar papelito' : 'Ver papelito'}">
        <span class="slip-face slip-back"><span class="tap">Toca para ver</span></span>
        <span class="slip-face slip-front" aria-hidden="${!flipped}">
          <span class="eyebrow">Le regalas a</span>
          <span class="who">${esc(r.name)}</span>
          <span class="fam">${esc(r.family)}</span>
        </span>
      </button>
    </div>
    <p class="slip-hint">Es secreto. Toca la tarjeta para mostrarla u ocultarla.</p>`;
}

function flipSlip(btn) {
  slipFlipped = !btn.classList.contains('flipped');
  btn.classList.toggle('flipped', slipFlipped);
  btn.setAttribute('aria-pressed', slipFlipped);
  btn.setAttribute('aria-label', slipFlipped ? 'Ocultar papelito' : 'Ver papelito');
  $('.slip-front', btn)?.setAttribute('aria-hidden', !slipFlipped);
}

async function renderResults() {
  let r;
  try {
    r = await api('/api/results');
  } catch (err) {
    setView('home', `<div class="empty">${icon('exclamation')}<h2>No se pudieron cargar los resultados</h2><p>${esc(err.message)}</p></div>`);
    return;
  }
  const me = state.me;
  const mineDrawn = myReceiver
    ? `<section class="section"><div class="group"><div class="cell has-icon"><span class="icon-tile red">${icon('gift')}</span><span class="cell-body"><span class="cell-sub" style="margin:0">Te tocó regalarle a</span><span class="cell-title" style="font-weight:600">${esc(myReceiver.name)}</span></span></div></div></section>`
    : '';
  // Ranking con empates: misma posición para mismos aciertos.
  let lastHits = null;
  let pos = 0;
  const board = r.leaderboard
    .map((q, i) => {
      if (q.hits !== lastHits) {
        pos = i + 1;
        lastHits = q.hits;
      }
      return `<div class="cell has-icon">
        <span class="rank ${pos <= 3 && q.hits > 0 ? 'r' + pos : ''}">${pos}</span>
        <span class="cell-body"><span class="cell-title">${esc(q.name)}</span><span class="cell-sub">${esc(q.author)}${q.author_id === me.id ? ' · <span class="you">Tú</span>' : ''}</span></span>
        <span class="cell-trailing"><span class="score">${q.hits}<small>/${q.total}</small></span></span>
      </div>`;
    })
    .join('');
  const pairs = r.pairs
    .map(
      (p) => `<div class="cell has-avatar">${avatar(p.giver)}
        <span class="cell-body"><span class="cell-title">${esc(p.giver)}</span><span class="cell-sub">${esc(p.giverFamily)}</span></span>
        <span class="cell-trailing"><span class="pairs-arrow">${icon('arrowRight')}</span><span style="color:var(--label);font-weight:500">${esc(p.receiver)}</span></span>
      </div>`
    )
    .join('');
  setView(
    'home',
    `<div class="large-title"><h1>Resultados</h1><p>${esc(state.eventName)}</p></div>
     ${mineDrawn}
     <section class="section"><div class="section-header big"><h2>Ranking de quinielas</h2>${r.potCents ? `<span>Bolsa: <b style="color:var(--label)">${money(r.potCents)}</b></span>` : ''}</div>
       <div class="group">${board || '<div class="cell"><span class="cell-body muted">Nadie hizo quinielas.</span></div>'}</div>
       <p class="section-footer">Un acierto por cada persona cuyo destinatario adivinaste.${me.owedCents > 0 ? ` Tus quinielas suman ${money(me.owedCents)} a pagar en la cena.` : ''}</p></section>
     <section class="section"><div class="section-header big"><h2>Quién le regaló a quién</h2></div><div class="group">${pairs}</div></section>`
  );
}

// Delegación de eventos del panel
app.addEventListener('click', async (e) => {
  if (view !== 'home') return;
  const t = e.target;
  const slip = t.closest('#slip');
  if (slip) return flipSlip(slip);
  if (t.closest('#new-q')) return openEditor();
  const q = t.closest('[data-quiniela]');
  if (q) return openQuinielaSheet(mine.find((x) => x.id === Number(q.dataset.quiniela)));
  const drawBtn = t.closest('#draw');
  if (drawBtn) return drawPaper(drawBtn);
});

nav.trailing.addEventListener('click', (e) => {
  if (e.target.closest('#account')) openAccountSheet();
});

function openAccountSheet() {
  const me = state.me;
  sheet(
    (panel, close) => {
      panel.innerHTML = `
        ${ui.sheetBar('Cuenta')}
        <div class="pin-head">${avatar(me.name, 'lg')}<h2>${esc(me.name)}</h2><p>${esc(me.family)}</p></div>
        <div class="section" style="margin-top:24px"><div class="group">
          <button class="cell destructive" type="button" id="logout">Cerrar sesión</button>
        </div><p class="section-footer">Si este no es tu nombre, cierra sesión y elige el tuyo. Para volver a entrar necesitarás tu PIN.</p></div>`;
      $('[data-close]', panel).addEventListener('click', () => close());
      $('#logout', panel).addEventListener('click', async () => {
        await act(() => api('/api/logout', { method: 'POST' }));
        slipFlipped = false;
        close();
        await load();
      });
    },
    { label: 'Cuenta' }
  );
}

function openQuinielaSheet(q) {
  if (!q) return;
  const nameOf = new Map(state.guests.map((g) => [g.id, g.name]));
  const canDelete = state.phase === 'open';
  sheet(
    (panel, close) => {
      panel.innerHTML = `
        ${ui.sheetBar(q.name)}
        <div class="section"><div class="section-header"><h2>${plural(q.predictions.length, 'predicción', 'predicciones')}${q.cost_cents ? ` · ${money(q.cost_cents)}` : ''} · ${esc(relTime(q.created_at))}</h2></div>
          <div class="group">${q.predictions
            .map(
              (p) => `<div class="cell"><span class="cell-body"><span class="cell-title">${esc(nameOf.get(p.giver_id) || '—')}</span></span>
              <span class="cell-trailing"><span class="pairs-arrow">${icon('arrowRight')}</span><span style="color:var(--label)">${esc(nameOf.get(p.receiver_id) || '—')}</span></span></div>`
            )
            .join('')}</div></div>
        ${canDelete ? `<div class="section"><div class="group"><button class="cell destructive" type="button" id="del-q">Eliminar quiniela</button></div></div>` : ''}`;
      $('[data-close]', panel).addEventListener('click', () => close());
      $('#del-q', panel)?.addEventListener('click', async () => {
        const ok = await confirm(
          '¿Eliminar esta quiniela?',
          `Esta acción no se puede deshacer.${q.cost_cents ? ` Ya no se te cobrarán sus ${money(q.cost_cents)}.` : ''}`,
          { confirmLabel: 'Eliminar', destructive: true }
        );
        if (!ok) return;
        const res = await act(() => api(`/api/quinielas/${q.id}`, { method: 'DELETE' }));
        if (res) {
          close();
          toast('Quiniela eliminada');
          await load({ keepScroll: true });
        }
      });
    },
    { label: q.name }
  );
}

async function drawPaper(btn) {
  const res = await busy(btn, () =>
    act(async () => {
      const [r] = await Promise.all([api('/api/draw', { method: 'POST' }), ui.sleep(700)]);
      return r;
    })
  );
  if (!res) return;
  await revealSheet(res.receiver);
  slipFlipped = false;
  window.scrollTo(0, 0);
  await load();
}

function revealSheet(receiver) {
  return sheet(
    (panel, close) => {
      panel.innerHTML = `
        <div class="pin-head" style="padding-top:12px"><h2>Tu papelito</h2><p>Guárdalo en secreto hasta el intercambio.</p></div>
        <div style="margin:24px 0 8px">${slipHTML(receiver, false)}</div>
        <button class="btn block" type="button" data-close style="margin-top:20px">Listo</button>`;
      const s = $('#slip', panel);
      s.addEventListener('click', () => flipSlip(s));
      $('[data-close]', panel).addEventListener('click', () => close());
      setTimeout(() => {
        if (!s.classList.contains('flipped')) flipSlip(s);
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      }, ui.reducedMotion() ? 50 : 900);
    },
    { label: 'Tu papelito', dismissible: false }
  );
}

// ===========================================================================
// 3. Editor de quiniela
// ===========================================================================
function openEditor() {
  if (state.phase !== 'open') return;
  editor = { dirty: false, leaving: false };
  history.pushState({ editor: true }, '', '#nueva-quiniela');
  renderEditor();
}

function renderEditor() {
  const { guests, me, avoidSameFamily } = state;
  setNav({
    title: 'Nueva quiniela',
    leading: `<button class="text-btn" type="button" id="ed-cancel">Cancelar</button>`,
    trailing: `<button class="text-btn strong" type="button" id="ed-save-top" disabled>Guardar</button>`,
  });

  const families = new Map();
  for (const g of guests) {
    if (!families.has(g.family_id)) families.set(g.family_id, { name: g.family, members: [] });
    families.get(g.family_id).members.push(g);
  }
  const optionsFor = (giver) =>
    [...families]
      .map(([fid, f]) => {
        const opts = f.members.filter((r) => r.id !== giver.id && (!avoidSameFamily || fid !== giver.family_id));
        return opts.length ? `<optgroup label="${esc(f.name)}">${opts.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</optgroup>` : '';
      })
      .join('');

  setView(
    'editor',
    `<div class="large-title" style="padding-bottom:16px"><h1>Nueva quiniela</h1><p>¿A quién crees que le va a regalar cada persona?</p></div>
     <div class="group">
       <label class="cell"><span class="cell-title">Nombre</span><input class="field-inline" id="ed-name" maxlength="60" placeholder="Quiniela de ${esc(firstName(me.name))}" autocomplete="off"></label>
       <div class="cell" id="ed-cost-row" ${state.quinielaCostCents ? '' : 'hidden'}><span class="cell-body"><span class="cell-title">Costo</span><span class="cell-sub">Se paga el día de la cena</span></span>
         <span class="cell-trailing"><span class="score" id="ed-cost" style="font-size:17px">${money(state.quinielaCostCents)}</span></span></div>
     </div>
     <div class="toolbar">
       <button class="btn small tinted" type="button" id="ed-random">${icon('dice')} Al azar</button>
       <button class="btn small gray" type="button" id="ed-clear">Limpiar</button>
       <span class="count" id="ed-count"></span>
     </div>
     <div class="bar" style="margin-top:12px"><i id="ed-bar" style="width:0"></i></div>
     ${[...families.values()]
       .map(
         (f) => `<section class="section"><div class="section-header"><h2>${esc(f.name)}</h2></div><div class="group">${f.members
           .map(
             (g) => `<div class="cell has-avatar">${avatar(g.name)}
               <span class="cell-body"><span class="cell-title">${esc(g.name)}</span>${g.id === me.id ? '<span class="cell-sub"><span class="you">Tú</span></span>' : ''}</span>
               <span class="picker"><select data-giver="${g.id}" aria-label="A quién le regala ${esc(g.name)}"><option value="">Elegir</option>${optionsFor(g)}</select></span>
             </div>`
           )
           .join('')}</div></section>`
       )
       .join('')}
     <p class="section-footer">Cada persona recibe exactamente un regalo${avoidSameFamily ? ' y nadie le regala a alguien de su propia familia' : ''}. Las opciones ya asignadas aparecen deshabilitadas.</p>
     <div class="mt-28"><button class="btn block" type="button" id="ed-save" disabled>${saveLabel()}</button></div>`
  );
  window.scrollTo(0, 0);
  syncEditor();
}

function saveLabel() {
  return state.quinielaCostCents ? `Guardar quiniela · ${money(state.quinielaCostCents)}` : 'Guardar quiniela';
}

function refreshEditorCost() {
  const c = state.quinielaCostCents;
  const row = $('#ed-cost-row');
  if (row) row.hidden = !c;
  if ($('#ed-cost')) $('#ed-cost').textContent = money(c);
  const btn = $('#ed-save');
  if (btn && !btn.dataset.busy) btn.textContent = saveLabel();
}

function editorSelects() {
  return $$('#app select[data-giver]');
}

function syncEditor() {
  const selects = editorSelects();
  const taken = new Map(); // receiverId -> giverId
  for (const s of selects) if (s.value) taken.set(s.value, s.dataset.giver);
  for (const s of selects) {
    s.parentElement.classList.toggle('filled', !!s.value);
    for (const o of s.options) {
      if (!o.value) continue;
      const owner = taken.get(o.value);
      o.disabled = !!owner && owner !== s.dataset.giver;
    }
  }
  const filled = taken.size;
  const total = selects.length;
  const complete = filled === total && total > 0;
  $('#ed-count').textContent = `${filled} de ${total}`;
  $('#ed-bar').style.width = `${total ? (filled / total) * 100 : 0}%`;
  $('#ed-save').disabled = !complete;
  const top = $('#ed-save-top');
  if (top) top.disabled = !complete;
  editor.dirty = filled > 0 || !!$('#ed-name')?.value.trim();
}

// Sorteo aleatorio válido (con backtracking) para "Al azar".
function randomAssignment() {
  const guests = state.guests;
  const avoid = state.avoidSameFamily;
  const shuffle = (a) => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  const ok = (g, r) => g.id !== r.id && (!avoid || g.family_id !== r.family_id);
  const size = {};
  for (const g of guests) size[g.family_id] = (size[g.family_id] || 0) + 1;
  for (let attempt = 0; attempt < 20; attempt++) {
    const givers = shuffle(guests).sort((a, b) => size[b.family_id] - size[a.family_id]);
    const used = new Set();
    const out = new Map();
    let steps = 0;
    const solve = (i) => {
      if (++steps > 50000) return false;
      if (i === givers.length) return true;
      for (const r of shuffle(guests)) {
        if (used.has(r.id) || !ok(givers[i], r)) continue;
        used.add(r.id);
        out.set(givers[i].id, r.id);
        if (solve(i + 1)) return true;
        used.delete(r.id);
        out.delete(givers[i].id);
      }
      return false;
    };
    if (solve(0)) return out;
  }
  return null;
}

async function saveQuiniela(btn) {
  const selects = editorSelects();
  if (selects.some((s) => !s.value)) return toast('Completa todas las predicciones.', 'err');
  const predictions = selects.map((s) => ({ giver_id: Number(s.dataset.giver), receiver_id: Number(s.value) }));
  const name = $('#ed-name').value.trim();
  const cost = state.quinielaCostCents || 0;
  if (cost > 0) {
    const total = (state.me.owedCents || 0) + cost;
    const ok = await confirm(
      `Esta quiniela cuesta ${money(cost)}`,
      `Se paga el día de la cena. Con esta, llevarías ${money(total)} en total.`,
      { confirmLabel: 'Guardar' }
    );
    if (!ok) return;
  }
  const res = await busy(btn, () => act(() => api('/api/quinielas', { method: 'POST', body: { name, predictions, acceptedCostCents: cost } })));
  if (!res) {
    const fresh = await api('/api/state').catch(() => null);
    if (!fresh) return;
    if (fresh.phase !== 'open') {
      // El organizador cerró las quinielas mientras editabas: regresar al inicio.
      editor.dirty = false;
      editor.leaving = true;
      history.back();
      return;
    }
    // El costo pudo haber cambiado: mostrar el nuevo para que lo confirme.
    state = { ...state, quinielaCostCents: fresh.quinielaCostCents, me: fresh.me || state.me };
    refreshEditorCost();
    return;
  }
  editor.dirty = false;
  editor.leaving = true;
  history.back(); // popstate cierra el editor
  toast('Quiniela guardada');
}

async function leaveEditor() {
  if (editor?.dirty) {
    const ok = await confirm('¿Descartar esta quiniela?', 'Perderás lo que llevas.', { confirmLabel: 'Descartar', cancelLabel: 'Seguir editando', destructive: true });
    if (!ok) return;
  }
  editor.dirty = false;
  editor.leaving = true;
  history.back();
}

app.addEventListener('change', (e) => {
  if (view === 'editor' && e.target.matches('select[data-giver]')) syncEditor();
});
app.addEventListener('input', (e) => {
  if (view === 'editor' && e.target.id === 'ed-name') syncEditor();
});
app.addEventListener('click', (e) => {
  if (view !== 'editor') return;
  if (e.target.closest('#ed-random')) {
    const a = randomAssignment();
    if (!a) return toast('No se pudo generar al azar. Intenta otra vez.', 'err');
    for (const s of editorSelects()) s.value = String(a.get(Number(s.dataset.giver)));
    syncEditor();
  } else if (e.target.closest('#ed-clear')) {
    for (const s of editorSelects()) s.value = '';
    syncEditor();
  } else if (e.target.closest('#ed-save')) {
    saveQuiniela(e.target.closest('#ed-save'));
  }
});
nav.leading.addEventListener('click', (e) => {
  if (e.target.closest('#ed-cancel')) leaveEditor();
});
nav.trailing.addEventListener('click', (e) => {
  const b = e.target.closest('#ed-save-top');
  if (b) saveQuiniela(b);
});

window.addEventListener('popstate', async () => {
  if (view !== 'editor') return;
  if (editor?.dirty && !editor.leaving) {
    // Botón "atrás" del navegador con cambios: quedarse y preguntar.
    history.pushState({ editor: true }, '', '#nueva-quiniela');
    return leaveEditor();
  }
  editor = null;
  window.scrollTo(0, 0);
  await load();
});

window.addEventListener('beforeunload', (e) => {
  if (view === 'editor' && editor?.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ===========================================================================
// Actualización periódica
// ===========================================================================
async function poll() {
  if (document.hidden || loading || view === 'editor' || view === 'loading' || document.querySelector('dialog[open]')) return;
  let next;
  try {
    next = await api('/api/state');
  } catch {
    return;
  }
  if (view === 'editor' || document.querySelector('dialog[open]')) return;
  const prev = state;
  const changed =
    next.phase !== prev.phase ||
    !!next.me !== !!prev.me ||
    next.eventName !== prev.eventName ||
    next.minQuinielas !== prev.minQuinielas ||
    next.quinielaCostCents !== prev.quinielaCostCents ||
    (next.me && prev.me && (next.me.hasDrawn !== prev.me.hasDrawn || next.me.quinielas !== prev.me.quinielas)) ||
    (!next.me && JSON.stringify(next.guests) !== JSON.stringify(prev.guests));
  if (changed) return load({ keepScroll: true });
  state = next;
  const p = $('#progress');
  if (p) p.innerHTML = progressHTML();
}
setInterval(poll, 15000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});

// Arranque: si se recarga con #nueva-quiniela, limpiar el hash.
if (location.hash) history.replaceState(null, '', location.pathname);
load();
