'use strict';
/* Componentes de interfaz compartidos (invitados + admin). Sin dependencias. */

const ui = (() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- Iconos
  // Trazos propios al estilo de SF Symbols (24×24, línea 1.8).
  const P = {
    gift: '<rect x="3.5" y="8" width="17" height="4" rx="1.2"/><path d="M5 12v7.2c0 .7.6 1.3 1.3 1.3h11.4c.7 0 1.3-.6 1.3-1.3V12M12 8v12.5M12 8c-1.2-2.6-3-4.2-4.6-3.6-1.2.4-1.2 2.2 0 2.8C8.6 7.8 10.4 8 12 8Zm0 0c1.2-2.6 3-4.2 4.6-3.6 1.2.4 1.2 2.2 0 2.8-1.2.6-3 .8-4.6.8Z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.6" cy="8.6" r=".9" fill="currentColor"/><circle cx="15.4" cy="15.4" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="15.4" cy="8.6" r=".9" fill="currentColor"/><circle cx="8.6" cy="15.4" r=".9" fill="currentColor"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    trash: '<path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5M6.5 6.5l.8 12.2c.1 1 .9 1.8 1.9 1.8h5.6c1 0 1.8-.8 1.9-1.8l.8-12.2"/>',
    trophy: '<path d="M7.5 4.5h9v5a4.5 4.5 0 0 1-9 0v-5ZM7.5 6.5H4.8c0 2.6 1.3 4.2 3.2 4.6M16.5 6.5h2.7c0 2.6-1.3 4.2-3.2 4.6M12 14v3.5M8.5 20.5h7M9.5 17.5h5"/>',
    sparkles: '<path d="M10 3.5c.5 3.8 2.2 5.5 6 6-3.8.5-5.5 2.2-6 6-.5-3.8-2.2-5.5-6-6 3.8-.5 5.5-2.2 6-6ZM17.5 14c.3 2 1.2 2.9 3 3.2-1.8.3-2.7 1.2-3 3.3-.3-2.1-1.2-3-3-3.3 1.8-.3 2.7-1.2 3-3.2Z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    arrowRight: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17.5" r=".9" fill="currentColor"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.2c0-1-.8-1.7-1.7-1.7H6.2c-1 0-1.7.8-1.7 1.7v7.6c0 1 .8 1.7 1.7 1.7h2.3"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
    people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.5-3.2 2.8-5 5.5-5s5 1.8 5.5 5"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.8 14.2c2.4-.3 4.3 1.2 4.7 4.3"/>',
    hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"/>',
    exclamation: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.3" r=".6" fill="currentColor"/>',
    person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.7-4 3.7-6.2 7.5-6.2s6.8 2.2 7.5 6.2"/>',
    logout: '<path d="M14 4.5H7.2c-1 0-1.7.8-1.7 1.7v11.6c0 1 .8 1.7 1.7 1.7H14M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  };
  const icon = (name, extra = '') =>
    `<svg class="i ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

  // ---------------------------------------------------------------- Avatares
  const AVATAR = [
    ['#ff8a80', '#e5484d'],
    ['#ffb86b', '#f08c00'],
    ['#7bd88f', '#2f9e44'],
    ['#6cc6ff', '#1c7ed6'],
    ['#b197fc', '#7048e8'],
    ['#f783ac', '#d6336c'],
    ['#63e6be', '#0ca678'],
    ['#a5b4c8', '#64748b'],
  ];
  function avatar(name, size = '') {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const [a1, a2] = AVATAR[h % AVATAR.length];
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const initials = ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
    return `<span class="avatar ${size}" style="--a1:${a1};--a2:${a2}" aria-hidden="true">${esc(initials)}</span>`;
  }

  // ---------------------------------------------------------------- Fechas
  function relTime(sqlDate) {
    if (!sqlDate) return '';
    const d = new Date(String(sqlDate).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return '';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 45) return 'hace un momento';
    const m = Math.round(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Dinero en centavos → "$50" o "$50.50" (pesos mexicanos).
  const money = (cents) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: Number(cents) % 100 ? 2 : 0 }).format((Number(cents) || 0) / 100);

  // ---------------------------------------------------------------- Red
  async function request(url, { method = 'GET', body, headers = {} } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      const e = new Error('Sin conexión. Revisa tu internet e intenta de nuevo.');
      e.status = 0;
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || `Algo salió mal (${res.status}).`);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  // ---------------------------------------------------------------- Bloqueo de scroll
  let locks = 0;
  const lockScroll = () => {
    if (locks++ === 0) document.documentElement.style.overflow = 'hidden';
  };
  const unlockScroll = () => {
    if (--locks <= 0) {
      locks = 0;
      document.documentElement.style.overflow = '';
    }
  };

  // ---------------------------------------------------------------- Hoja inferior
  /**
   * Abre una hoja modal. `render(panel, close)` llena el contenido.
   * Devuelve una promesa que se resuelve con el valor pasado a close().
   */
  /**
   * size: 'auto' (hoja media pegada abajo) | 'large' (hoja alta anclada arriba, como
   * los formularios de iOS; se usa cuando hay teclado para que nada tenga que moverse).
   */
  function sheet(render, { label = 'Diálogo', dismissible = true, size = 'auto' } = {}) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = size === 'large' ? 'sheet large' : 'sheet';
      dlg.setAttribute('aria-label', label);
      dlg.innerHTML = '<div class="sheet-scrim"></div><div class="sheet-panel"><div class="sheet-grabber"></div><div class="sheet-content"></div></div>';
      document.body.appendChild(dlg);
      const panel = $('.sheet-panel', dlg);
      const scrim = $('.sheet-scrim', dlg);
      let closed = false;
      const clearDrag = () => {
        panel.style.transition = '';
        panel.style.transform = '';
        scrim.style.transition = '';
        scrim.style.opacity = '';
      };

      const close = async (value) => {
        if (closed) return;
        closed = true;
        // Bajar el teclado primero para que la hoja y el teclado salgan juntos.
        const f = document.activeElement;
        if (f && dlg.contains(f)) f.blur();
        clearDrag(); // desde la posición actual (si se estaba arrastrando) anima hacia abajo
        dlg.classList.remove('open');
        await sleep(reducedMotion() ? 0 : 380);
        dlg.close();
        dlg.remove();
        unlockScroll();
        resolve(value);
      };
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        if (dismissible) close(undefined);
      });
      scrim.addEventListener('click', () => dismissible && close(undefined));
      enableSwipeToDismiss(panel, scrim, {
        canDismiss: () => dismissible && !closed,
        onDismiss: () => close(undefined),
        reset: clearDrag,
      });
      render($('.sheet-content', dlg), close);
      lockScroll();
      dlg.showModal();

      const target = $('[data-autofocus]', dlg);
      if (target) {
        // iOS sólo abre el teclado si el foco ocurre durante el toque del usuario, pero si
        // enfocamos el campo real mientras la hoja todavía está fuera de pantalla, Safari
        // desplaza la página para mostrarlo y todo queda desalineado.
        // Solución: enfocar ahora un campo "señuelo" fijo arriba (ya visible, no provoca
        // desplazamiento) y, cuando la hoja termina de entrar, pasar el foco al campo real.
        // Cambiar el foco entre campos mantiene el teclado abierto.
        const proxy = document.createElement('input');
        proxy.className = 'focus-proxy';
        proxy.type = 'text';
        proxy.tabIndex = -1;
        proxy.autocomplete = 'off';
        proxy.setAttribute('aria-hidden', 'true');
        if (target.inputMode) proxy.inputMode = target.inputMode;
        if (target.getAttribute('pattern')) proxy.setAttribute('pattern', target.getAttribute('pattern'));
        dlg.appendChild(proxy);
        proxy.focus({ preventScroll: true });
        let handedOff = false;
        const handoff = () => {
          if (handedOff) return;
          handedOff = true;
          if (!closed) {
            if (proxy.value) {
              target.value = proxy.value;
              target.dispatchEvent(new Event('input', { bubbles: true }));
            }
            target.focus({ preventScroll: true });
          }
          proxy.remove();
        };
        panel.addEventListener('transitionend', (e) => e.target === panel && e.propertyName === 'transform' && handoff());
        setTimeout(handoff, reducedMotion() ? 0 : 600); // respaldo por si no llega transitionend
      } else {
        panel.tabIndex = -1;
        panel.focus({ preventScroll: true });
      }
      requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add('open')));
    });
  }

  // ---------------------------------------------------------------- Arrastrar para cerrar
  /**
   * Gesto de "jalar hacia abajo" para cerrar una hoja, como en iOS.
   * - Empieza sólo si el contenido de la hoja está hasta arriba (scrollTop 0),
   *   así el scroll normal sigue funcionando.
   * - Cierra si se arrastra más de ~25% de la altura o con un gesto rápido.
   * - Si la hoja no se puede cerrar, hace un rebote elástico y regresa.
   * - Funciona con dedo (touch) y con mouse.
   */
  function enableSwipeToDismiss(panel, scrim, { canDismiss, onDismiss, reset }) {
    const START_THRESHOLD = 6; // px antes de considerar que es arrastre
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0; // px/ms, positivo = hacia abajo
    let tracking = false;
    let dragging = false;
    let suppressClick = false;
    let baseTransform = '';

    const isFormControl = (el) => !!el.closest('input, textarea, select, [contenteditable="true"]');

    const begin = (y, target) => {
      if (isFormControl(target)) return;
      tracking = true;
      dragging = false;
      startY = lastY = y;
      lastT = performance.now();
      velocity = 0;
    };

    // Devuelve true si el gesto está siendo usado por la hoja (hay que bloquear el scroll).
    const move = (y) => {
      if (!tracking) return false;
      const dy = y - startY;
      if (!dragging) {
        if (dy < -START_THRESHOLD || panel.scrollTop > 0) {
          tracking = false; // es scroll hacia arriba o el contenido no está arriba
          return false;
        }
        if (dy < START_THRESHOLD) return false;
        dragging = true;
        // Posición real en reposo (sirve igual para hoja media, alta o centrada).
        const t = getComputedStyle(panel).transform;
        baseTransform = t && t !== 'none' ? t : '';
        panel.style.transition = 'none';
        scrim.style.transition = 'none';
      }
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = 0.8 * ((y - lastY) / dt) + 0.2 * velocity;
      lastY = y;
      lastT = now;

      const raw = Math.max(0, y - startY);
      // Si no se puede cerrar, resistencia elástica fuerte.
      const offset = canDismiss() ? raw : 18 * Math.log1p(raw / 18);
      panel.style.transform = `${baseTransform} translateY(${offset}px)`;
      const h = panel.offsetHeight || 1;
      scrim.style.opacity = String(Math.max(0, 1 - offset / h));
      return true;
    };

    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      const dist = lastY - startY;
      const h = panel.offsetHeight || 1;
      if (canDismiss() && (dist > h * 0.25 || (velocity > 0.5 && dist > 24))) {
        onDismiss();
      } else {
        reset(); // regresa a su lugar con la transición normal
      }
    };

    // Touch
    panel.addEventListener('touchstart', (e) => e.touches.length === 1 && begin(e.touches[0].clientY, e.target), { passive: true });
    panel.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length !== 1) return;
        if (move(e.touches[0].clientY) && e.cancelable) e.preventDefault();
      },
      { passive: false }
    );
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);

    // Mouse
    const onMouseMove = (e) => {
      if (move(e.clientY)) e.preventDefault();
    };
    const onMouseUp = () => {
      end();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    panel.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      begin(e.clientY, e.target);
      if (!tracking) return;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Si el gesto empezó sobre un botón y se arrastró, no disparar el click.
    panel.addEventListener(
      'click',
      (e) => {
        if (suppressClick) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );
  }

  // Encabezado de hoja: título centrado + botón circular de cerrar (estilo iOS).
  const sheetBar = (title = '', closeLabel = 'Cerrar') =>
    `<div class="sheet-bar"><span></span><span class="title">${esc(title)}</span><button class="close-btn" type="button" data-close aria-label="${esc(closeLabel)}">${icon('xmark')}</button></div>`;

  // ---------------------------------------------------------------- Alerta
  /**
   * actions: [{ label, value, role: 'cancel' | 'primary' | 'destructive' }]
   * requireText: si se indica, el botón no-cancel se habilita sólo al escribir ese texto.
   */
  function alert({ title, message = '', actions = [{ label: 'OK', value: true, role: 'primary' }], requireText } = {}) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = requireText ? 'alert has-input' : 'alert';
      dlg.setAttribute('role', 'alertdialog');
      dlg.innerHTML = `<div class="alert-body"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}${
        requireText ? `<input class="field" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(requireText)}">` : ''
      }</div><div class="alert-actions">${actions
        .map((a, i) => `<button type="button" data-i="${i}" class="${a.role || ''}">${esc(a.label)}</button>`)
        .join('')}</div>`;
      document.body.appendChild(dlg);
      const input = $('input', dlg);
      const gated = $$('.alert-actions button', dlg).filter((b) => actions[b.dataset.i].role !== 'cancel');
      if (input) {
        gated.forEach((b) => (b.disabled = true));
        input.addEventListener('input', () => gated.forEach((b) => (b.disabled = input.value.trim().toUpperCase() !== requireText.toUpperCase())));
      }
      let done = false;
      const finish = async (value) => {
        if (done) return;
        done = true;
        dlg.classList.remove('open');
        await sleep(reducedMotion() ? 0 : 160);
        dlg.close();
        dlg.remove();
        unlockScroll();
        resolve(value);
      };
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-i]');
        if (b && !b.disabled) finish(actions[b.dataset.i].value);
      });
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        const c = actions.find((a) => a.role === 'cancel');
        finish(c ? c.value : undefined);
      });
      lockScroll();
      dlg.showModal();
      (input || $('.alert-actions button.primary', dlg) || $('.alert-actions button', dlg))?.focus();
      requestAnimationFrame(() => dlg.classList.add('open'));
    });
  }
  const confirm = (title, message, { confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', destructive = false, requireText } = {}) =>
    alert({
      title,
      message,
      requireText,
      actions: [
        { label: cancelLabel, value: false, role: 'cancel' },
        { label: confirmLabel, value: true, role: destructive ? 'destructive primary' : 'primary' },
      ],
    });

  // ---------------------------------------------------------------- Toast
  function toast(text, type = 'ok', ms = 2600) {
    let host = $('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `${icon(type === 'ok' ? 'check' : 'exclamation')}<span>${esc(text)}</span>`;
    host.appendChild(t);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, ms);
  }

  // ---------------------------------------------------------------- Botón ocupado
  async function busy(btn, fn) {
    if (!btn || btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const html = btn.innerHTML;
    const w = btn.offsetWidth;
    btn.style.minWidth = w + 'px';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="sr-only">Cargando</span>';
    try {
      return await fn();
    } finally {
      btn.innerHTML = html;
      btn.disabled = false;
      btn.style.minWidth = '';
      delete btn.dataset.busy;
    }
  }

  // ---------------------------------------------------------------- Año Nuevo
  // Medianoche del próximo 1 de enero (hora del teléfono). Hasta el 15 de enero se sigue
  // festejando el año que acaba de empezar.
  function newYear(now = new Date()) {
    const y = now.getMonth() === 0 && now.getDate() <= 15 ? now.getFullYear() : now.getFullYear() + 1;
    return { year: y, at: new Date(y, 0, 1, 0, 0, 0) };
  }
  function countdownText(now = new Date()) {
    const { year, at } = newYear(now);
    const ms = at - now;
    if (ms <= 0) return `¡Feliz <b>${year}</b>!`;
    const min = Math.floor(ms / 60000);
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    const m = min % 60;
    if (d >= 2) return `Faltan <b>${d} días</b> para el ${year}`;
    if (d === 1) return `Falta <b>1 día${h ? ` y ${h} h` : ''}</b> para el ${year}`;
    if (h >= 1) return `Faltan <b>${h} h ${m} min</b> para el ${year}`;
    const s = Math.floor(ms / 1000) % 60;
    return `Faltan <b>${m}:${String(s).padStart(2, '0')}</b> para el ${year}`;
  }
  let countdownTimer = null;
  function tickCountdowns() {
    const els = $$('[data-countdown]');
    if (!els.length) return;
    const html = countdownText();
    for (const el of els) if (el.innerHTML !== html) el.innerHTML = html;
  }
  /** Portada de cielo nocturno con el año y la cuenta regresiva. */
  function hero({ eyebrow = '', title = '', sub = '' } = {}) {
    if (!countdownTimer) countdownTimer = setInterval(tickCountdowns, 1000);
    return `<header class="ny-hero">
        <span class="ny-stars" aria-hidden="true"></span>
        <span class="ny-year" aria-hidden="true">${newYear().year}</span>
        ${eyebrow ? `<p class="ny-eyebrow">${icon('sparkles')}${esc(eyebrow)}</p>` : ''}
        <h1>${esc(title)}</h1>
        ${sub ? `<p class="ny-sub">${esc(sub)}</p>` : ''}
        <p class="ny-count">${icon('clock')}<span data-countdown>${countdownText()}</span></p>
      </header>`;
  }

  /** Lluvia de confeti dorado. No hace nada si el usuario pidió menos movimiento. */
  function confetti({ count = 140, duration = 2600 } = {}) {
    if (reducedMotion()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#f6dd95', '#e2b453', '#c8962e', '#ffffff', '#fff4d6', '#3b4fb8', '#1d2a6b'];
    const parts = Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50;
      const speed = 9 + Math.random() * 9;
      return {
        x: fromLeft ? -10 : W + 10,
        y: H * (0.55 + Math.random() * 0.25),
        vx: Math.cos((angle * Math.PI) / 180) * speed,
        vy: Math.sin((angle * Math.PI) / 180) * speed,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        c: colors[(Math.random() * colors.length) | 0],
        round: Math.random() < 0.25,
      };
    });
    const start = performance.now();
    function frame(t) {
      const k = (t - start) / duration;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1;
      for (const p of parts) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.h / 1.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        }
        ctx.restore();
      }
      if (k < 1) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- Barra que se vuelve translúcida
  function watchNavbar(nav) {
    const update = () => nav.classList.toggle('scrolled', window.scrollY > 24);
    window.addEventListener('scroll', update, { passive: true });
    update();
    return update;
  }

  return { $, $$, esc, sleep, icon, sheetBar, avatar, relTime, plural, money, request, sheet, alert, confirm, toast, busy, watchNavbar, reducedMotion, hero, confetti };
})();
