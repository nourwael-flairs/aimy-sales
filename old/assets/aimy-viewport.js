/* ═══════════════════════════════════════════════════════════════════════════
   AIMY VIEWPORT — PUBLISHES --ui-scale AND --kb

   Ported from AiMY QA (QA/assets/aimy-viewport.js), which solved this first.
   Two departures, each stated rather than smuggled: UI_MIN_SCALE exists here
   and does not exist there, and QA's initRail() is gone because Sales' rail is
   `.app-rail` — a different component with its own labels, not the six-page
   `.nav-item` strip that block was written for.

   Loaded blocking in <head>, after assets/aimy-responsive.css, so --ui-scale is
   set before first paint and a 2560px monitor never flashes the unscaled layout
   on its way to the scaled one.

   There is no circularity to avoid: window.innerWidth is the viewport and is
   NOT affected by a CSS `zoom` on <body> (measured — innerWidth stayed put at
   every zoom factor). Reading it here and writing --ui-scale onto <html>, which
   is outside the zoom, is safe in either order.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* THE VIEWPORT THIS APP IS ACTUALLY VIEWED AT, WHICH IS NOT 1920.

     scale === 1 here exactly, and the whole curve hangs off it — change this
     one number and everything moves.

     A 1920 panel at Windows' default 125% display scaling reports a CSS
     viewport of 1536, and the anchor has to be the CSS width, not the panel
     width. Anchoring above the real viewport is what makes zooming out shrink
     the UI, because it puts every ordinary session inside the clamp, and the
     clamp is what breaks zoom invariance:

         apparent size = ui_scale x browser_zoom
         innerWidth    = screen_width / browser_zoom
         => ui_scale   = screen_width / (browser_zoom x ANCHOR)
         => apparent   = screen_width / ANCHOR      <- browser_zoom cancels

     Browser zoom cancels itself out, but only where ui_scale is free. With the
     anchor at the real viewport width the raw scale is >= 1 everywhere from
     100% zoom outwards, the ceiling never engages, and apparent size is
     genuinely constant across every zoom level. */
  var UI_ANCHOR_W = 1536;

  /* THERE IS NO WIDTH CAP, AND THAT IS THE POINT.

     A cap quietly reintroduces the bug it looks like it is fixing: a 3840-wide
     viewport needs 2.5 to sit at the anchor and a browser zoomed to 25% needs
     4.0, so capping at 1.6 leaves them stretched — visibly the old unscaled
     layout, only slightly larger. A cap does not prevent a large screen from
     looking wrong, it GUARANTEES it; it only moves the width where it starts.

     Uncapped, the width term resolves the effective layout to EXACTLY the
     anchor on any 16:9 or 16:10 screen, which is the whole requirement. This
     ceiling is a sanity bound against a pathological viewport, not a design
     limit; the real bound is the height guard underneath it. */
  var UI_MAX_SCALE = 8;

  /* Scaling on width alone starves height: a 3440x1080 ultrawide would take
     1.79 and be left with 604 layout px of height, less than an iPad. The
     effective layout height is not allowed below this, so on a very wide, very
     short screen the height term wins and a little width stretch is accepted —
     the alternative is a shell too short to hold the app.

     This does NOT cost zoom invariance. Browser zoom scales innerWidth and
     innerHeight by the same factor, so both terms of the min() move together
     and whichever one is binding stays binding. The height term changes which
     ASPECT RATIOS accept a little stretch, never what one screen does at 50%
     zoom versus 100%. */
  var MIN_LAYOUT_H = 720;

  /* ── THE ONE DEPARTURE FROM QA ──────────────────────────────────────────
     QA returns exactly 1 for every raw scale below its dead zone, so it never
     renders smaller than the anchor and lets its breakpoints take the tablet
     range. That leaves a 1024 tablet showing a 1024-wide layout, which is not
     the same experience as the anchor — it is a different, narrower one.

     Sales scales DOWN as well as up, to a floor. At the floor a 1024 viewport
     carries an effective 1205px of layout: the rail, the canvas chat column
     and the full workbench all survive, at ~12px of physical body text. Below
     0.85 the TYPE is the thing that breaks first, so the floor is where
     scaling stops and the breakpoints take over.

     THE FLOOR IS WHY sales.css's BREAKPOINTS ARE MULTIPLIED BY IT. Media
     queries read the REAL viewport, not the scaled one, so a threshold written
     for the layout has to be converted to the width that produces it. Below a
     real 1306 the scale is exactly this constant, so the conversion is a
     single multiplication and it is exact — the derivation is written out in
     full at sales.css's breakpoint block. Change this number and those
     thresholds change with it. */
  var UI_MIN_SCALE = 0.85;

  /* Snap to exactly 1 near the anchor, so a window a few pixels off does not
     ship `zoom: 1.004` — and, on the low side, so a browser whose chrome eats
     a little more height than expected still renders the reference build
     untouched rather than three percent small.

     Asymmetric on purpose. Above the anchor the scale is free and half a
     percent is the worst-case error. Below it the dead zone is doing real work
     for every ordinary laptop: at 1536 wide it absorbs any viewport height
     from 698px up, which is the whole realistic range once browser chrome is
     taken off a 864px screen. */
  var DEADZONE_HI = 1.005;
  var DEADZONE_LO = 0.97;

  /* Below this the soft keyboard is indistinguishable from browser-chrome
     jitter during a scroll, and reacting to that would make the composer
     twitch. */
  var KB_FLOOR = 24;

  var root = document.documentElement;

  /* No `zoom` support means no scaling — and, critically, --ui-scale must then
     stay at 1, because --vp-w/--vp-h divide by it. Publishing a scale the
     engine is going to ignore would shrink every modal by that factor. */
  var CAN_ZOOM = !!(window.CSS && CSS.supports && CSS.supports("zoom", "1.5"));

  function computeScale(vw, vh) {
    if (!CAN_ZOOM) return 1;
    var s = Math.min(vw / UI_ANCHOR_W, vh / MIN_LAYOUT_H);
    if (s >= DEADZONE_LO && s <= DEADZONE_HI) return 1;
    if (s > UI_MAX_SCALE) s = UI_MAX_SCALE;
    if (s < UI_MIN_SCALE) s = UI_MIN_SCALE;
    return Math.round(s * 1000) / 1000;
  }

  var lastScale = null;
  var lastKb = null;
  var lastVW = null;
  var lastVH = null;

  function sync() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var vv = window.visualViewport;

    /* ── AND IT TELLS THE REST OF THE APP ────────────────────────────────
       Everything below this line already exists to notice a viewport change
       that the platform did not announce: `resize` fires before the metrics
       settle, ResizeObserver is not guaranteed, and a browser ZOOM can change
       the viewport with no event at all — which is why the poll at the bottom
       is here. A matchMedia `change` listener has exactly the same problem, and
       measured here it did NOT fire crossing 917.98px, leaving a drawer whose
       script thought it was still open in a layout where it is a column again.

       So the file that already does this work says so, once, rather than every
       consumer growing its own poll. */
    if (vw !== lastVW || vh !== lastVH) {
      lastVW = vw;
      lastVH = vh;
      try {
        dispatchEvent(new CustomEvent("aimy:viewport", {
          detail: { width: vw, height: vh, scale: lastScale === null ? 1 : lastScale }
        }));
      } catch (e) { /* CustomEvent is everywhere `zoom` is; belt and braces */ }
    }

    var s = computeScale(vw, vh);
    if (s !== lastScale) {
      root.style.setProperty("--ui-scale", s);
      lastScale = s;
    }

    /* The soft keyboard, in real px. Self-neutralising: if the UA honours
       interactive-widget=resizes-content then innerHeight shrinks with the
       keyboard and this comes out at 0, so the meta and this listener cannot
       both fire and double-compensate. */
    var kb = vv ? Math.max(0, Math.round(vh - vv.height - vv.offsetTop)) : 0;
    if (kb < KB_FLOOR) kb = 0;
    if (kb !== lastKb) {
      root.style.setProperty("--kb", kb);
      lastKb = kb;
    }
  }

  /* A `resize` event can arrive BEFORE the engine has settled the new metrics —
     measured: a 1920→2560 change fired resize while innerWidth still read 1920,
     so sync() computed 1, memoised it, and no second event ever came. The
     layout then stayed unscaled at 2560 forever. One frame later the metrics
     are correct, so every trigger re-reads on the next frame. */
  var rafPending = false;
  function schedule() {
    sync();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      sync();
    });
  }

  sync(); /* pre-paint */

  addEventListener("resize", schedule, { passive: true });
  addEventListener("orientationchange", schedule, { passive: true });
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", schedule, { passive: true });
    visualViewport.addEventListener("scroll", schedule, { passive: true });
  }

  /* <html> is `height: 100dvh` and is NOT zoomed — the zoom is on <body> — so
     its box tracks the real viewport and cannot be fed back into by anything
     this file writes. That makes it safe to observe. */
  if (window.ResizeObserver) {
    new ResizeObserver(schedule).observe(root);
  }

  /* AND A POLL, BECAUSE NEITHER OF THE ABOVE IS GUARANTEED TO FIRE.

     Changing the browser's ZOOM level changes the viewport without necessarily
     producing a resize event or a ResizeObserver callback — measured: the
     viewport went to 7680 wide, --ui-scale stayed at 1, and dispatching a
     synthetic `resize` by hand immediately corrected it. An app whose layout
     depends on the viewport cannot be one event away from being wrong, and
     zooming out to check how the app behaves on a big screen is exactly what
     someone does first.

     This costs two cached property reads every 250ms and calls sync() only
     when a dimension actually changed, so a steady window does no work at all
     beyond the comparison. */
  var lastW = window.innerWidth;
  var lastH = window.innerHeight;
  setInterval(function () {
    if (window.innerWidth === lastW && window.innerHeight === lastH) return;
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    schedule();
  }, 250);

  /* ── THE READOUT ─────────────────────────────────────────────────────────
     Read by the prototype panel, which is not product UI. The anchor is a
     number someone has to be able to CHECK against their own machine: if
     --ui-scale is not 1.00 at the width this app is designed at, then
     UI_ANCHOR_W or MIN_LAYOUT_H is wrong for that browser, and there is no way
     to find that out from the outside without being told. */
  window.aimyViewport = {
    anchor: UI_ANCHOR_W,
    minLayoutH: MIN_LAYOUT_H,
    minScale: UI_MIN_SCALE,
    canZoom: CAN_ZOOM,
    scale: function () { return lastScale === null ? 1 : lastScale; },
    readout: function () {
      var s = this.scale();
      return {
        scale: s,
        viewport: window.innerWidth + "×" + window.innerHeight,
        layout: Math.round(window.innerWidth / s) + "×" + Math.round(window.innerHeight / s)
      };
    }
  };
})();
