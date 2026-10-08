// ---------------------------------------------------------------------------
// html-safe.js - the one place that makes untrusted text safe to put in HTML.
//
// PURPOSE   Every screen builds markup with template literals and innerHTML.
//           Anything that came from a person, a synced row, or an AI model must
//           pass through one of these three helpers before it goes in.
// EXPOSES   window.HtmlSafe = { escape, imageSrc, token }
// DEPENDS   nothing (loaded right after dialog.js, before db.js).
// TESTS     tests/run-tests.js - "HtmlSafe" group.
//
// Why this exists: there used to be nine private copies of escapeHtml. Three of
// them used a DOM round-trip (div.textContent -> innerHTML), which does NOT
// escape quotes, so they were safe between tags but not inside an attribute
// value such as <option value="...">. One implementation, safe in both places.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  // Safe in element content AND inside a quoted attribute value.
  function escape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // For src="..." on an <img> whose value is stored data (signatures, sketches).
  // Accepts only a base64 raster image data URL; anything else becomes ''.
  // SVG is refused on purpose (it can carry script).
  const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
  function imageSrc(value) {
    const s = String(value == null ? '' : value);
    return IMAGE_DATA_URL.test(s) ? s : '';
  }

  // For a value used as part of a CSS class name (status-<x>). Keeps letters,
  // digits, dash and underscore only.
  function token(value, fallback) {
    const s = String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '');
    return s || (fallback || '');
  }

  window.HtmlSafe = { escape, imageSrc, token };
})();
