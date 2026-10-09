// Measures text contrast on whatever is on screen, the way WCAG 2 does.
//
//   ContrastAudit.audit(document)  ->  { checked, failures: [{ text, ratio, need, fg, bg, where }] }
//
// For every visible element that has text of its own it works out the text colour
// and the colour actually behind it (walking up through translucent backgrounds
// and averaging gradients), then compares them against 4.5:1, or 3:1 for large
// text (24px, or 18.66px bold). It cannot see text over a photo or a canvas; those
// are skipped and counted, not guessed.
//
// Read-only: it never clicks, types or changes anything, so it is safe anywhere.
(() => {
  'use strict';

  const parse = (str) => {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 };
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const chan = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  // The colour behind an element: composited from the page up. A gradient counts
  // as the average of its stops, which is fair for the mild ones used here.
  function backdrop(el, win) {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = win.getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        if (/url\(/.test(cs.backgroundImage)) return null; // an image: cannot know
        const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
        if (stops.length) {
          // A fade to transparent (a caption scrim over a photo) has its text at the
          // solid end, so judge by the most opaque stop; any other gradient by its average.
          const fades = stops.some((c) => c.a < 0.05);
          let pick;
          if (fades) pick = stops.reduce((m, c) => (c.a > m.a ? c : m), stops[0]);
          else {
            const avg = stops.reduce((s, c) => ({ r: s.r + c.r, g: s.g + c.g, b: s.b + c.b, a: s.a + c.a }), { r: 0, g: 0, b: 0, a: 0 });
            pick = { r: avg.r / stops.length, g: avg.g / stops.length, b: avg.b / stops.length, a: avg.a / stops.length };
          }
          stack.push(pick);
          if (pick.a >= 0.99) break;
        }
      }
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) { stack.push(bg); if (bg.a >= 0.99) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }

  const visible = (el, win) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = win.getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function audit(doc, options) {
    const win = doc.defaultView;
    const opts = options || {};
    const failures = [];
    let checked = 0;
    let skipped = 0;
    const scope = opts.root || doc.body;
    const walker = doc.createTreeWalker(scope, win.NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const text = t.nodeValue.replace(/\s+/g, ' ').trim();
      // Icons and ticks (emoji, arrows) carry no words to read and have names elsewhere.
      if (!text || !/[A-Za-z0-9]/.test(text)) continue;
      const el = t.parentElement;
      if (!el || seen.has(el) || /^(SCRIPT|STYLE|OPTION)$/.test(el.tagName)) continue;
      if (!visible(el, win)) continue;
      // Ignore elements deliberately drawn over the camera, which are not part of the themed screen.
      if (el.closest('.modal, #inspection-modal, #camera-modal, .capture-tile-select-mark')) continue;
      seen.add(el);
      const cs = win.getComputedStyle(el);
      const bg = backdrop(el, win);
      if (!bg) { skipped++; continue; }
      let fg = parse(cs.color);
      if (!fg) continue;
      fg = over(fg, bg);
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      const r = ratio(fg, bg);
      checked++;
      if (r < need - 0.005) {
        failures.push({
          text: text.slice(0, 40),
          ratio: Math.round(r * 100) / 100,
          need,
          fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
          bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
          where: (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''),
        });
      }
    }
    return { checked, skipped, failures };
  }

  window.ContrastAudit = { audit, ratio, parse };
})();
