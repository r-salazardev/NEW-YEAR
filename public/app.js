'use strict';
/* Vista de invitados. Depende de ui.js. */

const { $, $$, esc, icon, avatar, relTime, plural, money, request, sheet, confirm, toast, busy, hero, confetti } = ui;

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

/** Renglón "quien da → quien recibe", con etiquetas explícitas. */
function pairRow(giver, receiver, { hits = null } = {}) {
  return `<div class="pair-row${hits === true ? ' hit' : hits === false ? ' miss' : ''}">
      <span class="pair-side">${avatar(giver)}<span class="pair-text"><span class="pair-label">Da</span><span class="pair-name">${esc(giver)}</span></span></span>
      <span class="pair-mid" aria-label="le regala a">${icon('gift')}<span>le regala a</span></span>
      <span class="pair-side to"><span class="pair-text"><span class="pair-label">Recibe</span><span class="pair-name">${esc(receiver)}</span></span>${avatar(receiver)}</span>
    </div>`;
}

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
      setView('error', `<div class="empty">${icon('exclamation')}<h2>No se pudo cargar</h2><p>${esc(err.message)}</p><p style="margin-top:20px"><button class="btn medium" type="button" id="retry">Reintentar</button></p></div>`);
      $('#retry')?.addEventListener('click', () => location.reload());
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
    `${hero({ eyebrow: 'Bienvenido', title: state.eventName, sub: 'Para entrar, busca tu propio nombre en la lista y tócalo.' })}
     ${
       state.guests.length
         ? `<section class="section login-help">
              <div class="group">
                <div class="cell has-icon"><span class="step-dot current">1</span>
                  <span class="cell-body"><span class="cell-title">Toca <b>tu</b> nombre</span><span class="cell-sub">El tuyo, no el de alguien más de tu familia.</span></span></div>
                <div class="cell has-icon"><span class="step-dot">2</span>
                  <span class="cell-body"><span class="cell-title">Crea un PIN de 4 dígitos</span><span class="cell-sub">Con él vuelves a entrar cuando quieras.</span></span></div>
              </div>
            </section>
            <div class="section-header big login-ask"><h2>¿Quién eres tú?</h2></div>
            <label class="search">${icon('search')}<span class="sr-only">Busca tu nombre</span>
              <input class="field" id="search" type="search" placeholder="Escribe tu nombre" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(search)}">
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
    box.innerHTML = `<div class="empty">${icon('search')}<h2>Sin resultados</h2><p>No encontramos “${esc(search.trim())}”. Revisa cómo está escrito o pregúntale al organizador.</p></div>`;
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
              <span class="cell-body"><span class="cell-title">${esc(g.name)}</span>${g.claimed ? '<span class="cell-sub">Ya entró con su PIN</span>' : ''}</span>
              <span class="cell-trailing">${g.claimed ? icon('lock') : ''}${icon('chevronRight', 'chevron')}</span>
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
        <p class="pin-msg" id="pin-msg"></p>
        <p class="pin-notme"><button class="text-btn" type="button" id="not-me">No soy ${esc(firstName(guest.name))}, elegir otro nombre</button></p>`;
      const input = $('#pin-input', panel);
      const boxes = $$('.box', panel);
      const wrap = $('#pin-boxes', panel);
      const msgEl = $('#pin-msg', panel);

      const texts = () => {
        $('#pin-title', panel).textContent = mode === 'enter' ? `Hola, ${firstName(guest.name)}` : mode === 'create' ? `¿Eres ${guest.name}?` : 'Confirma tu PIN';
        $('#pin-sub', panel).textContent =
          mode === 'enter'
            ? 'Escribe el PIN de 4 dígitos que creaste.'
            : mode === 'create'
            ? 'Si sí eres, crea un PIN de 4 dígitos. Lo usarás para volver a entrar y ver tu papelito.'
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
      $('#not-me', panel).addEventListener('click', () => close(false));
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
      `${hero({ eyebrow: state.eventName, title: `Hola, ${firstName(me.name)}` })}
       <div class="hero-card"><div class="glyph gray">${icon('hourglass')}</div><h2>Todavía no empezamos</h2>
       <p>El organizador está terminando la lista de invitados. Esta página se actualizará sola cuando todo esté listo.</p></div>`
    );
    return;
  }
  if (phase === 'revealed') return renderResults();

  // phase: open (quinielas abiertas) | drawing (sorteo iniciado)
  const quinielasOpen = phase === 'open';
  const canDraw = phase === 'drawing' && !me.hasDrawn;

  const qRows = mine
    .map(
      (q) => `<button class="cell has-icon" type="button" data-quiniela="${q.id}">
        <span class="icon-tile indigo">${icon('list')}</span>
        <span class="cell-body"><span class="cell-title">${esc(q.name)}</span><span class="cell-sub">${plural(q.predictions.length, 'predicción', 'predicciones')}${
          q.cost_cents ? ` · ${money(q.cost_cents)}` : ''
        } · ${esc(relTime(q.created_at))}</span></span>
        <span class="cell-trailing">${quinielasOpen ? '<span class="edit-hint">Ver o editar</span>' : icon('lock')}${icon('chevronRight', 'chevron')}</span>
      </button>`
    )
    .join('');

  let main = '';
  if (quinielasOpen) {
    // Prioridad: llenar la quiniela.
    const first = me.quinielas === 0;
    main = `<section class="section"><div class="fill-card">
        <h2>${first ? 'Llena tu quiniela' : `Llevas ${plural(me.quinielas, 'quiniela', 'quinielas')}`}</h2>
        ${
          first
            ? `<ol class="mini-steps">
                <li><span class="n">1</span><span>Toca <b>Nueva quiniela</b>.</span></li>
                <li><span class="n">2</span><span>Junto a cada persona, elige a quién crees que le va a regalar.</span></li>
                <li><span class="n">3</span><span>Guárdala. Gana la que tenga más aciertos.</span></li>
              </ol>`
            : '<p>Puedes hacer más o editar las que ya tienes hasta que inicie el sorteo.</p>'
        }
        <button class="btn gold block" type="button" id="new-q">${icon('plus')} Nueva quiniela</button>
      </div></section>
      ${
        mine.length
          ? `<section class="section"><div class="section-header big"><h2>Mis quinielas</h2></div><div class="group">${qRows}</div>
              <p class="section-footer">Toca una quiniela para verla, editarla o eliminarla.</p></section>`
          : ''
      }`;
  } else {
    // Prioridad: a quién le regalas.
    const papel = me.hasDrawn
      ? myReceiver
        ? `<section class="section"><div class="section-header big"><h2>Tu papelito</h2></div>${slipHTML(myReceiver, slipFlipped)}</section>`
        : ''
      : `<section class="section"><div class="hero-card">
          <div class="glyph">${icon('gift')}</div>
          <h2>¡El sorteo empezó!</h2>
          <p>Toca el botón para descubrir a quién le vas a regalar. Guárdalo en secreto hasta el intercambio.</p>
          <button class="btn gold" type="button" id="draw">Sacar papelito</button>
        </div></section>`;
    const misQ = mine.length
      ? `<section class="section"><details class="disclosure">
          <summary><span>Ver mis quinielas</span><span class="muted">${mine.length} ${icon('lock')}${icon('chevronRight', 'disc-chev')}</span></summary>
          <div class="group">${qRows}</div>
          <p class="section-footer">Ya no se pueden modificar: se cerraron cuando inició el sorteo.</p>
        </details></section>`
      : '';
    main = papel + misQ;
  }

  setView(
    'home',
    `${hero({ eyebrow: state.eventName, title: `Hola, ${firstName(me.name)}` })}
     ${main}
     <section class="section info-section"><div class="section-header"><h2>Información</h2></div><div id="info">${infoHTML()}</div></section>`
  );
}

/** Información secundaria: premio, lo que debo, avance. Se actualiza sola con el sondeo. */
function infoHTML() {
  const { stats, phase, me } = state;
  const cost = state.quinielaCostCents || 0;
  const contact = (state.paymentContact || '').trim();
  const open = phase === 'open';
  const done = open ? stats.withQuiniela : stats.drawn;
  const rows = [];
  if (cost > 0 || stats.potCents > 0) {
    rows.push(`<div class="cell has-icon"><span class="icon-tile red">${icon('trophy')}</span>
      <span class="cell-body"><span class="cell-title">Premio acumulado</span><span class="cell-sub">${plural(stats.quinielas, 'quiniela', 'quinielas')} en juego</span></span>
      <span class="cell-trailing"><span class="score gold-num">${money(stats.potCents || 0)}</span></span></div>`);
    rows.push(`<div class="cell has-icon"><span class="icon-tile green">${icon('cash')}</span>
      <span class="cell-body"><span class="cell-title">Tu total a pagar</span><span class="cell-sub">${
        me.quinielas ? `${plural(me.quinielas, 'quiniela', 'quinielas')}` : 'Aún no tienes quinielas'
      }${cost ? ` · ${money(cost)} c/u` : ''}</span></span>
      <span class="cell-trailing"><span class="score">${money(me.owedCents || 0)}</span></span></div>`);
  }
  rows.push(`<div class="cell has-icon"><span class="icon-tile gray">${icon('people')}</span>
      <span class="cell-body"><span class="cell-title">${done} de ${stats.guests}</span><span class="cell-sub">${
        open ? 'ya llenaron su quiniela' : 'ya sacaron su papelito'
      }</span></span></div>`);
  if (open) {
    rows.push(`<div class="cell has-icon"><span class="icon-tile navy">${icon('gift')}</span>
      <span class="cell-body"><span class="cell-title">Sorteo</span><span class="cell-sub">Aún no inicia. Cuando empiece, aquí podrás sacar tu papelito.</span></span></div>`);
  }
  const foot =
    cost > 0
      ? open
        ? `Las quinielas se pagan antes de que inicie el sorteo: el día de la cena${contact ? `, o antes con ${esc(contact)}` : ''}.`
        : me.owedCents > 0
        ? `Si aún no pagas tus quinielas, hazlo${contact ? ` con ${esc(contact)}` : ''} cuanto antes.`
        : ''
      : '';
  return `<div class="group">${rows.join('')}</div>${foot ? `<p class="section-footer">${foot}</p>` : ''}`;
}

function slipHTML(r, flipped) {
  return `<div class="slip-wrap">
      <button class="slip ${flipped ? 'flipped' : ''}" type="button" id="slip" aria-pressed="${flipped}" aria-label="${flipped ? 'Ocultar papelito' : 'Ver papelito'}">
        <span class="slip-face slip-back"><span class="tap">Toca para ver</span></span>
        <span class="slip-face slip-front" aria-hidden="${!flipped}">
          <span class="eyebrow">Le regalas a</span>
          <span class="who">${esc(r.name)}</span>
          <span class="fam">${esc(r.family)}</span>
          ${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}
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
      (p) => pairRow(p.giver, p.receiver)
    )
    .join('');
  setView(
    'home',
    `${hero({ eyebrow: state.eventName, title: 'Resultados', sub: '¡Llegó la noche! Así quedó el intercambio.' })}
     ${mineDrawn}
     <section class="section"><div class="section-header big"><h2>Ranking de quinielas</h2>${r.potCents ? `<span>Premio: <b style="color:var(--gold)">${money(r.potCents)}</b></span>` : ''}</div>
       <div class="group">${board || '<div class="cell"><span class="cell-body muted">Nadie hizo quinielas.</span></div>'}</div>
       <p class="section-footer">Un acierto por cada persona cuyo destinatario adivinaste.${me.owedCents > 0 ? ` Tus quinielas suman ${money(me.owedCents)}.` : ''}</p></section>
     <section class="section"><div class="section-header big"><h2>Quién le regaló a quién</h2></div><div class="group">${pairs}</div></section>`
  );
  // Confeti la primera vez que este teléfono ve los resultados.
  let seen = false;
  try {
    seen = localStorage.getItem('ny_results_seen') === '1';
    localStorage.setItem('ny_results_seen', '1');
  } catch {}
  if (!seen) setTimeout(() => confetti({ count: 180, duration: 3200 }), 300);
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
              (p) => pairRow(nameOf.get(p.giver_id) || '—', nameOf.get(p.receiver_id) || '—')
            )
            .join('')}</div></div>
        ${
          canDelete
            ? `<button class="btn block" type="button" id="edit-q" style="margin-top:20px">${icon('list')} Editar quiniela</button>
               <div class="section" style="margin-top:16px"><div class="group"><button class="cell destructive" type="button" id="del-q">Eliminar quiniela</button></div>
               <p class="section-footer">Puedes editarla o eliminarla hasta que inicie el sorteo.</p></div>`
            : `<p class="section-footer" style="margin-top:12px">${icon('lock', '')
                .replace('class="i "', 'class="i" style="display:inline-block;vertical-align:-2px;margin-right:4px"')}Ya no se puede modificar: las quinielas se cerraron al iniciar el sorteo.</p>`
        }`;
      $('[data-close]', panel).addEventListener('click', () => close());
      $('#edit-q', panel)?.addEventListener('click', () => {
        close();
        setTimeout(() => openEditor(q), 50);
      });
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
        setTimeout(() => confetti(), 350);
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      }, ui.reducedMotion() ? 50 : 900);
    },
    { label: 'Tu papelito', dismissible: false }
  );
}

// ===========================================================================
// 3. Editor de quiniela
// ===========================================================================
function openEditor(q = null) {
  if (state.phase !== 'open') return;
  editor = { dirty: false, leaving: false, edit: q, initial: '' };
  history.pushState({ editor: true }, '', q ? '#editar-quiniela' : '#nueva-quiniela');
  renderEditor();
}

const editorSnapshot = () => JSON.stringify([$('#ed-name')?.value.trim() || '', editorSelects().map((s) => s.value)]);

function renderEditor() {
  const { guests, me } = state;
  const edit = editor?.edit;
  setNav({
    title: edit ? 'Editar quiniela' : 'Nueva quiniela',
    leading: `<button class="text-btn" type="button" id="ed-cancel">Cancelar</button>`,
    trailing: `<button class="text-btn strong" type="button" id="ed-save-top" disabled>Guardar</button>`,
  });

  const families = new Map();
  for (const g of guests) {
    if (!families.has(g.family_id)) families.set(g.family_id, { name: g.family, members: [] });
    families.get(g.family_id).members.push(g);
  }
  // En la quiniela se puede elegir a cualquiera (también de la propia familia), menos a uno mismo.
  const optionsFor = (giver) =>
    [...families]
      .map(([, f]) => {
        const opts = f.members.filter((r) => r.id !== giver.id);
        // Las opciones dicen sólo el nombre; mientras la lista está abierta se agrega la nota
        // ("Deyanira — Es la mamá de Anette"). Ver showNotesInPicker.
        const opt = (r) =>
          `<option value="${r.id}" data-name="${esc(r.name)}"${r.note ? ` data-full="${esc(`${r.name} — ${r.note}`)}"` : ''}>${esc(r.name)}</option>`;
        return opts.length ? `<optgroup label="${esc(f.name)}">${opts.map(opt).join('')}</optgroup>` : '';
      })
      .join('');

  setView(
    'editor',
    `<div class="large-title" style="padding-bottom:16px"><h1>${edit ? 'Editar quiniela' : 'Nueva quiniela'}</h1><p>Junto a cada persona (la que <b>da</b> el regalo), elige a quién crees que le va a regalar (la que lo <b>recibe</b>).</p></div>
     <div class="group">
       <label class="cell"><span class="cell-title">Nombre</span><input class="field-inline" id="ed-name" maxlength="60" placeholder="Quiniela de ${esc(firstName(me.name))}" autocomplete="off"></label>
       ${
         edit
           ? edit.cost_cents
             ? `<div class="cell"><span class="cell-body"><span class="cell-title">Costo</span><span class="cell-sub">Ya está en tu total; editar no cobra de nuevo</span></span>
                <span class="cell-trailing"><span class="score" style="font-size:17px">${money(edit.cost_cents)}</span></span></div>`
             : ''
           : `<div class="cell" id="ed-cost-row" ${state.quinielaCostCents ? '' : 'hidden'}><span class="cell-body"><span class="cell-title">Costo</span><span class="cell-sub">Se paga antes del sorteo</span></span>
         <span class="cell-trailing"><span class="score" id="ed-cost" style="font-size:17px">${money(state.quinielaCostCents)}</span></span></div>`
       }
     </div>
     <div class="toolbar">
       <button class="btn small tinted" type="button" id="ed-random">${icon('dice')} Al azar</button>
       <button class="btn small gray" type="button" id="ed-clear">Limpiar</button>
       <span class="count" id="ed-count"></span>
     </div>
     <div class="bar" style="margin-top:12px"><i id="ed-bar" style="width:0"></i></div>
     ${[...families.values()]
       .map(
         (f) => `<section class="section"><div class="section-header ed-cols"><h2>${esc(f.name)} · da</h2><span>recibe ${icon('gift')}</span></div><div class="group">${f.members
           .map(
             (g) => `<div class="cell has-avatar ed-row">${avatar(g.name)}
               <span class="cell-body"><span class="cell-title">${esc(g.name)}${g.id === me.id ? ' <span class="you">(Tú)</span>' : ''}</span>${
                 g.note ? `<span class="who-note">${icon('person')}<span>${esc(g.note)}</span></span>` : ''
               }<span class="cell-sub">le regala a →</span></span>
               <span class="picker"><select data-giver="${g.id}" aria-label="A quién le regala ${esc(g.name)}"><option value="">¿A quién?</option>${optionsFor(g)}</select></span>
             </div>`
           )
           .join('')}</div></section>`
       )
       .join('')}
     <p class="section-footer">Cada persona recibe exactamente un regalo y nadie se regala a sí mismo. Las opciones ya asignadas aparecen deshabilitadas.</p>
     <div class="mt-28"><button class="btn block" type="button" id="ed-save" disabled>${saveLabel()}</button></div>`
  );
  if (edit) {
    $('#ed-name').value = edit.name;
    const byGiver = new Map(edit.predictions.map((p) => [p.giver_id, p.receiver_id]));
    for (const sel of editorSelects()) {
      const r = byGiver.get(Number(sel.dataset.giver));
      if (r && [...sel.options].some((o) => o.value === String(r))) sel.value = String(r);
    }
  }
  window.scrollTo(0, 0);
  editor.initial = editorSnapshot();
  syncEditor();
}

function saveLabel() {
  if (editor?.edit) return 'Guardar cambios';
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
  editor.dirty = editor.edit ? editorSnapshot() !== editor.initial : filled > 0 || !!$('#ed-name')?.value.trim();
}

// "Al azar": usa el mismo sorteo uniforme y criptográfico del servidor (draw.js), pero con la
// regla de la quiniela: cualquiera menos uno mismo (la familia sí se permite). Es independiente
// del sorteo real, que ni siquiera existe mientras las quinielas están abiertas.
function randomAssignment() {
  try {
    return Sorteo.generate(state.guests, { avoidFamily: false, timeLimitMs: 300 }).draw;
  } catch {
    return null;
  }
}

async function saveQuiniela(btn) {
  const selects = editorSelects();
  if (selects.some((s) => !s.value)) return toast('Completa todas las predicciones.', 'err');
  const predictions = selects.map((s) => ({ giver_id: Number(s.dataset.giver), receiver_id: Number(s.value) }));
  const name = $('#ed-name').value.trim();
  if (editor.edit) {
    const res = await busy(btn, () => act(() => api(`/api/quinielas/${editor.edit.id}`, { method: 'PUT', body: { name, predictions } })));
    if (!res) {
      const fresh = await api('/api/state').catch(() => null);
      if (fresh && fresh.phase !== 'open') {
        editor.dirty = false;
        editor.leaving = true;
        history.back();
      }
      return;
    }
    editor.dirty = false;
    editor.leaving = true;
    history.back();
    toast('Cambios guardados');
    return;
  }
  const cost = state.quinielaCostCents || 0;
  if (cost > 0) {
    const total = (state.me.owedCents || 0) + cost;
    const ok = await confirm(
      `Esta quiniela cuesta ${money(cost)}`,
      `Con esta, llevarías ${money(total)} en total. Se paga antes de que inicie el sorteo: el día de la cena${
        (state.paymentContact || '').trim() ? ` o antes con ${state.paymentContact.trim()}` : ''
      }.`,
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
    const ok = editor.edit
      ? await confirm('¿Descartar los cambios?', 'Tu quiniela se quedará como estaba.', { confirmLabel: 'Descartar', cancelLabel: 'Seguir editando', destructive: true })
      : await confirm('¿Descartar esta quiniela?', 'Perderás lo que llevas.', { confirmLabel: 'Descartar', cancelLabel: 'Seguir editando', destructive: true });
    if (!ok) return;
  }
  editor.dirty = false;
  editor.leaving = true;
  history.back();
}

app.addEventListener('change', (e) => {
  if (view === 'editor' && e.target.matches('select[data-giver]')) {
    showNotesInPicker(e.target, false);
    syncEditor();
  }
});

/**
 * Notas dentro de la lista "¿A quién?": sólo mientras está abierta. Cerrada, cada opción dice
 * sólo el nombre; si no, el selector mediría lo que la opción más larga y apretaría la fila.
 */
function showNotesInPicker(sel, on) {
  for (const o of sel.options) {
    if (!o.dataset.full) continue;
    const text = on ? o.dataset.full : o.dataset.name;
    if (o.textContent !== text) o.textContent = text;
  }
}
for (const type of ['focusin', 'mousedown', 'touchstart']) {
  app.addEventListener(
    type,
    (e) => {
      const sel = view === 'editor' && e.target.closest?.('select[data-giver]');
      if (sel) showNotesInPicker(sel, true);
    },
    { passive: true }
  );
}
app.addEventListener('focusout', (e) => {
  if (view === 'editor' && e.target.matches?.('select[data-giver]')) showNotesInPicker(e.target, false);
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
    history.pushState({ editor: true }, '', editor.edit ? '#editar-quiniela' : '#nueva-quiniela');
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
    next.paymentContact !== prev.paymentContact ||
    (next.me && prev.me && (next.me.hasDrawn !== prev.me.hasDrawn || next.me.quinielas !== prev.me.quinielas)) ||
    (!next.me && JSON.stringify(next.guests) !== JSON.stringify(prev.guests));
  if (changed) return load({ keepScroll: true });
  state = next;
  const info = $('#info');
  if (info) info.innerHTML = infoHTML();
}
setInterval(poll, 15000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});

// Arranque: si se recarga con #nueva-quiniela, limpiar el hash.
if (location.hash) history.replaceState(null, '', location.pathname);
load();
