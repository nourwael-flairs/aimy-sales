/* ═══════════════════════════════════════════════════════════════════════
   aimy-ds.js — AiMY Design System behaviour, product-consumable layer
   ───────────────────────────────────────────────────────────────────────
   EXTRACTED, NOT AUTHORED.  Regenerate with:  node assets/ds-extract.js

   Source   design-system/index.html <script> block, commit 6817122
   Kept     theme toggle · tab switcher · outside-click/Escape closers ·
            filter-tray chips · the .copy-field handler · the delegated
            data-* click router · the Enter-to-submit handler · the whole
            .v2-dropdown controller (keyboard model, typeahead, ARIA
            normalisation, hidden input).
   Dropped  the copy engine, sidebar scrollspy, quick-find, and every demo*
            function — documentation-page behaviour with no product use.

   THREE ADAPTATIONS, applied by the extractor and stated here:
     1 · the router's [data-copy-color] / [data-copy-code] branches are
         removed — they call into the dropped copy engine, and left in they
         throw on the first click anywhere and kill every branch after them.
     2 · the canvas-overlay demo branches are removed for the same reason.
     3 · [data-submit-on-enter] dispatched demoSendOverlay(); it now
         dispatches a bubbling 'aimy:submit' CustomEvent, so the product
         owns what submitting means without this file knowing.

   The pre-paint theme script is NOT here — it must run before first paint
   and is inlined in each page's <head>.
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   THEME TOGGLE
═══════════════════════════════════════════════════ */
(function () {
  const btn = document.getElementById('ds-theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    if (next === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    try { localStorage.setItem('aimy-ds-theme', next); } catch (e) {}
  });
})();


/* ═══════════════════════════════════════════════════
   TABS — switch panel within a .ds-tabs group
═══════════════════════════════════════════════════ */
/* Selection is announced as well as painted.
   This used to toggle .active and nothing else, so a strip built with
   role="tablist" kept whatever aria-selected the markup shipped with — after
   the first switch a screen reader was told the wrong tab was current, which
   is worse than no ARIA at all. Arrow-key navigation is expected inside a
   tablist and was missing too, leaving the component mouse-only. */
function dsTab(btn, panelId) {
  const root = btn.closest('.ds-section') || document;
  const strip = btn.closest('.ds-tabs') || root;
  strip.querySelectorAll('.ds-tab').forEach(t => {
    const on = t === btn;
    t.classList.toggle('active', on);
    if (t.hasAttribute('role') || t.hasAttribute('aria-selected')) t.setAttribute('aria-selected', on ? 'true' : 'false');
    /* Roving tabindex: one stop for the strip, arrows move within it. */
    if (strip.getAttribute('role') === 'tablist') t.tabIndex = on ? 0 : -1;
  });
  root.querySelectorAll('.ds-tabpanel').forEach(p => {
    p.style.display = (p.getAttribute('data-tp') === panelId) ? '' : 'none';
  });
}

/* Arrow / Home / End within a .ds-tabs strip. */
document.addEventListener('keydown', function (e) {
  if (!/^(ArrowRight|ArrowLeft|ArrowDown|ArrowUp|Home|End)$/.test(e.key)) return;
  const cur = e.target.closest && e.target.closest('.ds-tab');
  if (!cur) return;
  const strip = cur.closest('.ds-tabs');
  if (!strip || strip.getAttribute('role') !== 'tablist') return;
  const tabs = [...strip.querySelectorAll('.ds-tab')];
  const i = tabs.indexOf(cur);
  let n;
  if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = tabs.length - 1;
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
  else n = (i - 1 + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[n].focus();
  tabs[n].click();
});

/* Close open menus / popovers on outside click or Escape */
document.addEventListener('click', function (e) {
  document.querySelectorAll('.menu-anchor.open, .pop.open').forEach(function (el) {
    if (!el.contains(e.target)) el.classList.remove('open');
  });
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') document.querySelectorAll('.menu-anchor.open, .pop.open').forEach(el => el.classList.remove('open'));
});


/* ═══════════════════════════════════════════════════
   FILTER TRAY DEMO — toggle chip active state
═══════════════════════════════════════════════════ */
function toggleFilterChip(btn) {
  btn.classList.toggle('active');
}
function clearFilterChips(btn) {
  const tray = btn.closest('.filter-tray-inner');
  if (tray) tray.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
}


/* ═══════════════════════════════════════════════════
   DELEGATED EVENT BINDING

   One listener on the document, dispatching on data-*
   attributes. Replaces the inline onclick string
   handlers that used to be scattered through the page.

   Why it matters beyond tidiness: inline handlers are
   parsed as script from a markup attribute, which is
   exactly what a strict Content-Security-Policy blocks.
   A component whose behaviour lives in an attribute
   cannot be shipped into a CSP-enforcing product, and
   markup copied from this page would carry that
   limitation with it.

   closest() resolves nesting on its own — an inner
   handler wins over an outer one without needing
   event.stopPropagation().
═══════════════════════════════════════════════════ */
document.addEventListener('click', function (e) {
  const t = e.target;
  let el;

  /* ── Copy field (component) ──
     Ships with the library rather than being left to each consumer. Without
     it, every product either writes this again or ships a button that
     silently does nothing — the field looks correct and copies nothing, which
     is worse than an obviously broken control. Self-contained on purpose: no
     dependency on this page's copyColor/copyCode, which are documentation
     chrome and are dropped on extraction. */
  if ((el = t.closest('.copy-field .copy-btn'))) {
    const field = el.closest('.copy-field');
    const src = field && field.querySelector('code');
    const value = el.getAttribute('data-copy-value') || (src ? src.textContent.trim() : '');
    if (!value) return;
    const done = () => {
      const label = el.querySelector('.copy-btn-label');
      const prev = label ? label.textContent : null;
      el.classList.add('copied');
      if (label) label.textContent = 'Copied';
      setTimeout(() => {
        el.classList.remove('copied');
        if (label && prev !== null) label.textContent = prev;
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, () => {});
    } else {
      /* file:// and non-secure origins have no async clipboard */
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (err) {}
      ta.remove();
    }
    return;
  }

  /* Copy engine branches dropped with the COPY ENGINE section. */

  /* ── Overlay open / close / toggle by id ── */
  if ((el = t.closest('[data-open]')))   { byId(el, 'data-open',   n => n.classList.add('open'));    return; }
  if ((el = t.closest('[data-close]')))  { byId(el, 'data-close',  n => n.classList.remove('open')); return; }
  if ((el = t.closest('[data-toggle]'))) { byId(el, 'data-toggle', n => n.classList.toggle('open')); return; }
  if ((el = t.closest('[data-show]')))   { byId(el, 'data-show',   n => n.style.display = 'flex');   return; }
  if ((el = t.closest('[data-hide]')))   { byId(el, 'data-hide',   n => n.style.display = 'none');   return; }

  /* Backdrop dismiss — only when the backdrop itself was clicked */
  if (t.hasAttribute && t.hasAttribute('data-hide-on-backdrop')) {
    t.style.display = 'none';
    return;
  }

  /* ── Removal ── */
  if ((el = t.closest('[data-remove-parent]'))) { el.parentElement.remove(); return; }
  if ((el = t.closest('[data-remove-closest]'))) {
    const target = el.closest(el.getAttribute('data-remove-closest'));
    if (target) target.remove();
    return;
  }

  /* ── Single-select within a sibling group ── */
  if ((el = t.closest('[data-select-sibling]'))) {
    Array.from(el.parentElement.children).forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    return;
  }

  /* ── Tabs ── */
  if ((el = t.closest('[data-tab]'))) { dsTab(el, el.getAttribute('data-tab')); return; }

  /* ── Number stepper ── */
  if ((el = t.closest('[data-step]'))) {
    const input = el.parentElement.querySelector('input');
    if (input) {
      const delta = parseInt(el.getAttribute('data-step'), 10);
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) + delta);
    }
    return;
  }

  /* ── Password visibility ── */
  if ((el = t.closest('[data-toggle-pw]'))) {
    const input = document.getElementById(el.getAttribute('data-toggle-pw'));
    if (input) {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      el.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    }
    return;
  }

  /* ── Briefing card ── */
  if ((el = t.closest('[data-toggle-dismiss]'))) {
    const picker = el.closest('.bcard-ack-row').querySelector('.bcard-dismiss-picker');
    if (picker) picker.classList.toggle('open');
    return;
  }
  if ((el = t.closest('[data-toggle-card]'))) {
    const panel = el.querySelector('.bcard-data');
    if (panel) panel.classList.toggle('open');
    const chev = el.querySelector('.expand-toggle');
    if (chev) chev.classList.toggle('open');
    return;
  }

  /* ── Filter tray ── */
  if ((el = t.closest('[data-filter-chip]'))) { toggleFilterChip(el); return; }
  if ((el = t.closest('[data-clear-filter-chips]'))) { clearFilterChips(el); return; }

  /* Canvas overlay demo branches dropped with their section. */
});

function byId(el, attr, fn) {
  const node = document.getElementById(el.getAttribute(attr));
  if (node) fn(node);
}

/* Enter submits, Shift+Enter newlines — delegated, no inline onkeydown */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const ta = e.target.closest && e.target.closest('[data-submit-on-enter]');
  if (!ta) return;
  e.preventDefault();
  ta.dispatchEvent(new CustomEvent('aimy:submit', { bubbles: true, detail: { value: ta.value } }));
});


/* ═══════════════════════════════════════════════════
   DROPDOWN (.v2-dropdown)

   A custom listbox replaces the native <select>, so
   everything the platform used to provide has to be
   re-implemented here: keyboard navigation, typeahead,
   focus management and the ARIA that makes it announce
   as a listbox. That work is the cost of the custom
   control — skipping it produces a div that looks like
   a select and is unusable without a mouse.

   Pattern: button[aria-haspopup=listbox][aria-expanded]
   + panel[role=listbox][aria-activedescendant]
   + options[role=option][aria-selected].
   Focus moves to the panel on open; the active option
   is tracked with aria-activedescendant.
═══════════════════════════════════════════════════ */
(function () {
  let openDD = null;
  let typeBuf = '', typeTimer = null;

  const parts = dd => ({
    btn:   dd.querySelector('.v2-dropdown-btn'),
    panel: dd.querySelector('.v2-dropdown-panel'),
    opts:  Array.from(dd.querySelectorAll('.v2-dropdown-option'))
  });

  function ensureIds(dd) {
    const { panel, opts } = parts(dd);
    if (!panel.id) panel.id = 'dd-panel-' + Math.random().toString(36).slice(2, 8);
    opts.forEach((o, i) => { if (!o.id) o.id = panel.id + '-opt-' + i; });
  }

  function setActive(dd, opt) {
    const { panel, opts } = parts(dd);
    opts.forEach(o => o.classList.remove('is-active'));
    if (!opt) return;
    opt.classList.add('is-active');
    panel.setAttribute('aria-activedescendant', opt.id);
    /* keep the active row in view without scrolling the page.

       Divided by the zoom. getBoundingClientRect reports VISUAL px; scrollTop is
       LAYOUT px. Those are the same number until something above this element
       carries a `zoom`, and assets/aimy-responsive.css puts one on <body> — so
       on a 2560 monitor at scale 1.667 every keyboard step through a dropdown
       overshot by two thirds. currentCSSZoom is the conversion between the two
       spaces, and is 1 wherever there is no scale, which makes the correctness
       here a fact rather than a coincidence. */
    const k = panel.currentCSSZoom || 1;
    const pr = panel.getBoundingClientRect(), or = opt.getBoundingClientRect();
    if (or.bottom > pr.bottom) panel.scrollTop += (or.bottom - pr.bottom) / k;
    else if (or.top < pr.top)  panel.scrollTop -= (pr.top - or.top) / k;
  }

  function open(dd) {
    if (openDD && openDD !== dd) close(openDD, false);
    ensureIds(dd);
    const { btn, panel, opts } = parts(dd);
    panel.classList.add('open');
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    openDD = dd;
    panel.setAttribute('tabindex', '-1');
    panel.focus();
    setActive(dd, opts.find(o => o.getAttribute('aria-selected') === 'true') || opts[0]);
  }

  function close(dd, refocus) {
    const { btn, panel, opts } = parts(dd);
    panel.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    panel.removeAttribute('aria-activedescendant');
    opts.forEach(o => o.classList.remove('is-active'));
    if (openDD === dd) openDD = null;
    if (refocus) btn.focus();
  }

  function choose(dd, opt) {
    const { btn, opts } = parts(dd);
    opts.forEach(o => { o.setAttribute('aria-selected', 'false'); o.classList.remove('selected'); });
    opt.setAttribute('aria-selected', 'true');
    opt.classList.add('selected');

    const label = btn.querySelector('.dd-label-text');
    const value = opt.getAttribute('data-value') || opt.textContent.trim();
    if (label) label.textContent = value;

    /* mirror into a hidden input so the control can live in a real form */
    const input = dd.querySelector('input[type="hidden"]');
    if (input) { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }

    /* .active-filter marks "not the default" — first option is the default */
    btn.classList.toggle('active-filter', opts.indexOf(opt) !== 0);
    dd.dispatchEvent(new CustomEvent('dd:change', { bubbles: true, detail: { value: value } }));
    close(dd, true);
  }

  function move(dd, delta) {
    const { opts } = parts(dd);
    const cur = opts.findIndex(o => o.classList.contains('is-active'));
    let next = cur + delta;
    if (next < 0) next = 0;
    if (next > opts.length - 1) next = opts.length - 1;
    setActive(dd, opts[next]);
  }

  function typeahead(dd, ch) {
    clearTimeout(typeTimer);
    typeBuf += ch.toLowerCase();
    typeTimer = setTimeout(() => { typeBuf = ''; }, 500);
    const { opts } = parts(dd);
    const hit = opts.find(o => o.textContent.trim().toLowerCase().startsWith(typeBuf));
    if (hit) setActive(dd, hit);
  }

  document.addEventListener('click', function (e) {
    const opt = e.target.closest('.v2-dropdown-option');
    if (opt) { choose(opt.closest('.v2-dropdown'), opt); return; }

    const btn = e.target.closest('.v2-dropdown-btn');
    if (btn) {
      if (btn.disabled) return;
      const dd = btn.closest('.v2-dropdown');
      (dd === openDD) ? close(dd, true) : open(dd);
      return;
    }
    if (openDD) close(openDD, false);
  });

  document.addEventListener('keydown', function (e) {
    const btn = e.target.closest && e.target.closest('.v2-dropdown-btn');
    if (btn && !openDD) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(btn.closest('.v2-dropdown'));
      }
      return;
    }
    if (!openDD) return;

    const dd = openDD;
    switch (e.key) {
      case 'Escape':    e.preventDefault(); close(dd, true); break;
      case 'Tab':       close(dd, false); break;
      case 'ArrowDown': e.preventDefault(); move(dd, 1); break;
      case 'ArrowUp':   e.preventDefault(); move(dd, -1); break;
      case 'Home':      e.preventDefault(); setActive(dd, parts(dd).opts[0]); break;
      case 'End':       e.preventDefault(); setActive(dd, parts(dd).opts.slice(-1)[0]); break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const act = parts(dd).opts.find(o => o.classList.contains('is-active'));
        if (act) choose(dd, act);
        break;
      }
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(dd, e.key);
    }
  });

  /* Normalise markup written without the full ARIA set */
  document.querySelectorAll('.v2-dropdown').forEach(dd => {
    const { btn, panel, opts } = parts(dd);
    if (!btn || !panel) return;
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-haspopup', 'listbox');
    if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');
    panel.setAttribute('role', 'listbox');
    opts.forEach(o => {
      o.setAttribute('role', 'option');
      if (!o.hasAttribute('aria-selected')) {
        o.setAttribute('aria-selected', o.classList.contains('selected') ? 'true' : 'false');
      }
    });
    ensureIds(dd);
  });
})();
