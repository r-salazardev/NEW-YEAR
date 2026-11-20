'use strict';
/* Panel del organizador. Depende de ui.js. */

const { $, $$, esc, icon, avatar, relTime, plural, money, request, sheet, confirm, toast, busy } = ui;

const app = $('#app');
const navTrailing = $('#nav-trailing');
ui.watchNavbar($('#navbar'));

let key = '';
try {
  key = sessionStorage.getItem('adminKey') || '';
} catch {}
let state = null;
let tab = 'people';
try {
  tab = sessionStorage.getItem('adminTab') || 'people';
} catch {}
let settingsDirty = false;
let listDirty = false;

const api = (url, opts = {}) => request('/api/admin' + url, { ...opts, headers: { 'x-admin-key': key } });

async function act(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401) {
      logout();
      toast('Tu sesión de organizador expiró.', 'err');
      return undefined;
    }
    toast(err.message, 'err', 4200);
    return undefined;
  }
}

function logout() {
  key = '';
  try {
    sessionStorage.removeItem('adminKey');
  } catch {}
  renderLogin();
}

// ===========================================================================
// Acceso
// ===========================================================================
function renderLogin(message = '') {
  navTrailing.innerHTML = '';
  app.innerHTML = `<div class="view">
    <div class="large-title"><h1>Organizador</h1><p>Administra la lista, el sorteo y los resultados.</p></div>
    <form id="login" autocomplete="on">
      <div class="group">
        <label class="cell"><span class="cell-title">Contraseña</span>
          <input class="field-inline" id="pw" type="password" autocomplete="current-password" required placeholder="Requerida" autofocus></label>
      </div>
      <p class="section-footer" id="login-msg" style="color:${message ? '#e5243b' : ''}">${esc(message || 'Es la contraseña definida en ADMIN_PASSWORD del servidor.')}</p>
      <div class="mt-28"><button class="btn block" type="submit">Entrar</button></div>
    </form></div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login button[type=submit]');
    key = $('#pw').value;
    await busy(btn, async () => {
      try {
        state = await api('/state');
        try {
          sessionStorage.setItem('adminKey', key);
        } catch {}
        render();
      } catch (err) {
        key = '';
        const msg = $('#login-msg');
        msg.textContent = err.status === 401 ? 'Contraseña incorrecta.' : err.message;
        msg.style.color = '#e5243b';
        $('#pw').select();
      }
    });
  });
}

// ===========================================================================
// Panel
// ===========================================================================
const PHASE = {
  setup: { label: 'Preparando', badge: 'orange' },
  open: { label: 'Quinielas abiertas', badge: 'green' },
  drawing: { label: 'Sorteo en curso', badge: 'accent' },
  revealed: { label: 'Resultados revelados', badge: '' },
};

async function refresh({ quiet = false } = {}) {
  const next = await act(() => api('/state'));
  if (!next) return;
  state = next;
  if (quiet) {
    // Actualización silenciosa: sólo repinta lo que no se está editando.
    const s = $('#status');
    if (s) s.innerHTML = statusHTML();
    if (tab === 'people') $('#tab-body').innerHTML = peopleHTML();
    if (tab === 'draw') $('#tab-body').innerHTML = drawHTML();
    return;
  }
  render();
}

function render() {
  navTrailing.innerHTML = `<button class="text-btn" type="button" id="logout">Salir</button>`;
  const y = window.scrollY;
  app.innerHTML = `<div class="view">
    <div class="large-title"><h1>${esc(state.eventName)}</h1><p>Panel del organizador</p></div>
    <div id="status">${statusHTML()}</div>
    <div class="segmented mt-28" role="tablist" id="tabs">
      ${[
        ['people', 'Participantes'],
        ['draw', 'Sorteo'],
        ['list', 'Lista'],
        ['settings', 'Ajustes'],
      ]
        .map(([id, label]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`)
        .join('')}
    </div>
    <div id="tab-body"></div>
  </div>`;
  renderTab();
  window.scrollTo(0, y);
}

function statusHTML() {
  const { phase, guests, minQuinielas } = state;
  const drawn = guests.filter((g) => g.drawn_at).length;
  const joined = guests.filter((g) => g.claimed_at).length;
  const totalQ = guests.reduce((s, g) => s + g.quinielas, 0);
  const potCents = guests.reduce((s, g) => s + (g.owed_cents || 0), 0);
  const withQ = guests.filter((g) => g.quinielas > 0).length;
  const minReq = Math.max(1, minQuinielas);
  const ready = guests.filter((g) => g.quinielas >= minReq).length;
  const p = PHASE[phase] || PHASE.setup;

  let body = '';
  let actions = '';
  let progress = null; // [valor, texto]
  if (phase === 'setup') {
    body = guests.length
      ? `Hay ${plural(guests.length, 'invitado', 'invitados')}. Cuando la lista esté completa, abre las quinielas. Los papelitos todavía no se generan.`
      : 'Empieza cargando la lista de invitados en la pestaña Lista.';
    actions = `<button class="btn block" type="button" data-act="open" ${guests.length >= 3 ? '' : 'disabled'}>Abrir quinielas</button>`;
  } else if (phase === 'open') {
    progress = [ready, minReq === 1 ? 'ya llenaron su quiniela' : `llenaron ${minReq} quinielas`];
    body =
      ready === guests.length
        ? 'Todos llenaron su quiniela. Cuando estén listos, inicia el sorteo: se cerrarán las quinielas y se generarán los papelitos al azar en ese momento.'
        : 'Comparte el enlace para que todos llenen su quiniela. Los papelitos no existen todavía: se generan al azar cuando inicies el sorteo, así nadie (ni tú) puede hacer trampa.';
    actions = `<button class="btn block" type="button" data-act="start-draw">Iniciar sorteo</button>`;
  } else if (phase === 'drawing') {
    progress = [drawn, 'sacaron papelito'];
    body =
      drawn === guests.length
        ? 'Todos sacaron su papelito. Cuando hagan el intercambio, revela los resultados.'
        : 'Las quinielas están cerradas y cada quien ya puede sacar su papelito.';
    actions = `<button class="btn block" type="button" data-act="reveal">Revelar resultados</button>`;
  } else {
    body = 'Todos pueden ver quién le regaló a quién y el ranking de quinielas.';
    actions = `<button class="btn block gray" type="button" data-act="unreveal">Ocultar resultados</button>`;
  }
  const pct = progress && guests.length ? Math.round((progress[0] / guests.length) * 100) : 0;

  return `<div class="progress-card">
      <div class="progress-top" style="align-items:center"><span class="badge ${p.badge}">${p.label}</span>
        <button class="text-btn" type="button" data-act="copy" style="height:32px;padding:0 4px;font-size:15px">${icon('copy')} Copiar enlace</button></div>
      ${
        progress
          ? `<div class="progress-top" style="margin-top:14px"><span class="progress-num">${progress[0]} <small>de ${guests.length}</small></span><span class="muted" style="font-size:15px">${progress[1]}</span></div>
             <div class="bar"><i style="width:${pct}%"></i></div>`
          : ''
      }
      ${
        phase === 'setup'
          ? ''
          : `<div class="kpis">
              <div class="kpi"><span class="kpi-num">${totalQ}</span><span class="kpi-label">${totalQ === 1 ? 'Quiniela llenada' : 'Quinielas llenadas'}</span></div>
              <div class="kpi"><span class="kpi-num">${withQ}<small>/${guests.length}</small></span><span class="kpi-label">Personas jugando</span></div>
              <div class="kpi gold"><span class="kpi-num">${money(potCents)}</span><span class="kpi-label">Acumulado${
                state.quinielaCostCents ? ` · ${money(state.quinielaCostCents)} c/u` : ''
              }</span></div>
            </div>`
      }
      <div class="meta-row" style="flex-wrap:wrap"><span><b>${joined}</b> entraron</span><span><b>${guests.length}</b> invitados</span>${
        !state.quinielaCostCents && phase !== 'revealed' && phase !== 'drawing' ? '<span>Sin costo por quiniela (ponlo en Ajustes)</span>' : ''
      }</div>
      <p style="font-size:15px;color:var(--label-2);margin:14px 0 16px">${esc(body)}</p>
      ${actions}
    </div>`;
}

function renderTab() {
  $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  const body = $('#tab-body');
  if (tab === 'people') body.innerHTML = peopleHTML();
  if (tab === 'draw') body.innerHTML = drawHTML();
  if (tab === 'list') renderList(body);
  if (tab === 'settings') renderSettings(body);
}

// ---------------------------------------------------------------- Participantes
function peopleHTML() {
  const { guests, phase } = state;
  if (!guests.length) {
    return `<div class="empty">${icon('people')}<h2>Sin invitados</h2><p>Carga la lista en la pestaña Lista.</p></div>`;
  }
  const fams = new Map();
  for (const g of guests) {
    if (!fams.has(g.family)) fams.set(g.family, []);
    fams.get(g.family).push(g);
  }
  return [...fams]
    .map(
      ([fam, gs]) => `<section class="section"><div class="section-header"><h2>${esc(fam)}</h2><span>${gs.length}</span></div><div class="group">${gs
        .map((g) => {
          const sub = [
            g.claimed_at ? 'Entró' : 'No ha entrado',
            g.quinielas ? plural(g.quinielas, 'quiniela', 'quinielas') : null,
            g.owed_cents ? `debe ${money(g.owed_cents)}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const badge =
            phase === 'setup'
              ? ''
              : phase === 'open'
              ? g.quinielas >= Math.max(1, state.minQuinielas)
                ? '<span class="badge green">Quiniela lista</span>'
                : '<span class="badge orange">Sin quiniela</span>'
              : g.drawn_at
              ? '<span class="badge green">Sacó papelito</span>'
              : '<span class="badge orange">Pendiente</span>';
          return `<button class="cell has-avatar" type="button" data-guest="${g.id}">${avatar(g.name)}
            <span class="cell-body"><span class="cell-title">${esc(g.name)}</span><span class="cell-sub">${esc(sub)}</span></span>
            <span class="cell-trailing">${badge}${icon('chevronRight', 'chevron')}</span></button>`;
        })
        .join('')}</div></section>`
    )
    .join('');
}

function openGuestSheet(g) {
  sheet(
    (panel, close) => {
      const rows = [
        ...(state.phase === 'drawing' || state.phase === 'revealed'
          ? [['Le regala a', g.receiver ? `<b style="color:var(--accent);font-weight:600">${esc(g.receiver)}</b>` : 'Sin asignar']]
          : []),
        ['Familia', esc(g.family)],
        ['Entró', g.claimed_at ? esc(relTime(g.claimed_at)) : 'No'],
        ['Dispositivos con sesión', String(g.sessions)],
        ['Quinielas', String(g.quinielas)],
        ...(g.owed_cents || state.quinielaCostCents ? [['A pagar', `<b style="color:var(--label)">${money(g.owed_cents || 0)}</b>`]] : []),
        ['Papelito', g.drawn_at ? `Sacado ${esc(relTime(g.drawn_at))}` : state.phase === 'drawing' || state.phase === 'revealed' ? 'Pendiente' : 'Aún no hay sorteo'],
      ];
      panel.innerHTML = `
        ${ui.sheetBar()}
        <div class="pin-head">${avatar(g.name, 'lg')}<h2>${esc(g.name)}</h2></div>
        <div class="section" style="margin-top:20px"><div class="group">${rows
          .map(([k, v]) => `<div class="cell"><span class="cell-body cell-title">${k}</span><span class="cell-trailing">${v}</span></div>`)
          .join('')}</div></div>
        ${
          g.claimed_at
            ? `<div class="section"><div class="group"><button class="cell destructive" type="button" id="reset-pin">Restablecer PIN</button></div>
               <p class="section-footer">Úsalo si olvidó su PIN o si alguien más entró con su nombre. Se cerrarán sus sesiones y deberá crear un PIN nuevo. Sus quinielas y su papelito se conservan.</p></div>`
            : ''
        }`;
      $('[data-close]', panel).addEventListener('click', () => close());
      $('#reset-pin', panel)?.addEventListener('click', async () => {
        const ok = await confirm(`¿Restablecer el PIN de ${g.name}?`, 'Tendrá que crear uno nuevo la próxima vez que entre.', { confirmLabel: 'Restablecer', destructive: true });
        if (!ok) return;
        const r = await act(() => api(`/guests/${g.id}/reset-pin`, { method: 'POST' }));
        if (r) {
          close();
          toast('PIN restablecido');
          await refresh();
        }
      });
    },
    { label: g.name }
  );
}

// ---------------------------------------------------------------- Sorteo (quién le regala a quién)
function drawHTML() {
  const { guests, phase } = state;
  if (phase === 'setup' || phase === 'open') {
    return `<div class="empty">${icon('lock')}<h2>Aún no hay sorteo</h2><p>Los papelitos se generan al azar cuando presionas “Iniciar sorteo”. Hasta entonces nadie, ni tú, puede saber quién le regala a quién.</p></div>`;
  }
  const drawn = guests.filter((g) => g.drawn_at).length;
  const fams = new Map();
  for (const g of guests) {
    if (!fams.has(g.family)) fams.set(g.family, []);
    fams.get(g.family).push(g);
  }
  return `<p class="section-footer" style="padding-top:0;margin-bottom:4px">${icon('eye', '')
    .replace('class="i "', 'class="i" style="display:inline-block;vertical-align:-2px;margin-right:4px"')}Sólo tú ves esta pestaña. ${drawn} de ${guests.length} ya sacaron su papelito.</p>
    ${[...fams]
      .map(
        ([fam, gs]) => `<section class="section"><div class="section-header ed-cols"><h2>${esc(fam)} · da</h2><span>recibe ${icon('gift')}</span></div><div class="group">${gs
          .map(
            (g) => `<div class="cell has-avatar">${avatar(g.name)}
              <span class="cell-body"><span class="cell-title">${esc(g.name)}</span><span class="cell-sub">${g.drawn_at ? `Lo sacó ${esc(relTime(g.drawn_at))}` : 'Aún no lo saca'}</span></span>
              <span class="cell-trailing"><span class="pairs-arrow" style="color:var(--gold)">${icon('arrowRight')}</span>
                <span style="text-align:right"><span style="display:block;color:var(--label);font-weight:600">${esc(g.receiver || '—')}</span><span style="display:block;font-size:13px">${esc(g.receiver_family || '')}</span></span></span>
            </div>`
          )
          .join('')}</div></section>`
      )
      .join('')}`;
}

// ---------------------------------------------------------------- Lista
function renderList(body) {
  const locked = state.phase !== 'setup';
  body.innerHTML = `
    <section class="section">
      <div class="section-header"><h2>Invitados por familia</h2></div>
      <textarea class="field" id="list" spellcheck="false" autocapitalize="words" ${locked ? 'disabled' : ''}
        placeholder="Familia García: Juan, María, Pedro&#10;Familia López: Ana, Luis&#10;Familia Pérez: Rosa, Toño, Carmen">${esc(state.listText)}</textarea>
      <p class="section-footer">${
        locked
          ? 'La lista quedó fija al abrir el sorteo. Para cambiarla, reinicia el sorteo desde Ajustes.'
          : 'Una familia por línea: <code>Familia: nombre, nombre</code>. También puedes escribir <code># Familia</code> y debajo un nombre por línea. Los nombres deben ser únicos; quien ya creó PIN lo conserva si su nombre no cambia.'
      }</p>
      <p class="section-footer" id="list-preview"></p>
    </section>
    ${locked ? '' : `<div class="mt-28"><button class="btn block" type="button" id="save-list">Guardar lista</button></div>`}`;
  const ta = $('#list');
  const preview = () => {
    const fams = ta.value.split(/\r?\n/).filter((l) => l.trim());
    const people = parsePreview(ta.value);
    $('#list-preview').textContent = fams.length ? `Vista previa: ${plural(people.families, 'familia', 'familias')}, ${plural(people.guests, 'invitado', 'invitados')}.` : '';
  };
  ta.addEventListener('input', () => {
    listDirty = ta.value !== state.listText;
    preview();
  });
  preview();
  $('#save-list')?.addEventListener('click', (e) =>
    busy(e.currentTarget, async () => {
      const r = await act(() => api('/guests', { method: 'POST', body: { text: ta.value } }));
      if (!r) return;
      listDirty = false;
      toast(`Lista guardada: ${plural(r.guests, 'invitado', 'invitados')}`);
      await refresh();
    })
  );
}

// Mismo criterio que el servidor, sólo para mostrar conteos.
function parsePreview(text) {
  let families = 0;
  let guests = 0;
  let current = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (line.startsWith('#')) {
      families++;
      current = true;
    } else if (colon > -1) {
      families++;
      current = true;
      guests += line.slice(colon + 1).split(',').filter((m) => m.trim()).length;
    } else {
      if (!current) {
        families++;
        current = true;
      }
      guests += line.split(',').filter((m) => m.trim()).length;
    }
  }
  return { families, guests };
}

// ---------------------------------------------------------------- Ajustes
function renderSettings(body) {
  const locked = state.phase !== 'setup';
  const costLocked = state.phase === 'drawing' || state.phase === 'revealed';
  let minQ = state.minQuinielas;
  const costText = (c) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
  body.innerHTML = `
    <section class="section">
      <div class="group">
        <label class="cell"><span class="cell-title">Nombre</span><input class="field-inline" id="s-name" maxlength="80" value="${esc(state.eventName)}" autocomplete="off"></label>
        <div class="cell"><span class="cell-body"><span class="cell-title">Quinielas mínimas</span><span class="cell-sub">Recomendado por persona</span></span>
          <span class="stepper-value" id="s-min-val">${minQ}</span>
          <span class="stepper"><button type="button" id="s-min-dec" aria-label="Menos">−</button><button type="button" id="s-min-inc" aria-label="Más">+</button></span></div>
        <label class="cell"><span class="cell-body"><span class="cell-title">Costo por quiniela</span><span class="cell-sub">Se paga antes de iniciar el sorteo</span></span>
          <span class="money-input"><span aria-hidden="true">$</span><input class="field-inline" id="s-cost" inputmode="decimal" autocomplete="off" placeholder="0" value="${
            state.quinielaCostCents ? costText(state.quinielaCostCents) : ''
          }" aria-label="Costo por quiniela en pesos" ${costLocked ? 'disabled' : ''}></span></label>
        <label class="cell"><span class="cell-body"><span class="cell-title">Para pagar antes</span><span class="cell-sub">A quién contactar</span></span>
          <input class="field-inline" id="s-contact" maxlength="40" placeholder="Nombre" value="${esc(state.paymentContact || '')}" autocomplete="off"></label>
        <label class="cell"><span class="cell-body"><span class="cell-title">Evitar misma familia</span><span class="cell-sub">Nadie le regala a alguien de su familia</span></span>
          <span class="switch"><input type="checkbox" id="s-fam" ${state.avoidSameFamily ? 'checked' : ''} ${locked ? 'disabled' : ''}><span></span></span></label>
      </div>
      <p class="section-footer">El costo se muestra a los invitados al llenar cada quiniela, con el aviso de que se paga antes de iniciar el sorteo: el día de la cena o antes, con la persona de “Para pagar antes”. Déjalo en 0 si son gratis${
        costLocked ? '; ya no se puede cambiar porque las quinielas están cerradas' : '. Si lo cambias, las quinielas ya creadas conservan su costo original'
      }. Las quinielas mínimas sirven de referencia: verás quién no las ha llenado y se te avisará antes de iniciar el sorteo.${
        locked ? ' La regla de familias sólo puede cambiarse antes de abrir las quinielas.' : ''
      }</p>
    </section>
    <div class="mt-28"><button class="btn block" type="button" id="s-save" disabled>Guardar cambios</button></div>
    ${
      state.phase === 'setup'
        ? ''
        : `<section class="section" style="margin-top:40px"><div class="group"><button class="cell destructive" type="button" id="s-reset">Reiniciar sorteo</button></div>
           <p class="section-footer">Borra los papelitos y todas las quinielas y regresa a “Preparando”. La lista y los PIN se conservan.</p></section>`
    }`;
  const saveBtn = $('#s-save');
  // "50", "50.5", "1,000" → centavos; null si no es válido.
  const parseCost = (v) => {
    const t = String(v).replace(/[\s,$]/g, '');
    if (t === '') return 0;
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    const c = Math.round(parseFloat(t) * 100);
    return c <= 10_000_000 ? c : null;
  };
  const fitCost = () => {
    const i = $('#s-cost');
    i.style.setProperty('--chars', Math.max(1, (i.value || i.placeholder).length));
  };
  const mark = () => {
    fitCost();
    const cost = parseCost($('#s-cost').value);
    $('#s-cost').style.color = cost === null ? '#e5243b' : '';
    settingsDirty =
      $('#s-name').value.trim() !== state.eventName ||
      $('#s-contact').value.trim() !== (state.paymentContact || '') ||
      minQ !== state.minQuinielas ||
      $('#s-fam').checked !== state.avoidSameFamily ||
      (cost !== null && cost !== state.quinielaCostCents);
    saveBtn.disabled = !settingsDirty || !$('#s-name').value.trim() || cost === null;
  };
  const setMin = (v) => {
    minQ = Math.max(0, Math.min(20, v));
    $('#s-min-val').textContent = minQ;
    $('#s-min-dec').disabled = minQ <= 0;
    $('#s-min-inc').disabled = minQ >= 20;
    mark();
  };
  setMin(minQ);
  $('#s-min-dec').addEventListener('click', () => setMin(minQ - 1));
  $('#s-min-inc').addEventListener('click', () => setMin(minQ + 1));
  $('#s-name').addEventListener('input', mark);
  $('#s-contact').addEventListener('input', mark);
  $('#s-cost').addEventListener('input', mark);
  $('#s-fam').addEventListener('change', mark);
  saveBtn.addEventListener('click', () =>
    busy(saveBtn, async () => {
      const payload = { eventName: $('#s-name').value.trim(), minQuinielas: minQ, paymentContact: $('#s-contact').value.trim() };
      if (!locked) payload.avoidSameFamily = $('#s-fam').checked;
      const cost = parseCost($('#s-cost').value);
      if (!costLocked && cost !== null && cost !== state.quinielaCostCents) {
        const existing = state.guests.reduce((n, g) => n + g.quinielas, 0);
        if (existing > 0) {
          const ok = await confirm(
            `Cambiar costo a ${money(cost)}`,
            `Ya hay ${plural(existing, 'quiniela', 'quinielas')} que conservan su costo original. El nuevo costo aplica sólo a las quinielas que se creen a partir de ahora.`,
            { confirmLabel: 'Cambiar' }
          );
          if (!ok) return;
        }
        payload.quinielaCostCents = cost;
      }
      const r = await act(() => api('/settings', { method: 'POST', body: payload }));
      if (!r) return;
      settingsDirty = false;
      toast('Ajustes guardados');
      await refresh();
    })
  );
  $('#s-reset')?.addEventListener('click', async () => {
    const ok = await confirm('¿Reiniciar el sorteo?', 'Se borrarán todos los papelitos y quinielas. Escribe REINICIAR para confirmar.', {
      confirmLabel: 'Reiniciar',
      destructive: true,
      requireText: 'REINICIAR',
    });
    if (!ok) return;
    const r = await act(() => api('/reset', { method: 'POST', body: { confirm: 'REINICIAR' } }));
    if (r) {
      toast('Sorteo reiniciado');
      await refresh();
    }
  });
}

// ---------------------------------------------------------------- Acciones de fase
async function phaseAction(name, btn) {
  const { guests } = state;
  if (name === 'copy') {
    const link = location.origin + '/';
    try {
      await navigator.clipboard.writeText(link);
      toast('Enlace copiado');
    } catch {
      await ui.alert({ title: 'Enlace para compartir', message: link });
    }
    return;
  }
  if (name === 'open') {
    if (listDirty) return toast('Guarda la lista antes de abrir las quinielas.', 'err');
    const ok = await confirm(
      'Abrir quinielas',
      `Los ${plural(guests.length, 'invitado', 'invitados')} podrán entrar y llenar sus quinielas. La lista y la regla de familias ya no se podrán editar. Los papelitos se generan después, al iniciar el sorteo.`,
      { confirmLabel: 'Abrir' }
    );
    if (!ok) return;
    const r = await busy(btn, () => act(() => api('/open', { method: 'POST' })));
    if (r) toast('Quinielas abiertas');
  } else if (name === 'start-draw') {
    const minReq = Math.max(1, state.minQuinielas);
    const missing = guests.filter((g) => g.quinielas < minReq);
    const who = missing.slice(0, 4).map((g) => g.name).join(', ') + (missing.length > 4 ? ` y ${missing.length - 4} más` : '');
    const ok = await confirm(
      'Iniciar sorteo',
      (missing.length
        ? `${missing.length === 1 ? 'Falta 1 persona' : `Faltan ${missing.length} personas`} por llenar su quiniela (${who}). `
        : '') +
        `Se cerrarán las quinielas y se generarán los papelitos al azar${state.avoidSameFamily ? ', sin regalos dentro de la misma familia' : ''}. Esto no se puede deshacer.`,
      { confirmLabel: 'Iniciar', destructive: missing.length > 0 }
    );
    if (!ok) return;
    const r = await busy(btn, () => act(() => api('/start-draw', { method: 'POST' })));
    if (r) toast('Sorteo iniciado');
  } else if (name === 'reveal') {
    const pending = guests.filter((g) => !g.drawn_at).length;
    const ok = await confirm(
      'Revelar resultados',
      pending ? `Aún ${pending === 1 ? 'falta 1 persona' : `faltan ${pending} personas`} por sacar papelito. Si revelas, ya no podrán sacarlo desde la página.` : 'Todos verán quién le regaló a quién y el ranking de quinielas.',
      { confirmLabel: 'Revelar', destructive: pending > 0 }
    );
    if (!ok) return;
    const r = await busy(btn, () => act(() => api('/reveal', { method: 'POST' })));
    if (r) toast('Resultados revelados');
  } else if (name === 'unreveal') {
    const r = await busy(btn, () => act(() => api('/unreveal', { method: 'POST' })));
    if (r) toast('Resultados ocultos');
  }
  await refresh();
}

// ---------------------------------------------------------------- Eventos
app.addEventListener('click', async (e) => {
  if (!state || !key) return;
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    if (tab === tabBtn.dataset.tab) return;
    if ((tab === 'list' && listDirty) || (tab === 'settings' && settingsDirty)) {
      const ok = await confirm('¿Descartar cambios?', 'Tienes cambios sin guardar en esta pestaña.', { confirmLabel: 'Descartar', destructive: true });
      if (!ok) return;
    }
    listDirty = settingsDirty = false;
    tab = tabBtn.dataset.tab;
    try {
      sessionStorage.setItem('adminTab', tab);
    } catch {}
    renderTab();
    return;
  }
  const a = e.target.closest('[data-act]');
  if (a) return phaseAction(a.dataset.act, a);
  const g = e.target.closest('[data-guest]');
  if (g) {
    const guest = state.guests.find((x) => x.id === Number(g.dataset.guest));
    if (guest) openGuestSheet(guest);
  }
});
navTrailing.addEventListener('click', (e) => {
  if (e.target.closest('#logout')) logout();
});
window.addEventListener('beforeunload', (e) => {
  if (listDirty || settingsDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Refresco automático de participantes.
setInterval(() => {
  if (!key || !state || document.hidden || document.querySelector('dialog[open]')) return;
  if (tab !== 'people' && tab !== 'draw') {
    // No tocar formularios en edición; sólo el encabezado.
    act(() => api('/state')).then((n) => {
      if (n && !document.querySelector('dialog[open]')) {
        const keepList = state.listText;
        state = { ...n, listText: listDirty ? keepList : n.listText };
        const s = $('#status');
        if (s) s.innerHTML = statusHTML();
      }
    });
    return;
  }
  refresh({ quiet: true });
}, 15000);

// Arranque
if (key) {
  api('/state')
    .then((s) => {
      state = s;
      render();
    })
    .catch((err) => (err.status === 401 ? logout() : renderLogin(err.message)));
} else {
  renderLogin();
}
