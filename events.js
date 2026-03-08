/**
 * Events Module — events.js
 *
 * Event listener registration for toolbar controls, overlay interactions,
 * bridge creation/deletion via mouse, and keyboard shortcuts.
 *
 * Exposes: window.createEventsModule(env) → {}
 *
 * `env` is the shared dependency object supplied by app.js.
 */
window.createEventsModule = function (env) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  DOM refs (from env)                                                */
  /* ------------------------------------------------------------------ */

  const overlay       = env.overlay;
  const pageContainer = env.pageContainer;
  const twoCanvas     = env.twoCanvas;

  /* ------------------------------------------------------------------ */
  /*  Shared helper: after any grid/dimension change, re-snap & redraw  */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /*  Window resize                                                      */
  /* ------------------------------------------------------------------ */

  window.addEventListener('resize', env.fitToWindow);

  /* ------------------------------------------------------------------ */
  /*  Overlay — side-connector hover & bridge creation                   */
  /* ------------------------------------------------------------------ */

  overlay.addEventListener('mousemove', (e) => {
    const rect = pageContainer.getBoundingClientRect();
    const px = (e.clientX - rect.left) / env.currentScale;
    const py = (e.clientY - rect.top)  / env.currentScale;

    let foundBox  = null;
    let foundSide = null;

    for (const box of env.boxes) {
      const side = env.detectSideExtended(box, px, py);
      if (side) {
        foundBox  = box;
        foundSide = side;
        break;
      }
    }

    if (foundBox && foundSide) {
      if (env.hoveredBoxId !== foundBox.id || env.hoveredSide !== foundSide) {
        env.clearAllSideConnectors();
        env.hoveredBoxId = foundBox.id;
        env.hoveredSide  = foundSide;
        env.drawSideConnector(foundBox, foundSide);
      }
    } else {
      env.clearAllSideConnectors();
    }
  });

  overlay.addEventListener('mouseleave', () => {
    env.clearAllSideConnectors();
  });

  /* Click on the overlay to start/complete a bridge via hovered side,
     or place a text field in text-place mode */
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('input, [contenteditable], button, .ranked-indicator, .box-cost, .text-field')) return;

    // --- Text-place mode: create a text field at click position ---
    if (env.textPlaceMode) {
      const rect = env.overlay.parentElement.getBoundingClientRect();
      const px = (e.clientX - rect.left) / env.currentScale;
      const py = (e.clientY - rect.top)  / env.currentScale;
      env.createTextField({
        x: px, y: py, text: 'Text',
        font: env.globalFont, fontSize: env.globalFontSize,
        fontWeight: 'normal', width: 300,
      });
      env.textPlaceMode = false;
      env.overlay.classList.remove('text-place-mode');
      const btn = document.getElementById('btn-add-text');
      if (btn) btn.classList.remove('active');
      env.autoSave();
      return;
    }

    if (!env.hoveredBoxId || !env.hoveredSide) return;

    const box = env.boxes.find(b => b.id === env.hoveredBoxId);
    if (!box) return;

    if (!env.bridgePending) {
      // Start bridge
      env.bridgePending = { boxId: box.id, side: env.hoveredSide };
      const el = document.getElementById('box-' + box.id);
      if (el) el.style.outline = '3px solid #4a90d9';
    } else {
      // Finish bridge
      if (env.bridgePending.boxId !== box.id) {
        const fromBox = env.boxes.find(b => b.id === env.bridgePending.boxId);
        if (fromBox && env.sidesCanConnect(fromBox, env.bridgePending.side, box, env.hoveredSide)) {
          const exists = env.bridges.some(b =>
            (b.fromId === env.bridgePending.boxId && b.toId === box.id &&
             b.fromSide === env.bridgePending.side && b.toSide === env.hoveredSide) ||
            (b.fromId === box.id && b.toId === env.bridgePending.boxId &&
             b.fromSide === env.hoveredSide && b.toSide === env.bridgePending.side)
          );
          if (!exists) {
            env.createBridge({
              fromId: env.bridgePending.boxId,
              toId: box.id,
              fromSide: env.bridgePending.side,
              toSide: env.hoveredSide,
            });
          }
        }
      }
      // Clear pending
      const prevEl = document.getElementById('box-' + env.bridgePending.boxId);
      if (prevEl) prevEl.style.outline = '';
      env.bridgePending = null;
      env.autoSave();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Bridge deletion via right-click                                    */
  /* ------------------------------------------------------------------ */

  /* Right-click on bridge line to delete it directly */
  twoCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rect = twoCanvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / env.currentScale;
    const py = (e.clientY - rect.top) / env.currentScale;

    for (const bridge of env.bridges) {
      const fromBox = env.boxes.find(b => b.id === bridge.fromId);
      const toBox   = env.boxes.find(b => b.id === bridge.toId);
      if (!fromBox || !toBox) continue;
      const [x1, y1] = env.sideAnchor(fromBox, bridge.fromSide || 'right');
      const [x2, y2] = env.sideAnchor(toBox,   bridge.toSide   || 'left');
      if (env.pointNearLine(px, py, x1, y1, x2, y2, 10)) {
        env.removeBridge(bridge.id);
        return;
      }
    }
  });

  /* Also handle right-click on overlay (for bridges behind boxes) */
  overlay.addEventListener('contextmenu', (e) => {
    const rect = pageContainer.getBoundingClientRect();
    const px = (e.clientX - rect.left) / env.currentScale;
    const py = (e.clientY - rect.top)  / env.currentScale;

    for (const bridge of env.bridges) {
      const fromBox = env.boxes.find(b => b.id === bridge.fromId);
      const toBox   = env.boxes.find(b => b.id === bridge.toId);
      if (!fromBox || !toBox) continue;
      const [x1, y1] = env.sideAnchor(fromBox, bridge.fromSide || 'right');
      const [x2, y2] = env.sideAnchor(toBox,   bridge.toSide   || 'left');
      if (env.pointNearLine(px, py, x1, y1, x2, y2, 10)) {
        e.preventDefault();
        env.removeBridge(bridge.id);
        return;
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Toolbar event wiring                                               */
  /* ------------------------------------------------------------------ */

  // --- Add Talent dropdown menu ---
  env.btnAddBox.addEventListener('click', (e) => {
    e.stopPropagation();
    env.addTalentMenu.classList.toggle('open');
  });

  env.addTalentMenu.querySelectorAll('button[data-type]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ttype = btn.dataset.type;
      env.addTalentMenu.classList.remove('open');
      const pos = env.findFreePosition();
      env.createBox({ x: pos.x, y: pos.y, talentType: ttype });
      env.expandPage();
      env.autoSave();
    });
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener('click', () => {
    env.addTalentMenu.classList.remove('open');
    env.insertSymbolMenu.classList.remove('open');
  });

  /* ------------------------------------------------------------------ */
  /*  Insert Symbol dropdown                                             */
  /* ------------------------------------------------------------------ */

  const SYMBOL_MAP = {
    ability:     { char: '\u25C6', color: '#4caf50', cls: 'die-sym die-diamond' },
    difficulty:  { char: '\u25C6', color: '#7b1fa2', cls: 'die-sym die-diamond' },
    proficiency: { char: '\u2B23', color: '#fdd835', cls: 'die-sym die-hex' },
    challenge:   { char: '\u2B23', color: '#d32f2f', cls: 'die-sym die-hex' },
    boost:       { char: '\u25A0', color: '#00bcd4', cls: 'die-sym die-square' },
    setback:     { char: '\u25A0', color: '#212121', cls: 'die-sym die-square' },
  };

  env.btnInsertSymbol.addEventListener('click', (e) => {
    e.stopPropagation();
    env.insertSymbolMenu.classList.toggle('open');
  });

  env.insertSymbolMenu.querySelectorAll('button[data-symbol]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      // Use mousedown so the focused text field doesn't blur before insertion
      e.preventDefault();
      e.stopPropagation();
      const sym = SYMBOL_MAP[btn.dataset.symbol];
      if (sym) env.insertAtCaret(sym.char, sym.color, sym.cls);
      env.insertSymbolMenu.classList.remove('open');
    });
  });

  env.btnTheme.addEventListener('click', () => {
    env.darkMode = !env.darkMode;
    env.applyTheme();
    env.autoSave();
  });

  env.btnSave.addEventListener('click', () => {
    env.downloadJSON();
  });

  env.btnLoad.addEventListener('click', () => {
    env.fileInput.click();
  });

  env.btnExportPdf.addEventListener('click', () => {
    env.exportPDF();
  });

  env.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      env.loadJSON(ev.target.result);
    };
    reader.readAsText(file);
    env.fileInput.value = '';
  });

  /* ------------------------------------------------------------------ */
  /*  Helper: apply font property to a single box                        */
  /* ------------------------------------------------------------------ */

  function applyFontToBox(b, font) {
    if (env.focusedCostBoxId === b.id) {
      b.costFont = font;
    } else {
      b.font = font;
    }
    env.renderBox(b);
    const el = document.getElementById('box-' + b.id);
    if (el) env.growBoxToFit(b, el);
  }

  function applyFontSizeToBox(b, size) {
    if (env.focusedCostBoxId === b.id) {
      b.costFontSize = size;
    } else {
      b.fontSize = size;
    }
    env.renderBox(b);
    const el = document.getElementById('box-' + b.id);
    if (el) env.growBoxToFit(b, el);
  }

  /* ------------------------------------------------------------------ */
  /*  Helper: apply font to a text field                                 */
  /* ------------------------------------------------------------------ */

  function applyFontToTextField(tf, font) {
    tf.font = font;
    env.renderTextField(tf);
  }

  function applyFontSizeToTextField(tf, size) {
    tf.fontSize = size;
    env.renderTextField(tf);
  }

  /* ------------------------------------------------------------------ */
  /*  Helper: apply bold / italic                                        */
  /* ------------------------------------------------------------------ */

  function applyBoldToBox(b, bold) {
    b.bold = bold;
    env.renderBox(b);
    const el = document.getElementById('box-' + b.id);
    if (el) env.growBoxToFit(b, el);
  }

  function applyItalicToBox(b, italic) {
    b.italic = italic;
    env.renderBox(b);
    const el = document.getElementById('box-' + b.id);
    if (el) env.growBoxToFit(b, el);
  }

  function applyBoldToTextField(tf, bold) {
    tf.bold = bold;
    env.renderTextField(tf);
  }

  function applyItalicToTextField(tf, italic) {
    tf.italic = italic;
    env.renderTextField(tf);
  }

  /* ------------------------------------------------------------------ */
  /*  Font family — focused element only                                */
  /* ------------------------------------------------------------------ */

  env.fontSelect.addEventListener('change', () => {
    const font = env.fontSelect.value;

    const focusedBox = env.focusedBoxId != null
      ? env.boxes.find(b => b.id === env.focusedBoxId)
      : null;
    const focusedTf = env.focusedTextFieldId != null
      ? env.textFields.find(t => t.id === env.focusedTextFieldId)
      : null;

    if (focusedBox) {
      applyFontToBox(focusedBox, font);
    } else if (focusedTf) {
      applyFontToTextField(focusedTf, font);
    }
    env.autoSave();
  });

  /* ------------------------------------------------------------------ */
  /*  Font size — focused element only                                   */
  /* ------------------------------------------------------------------ */

  env.fontSizeInput.addEventListener('change', () => {
    const val = parseInt(env.fontSizeInput.value, 10);
    if (isNaN(val) || val < 6) { env.fontSizeInput.value = env.globalFontSize; return; }
    const size = Math.max(6, Math.min(72, val));
    env.fontSizeInput.value = size;

    const focusedBox = env.focusedBoxId != null
      ? env.boxes.find(b => b.id === env.focusedBoxId)
      : null;
    const focusedTf = env.focusedTextFieldId != null
      ? env.textFields.find(t => t.id === env.focusedTextFieldId)
      : null;

    if (focusedBox) {
      applyFontSizeToBox(focusedBox, size);
    } else if (focusedTf) {
      applyFontSizeToTextField(focusedTf, size);
    }
    env.autoSave();
  });

  /* ------------------------------------------------------------------ */
  /*  Bold — focused element only                                        */
  /* ------------------------------------------------------------------ */

  env.fontBoldInput.addEventListener('change', () => {
    const bold = env.fontBoldInput.checked;

    const focusedBox = env.focusedBoxId != null
      ? env.boxes.find(b => b.id === env.focusedBoxId)
      : null;
    const focusedTf = env.focusedTextFieldId != null
      ? env.textFields.find(t => t.id === env.focusedTextFieldId)
      : null;

    if (focusedBox) {
      applyBoldToBox(focusedBox, bold);
    } else if (focusedTf) {
      applyBoldToTextField(focusedTf, bold);
    }
    env.autoSave();
  });

  /* ------------------------------------------------------------------ */
  /*  Italic — focused element only                                      */
  /* ------------------------------------------------------------------ */

  env.fontItalicInput.addEventListener('change', () => {
    const italic = env.fontItalicInput.checked;

    const focusedBox = env.focusedBoxId != null
      ? env.boxes.find(b => b.id === env.focusedBoxId)
      : null;
    const focusedTf = env.focusedTextFieldId != null
      ? env.textFields.find(t => t.id === env.focusedTextFieldId)
      : null;

    if (focusedBox) {
      applyItalicToBox(focusedBox, italic);
    } else if (focusedTf) {
      applyItalicToTextField(focusedTf, italic);
    }
    env.autoSave();
  });

  env.colorStroke.addEventListener('input', () => {
    env.globalStroke = env.colorStroke.value;
    env.boxes.forEach(b => {
      b.strokeColor = env.globalStroke;
      env.updateBoxShape(b);
    });
    env.autoSave();
  });

  env.colorFill.addEventListener('input', () => {
    env.globalFill = env.colorFill.value;
    env.boxes.forEach(b => {
      b.fillColor = env.globalFill;
      env.updateBoxShape(b);
    });
    env.autoSave();
  });

  env.colorBridge.addEventListener('input', () => {
    env.bridgeColor = env.colorBridge.value;
    env.bridges.forEach(b => env.renderBridge(b));
    env.two.update();
    env.autoSave();
  });

  env.boxWInput.addEventListener('change', () => {
    const val = parseInt(env.boxWInput.value, 10);
    if (isNaN(val) || val < 60) { env.boxWInput.value = env.boxW; return; }
    env.boxW = Math.max(60, Math.min(600, val));
    env.boxWInput.value = env.boxW;
    env.autoSave();
  });

  env.boxHInput.addEventListener('change', () => {
    const val = parseInt(env.boxHInput.value, 10);
    if (isNaN(val) || val < 60) { env.boxHInput.value = env.boxH; return; }
    env.boxH = Math.max(60, Math.min(600, val));
    env.boxHInput.value = env.boxH;
    env.autoSave();
  });

  env.bridgeWInput.addEventListener('change', () => {
    const val = parseFloat(env.bridgeWInput.value);
    if (isNaN(val) || val < 0.5) { env.bridgeWInput.value = env.bridgeWidth; return; }
    env.bridgeWidth = Math.max(0.5, Math.min(20, val));
    env.bridgeWInput.value = env.bridgeWidth;
    env.bridges.forEach(b => env.renderBridge(b));
    env.two.update();
    env.autoSave();
  });

  /* ------------------------------------------------------------------ */
  /*  Add Text — toggle text-place mode                                  */
  /* ------------------------------------------------------------------ */

  env.btnAddText.addEventListener('click', () => {
    env.textPlaceMode = !env.textPlaceMode;
    env.btnAddText.classList.toggle('active', env.textPlaceMode);
    env.overlay.classList.toggle('text-place-mode', env.textPlaceMode);
  });

  /* ------------------------------------------------------------------ */
  /*  Keyboard shortcut: Escape cancels bridge mode or text-place mode   */
  /* ------------------------------------------------------------------ */

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (env.bridgePending) {
        const prevEl = document.getElementById('box-' + env.bridgePending.boxId);
        if (prevEl) prevEl.style.outline = '';
        env.bridgePending = null;
      }
      if (env.textPlaceMode) {
        env.textPlaceMode = false;
        env.btnAddText.classList.remove('active');
        env.overlay.classList.remove('text-place-mode');
      }
    }
  });

  return {};
};
