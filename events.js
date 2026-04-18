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

  function clearPendingBridge() {
    if (!env.bridgePending) return;
    const prevEl = document.getElementById('box-' + env.bridgePending.boxId);
    if (prevEl) prevEl.style.outline = '';
    env.bridgePending = null;
  }

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
    if (!e.ctrlKey && !e.shiftKey && !e.target.closest('.talent-box, .text-field')) {
      env.clearObjectSelection();
      clearPendingBridge();
    }

    if (e.target.closest('.talent-box')) return;
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
      clearPendingBridge();
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

  document.addEventListener('mousedown', (e) => {
    if (e.ctrlKey || e.shiftKey) return;
    if (!e.target.closest('.talent-box, .text-field')) {
      env.clearObjectSelection();
      clearPendingBridge();
    }
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
  /*  Rich-text helpers for all editable roots                           */
  /* ------------------------------------------------------------------ */

  let savedEditableRange = null;
  let savedEditableRoot = null;
  let savedEditableOffsets = null;

  function getEditableRoot(node) {
    let current = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current) {
      if (
        current.classList && (
          current.classList.contains('tf-input') ||
          current.classList.contains('box-name') ||
          current.classList.contains('box-description') ||
          current.classList.contains('box-cost')
        )
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function cleanFontFamily(fontFamily) {
    return String(fontFamily || '')
      .replace(/^["']|["']$/g, '')
      .split(',')[0]
      .trim();
  }

  function getEditableContext(root) {
    if (!root || !root.isConnected) return null;

    if (root.classList.contains('tf-input')) {
      const tfEl = root.closest('[data-tf-id]');
      if (!tfEl) return null;
      const tfId = parseInt(tfEl.dataset.tfId, 10);
      const tf = env.textFields.find(t => t.id === tfId);
      if (!tf) return null;
      return { type: 'textField', root, tf };
    }

    const boxEl = root.closest('[data-box-id]');
    if (!boxEl) return null;
    const boxId = parseInt(boxEl.dataset.boxId, 10);
    const box = env.boxes.find(b => b.id === boxId);
    if (!box) return null;

    let field = 'description';
    if (root.classList.contains('box-name')) field = 'name';
    else if (root.classList.contains('box-cost')) field = 'cost';

    return { type: 'boxField', root, box, boxEl, field };
  }

  function getRangeOffsets(root, range) {
    const startRange = document.createRange();
    startRange.selectNodeContents(root);
    startRange.setEnd(range.startContainer, range.startOffset);

    const endRange = document.createRange();
    endRange.selectNodeContents(root);
    endRange.setEnd(range.endContainer, range.endOffset);

    return {
      start: startRange.toString().length,
      end: endRange.toString().length,
    };
  }

  function resolveOffsetPosition(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let current = walker.nextNode();
    let lastText = null;

    while (current) {
      lastText = current;
      const length = current.textContent.length;
      if (remaining <= length) {
        return { container: current, offset: remaining };
      }
      remaining -= length;
      current = walker.nextNode();
    }

    if (lastText) {
      return { container: lastText, offset: lastText.textContent.length };
    }

    return { container: root, offset: root.childNodes.length };
  }

  function buildRangeFromOffsets(root, offsets) {
    if (!root || !offsets) return null;
    const startPos = resolveOffsetPosition(root, offsets.start);
    const endPos = resolveOffsetPosition(root, offsets.end);
    const range = document.createRange();
    range.setStart(startPos.container, startPos.offset);
    range.setEnd(endPos.container, endPos.offset);
    return range;
  }

  function syncRootStyleToModel(context) {
    const root = context.root;
    const computed = window.getComputedStyle(root);
    const fontFamily = cleanFontFamily(root.style.fontFamily || computed.fontFamily);
    const fontSize = parseInt(root.style.fontSize || computed.fontSize, 10);
    const fontWeight = root.style.fontWeight || computed.fontWeight;
    const fontStyle = root.style.fontStyle || computed.fontStyle;
    const textDecorationLine = root.style.textDecorationLine || computed.textDecorationLine;
    const color = root.style.color || null;
    const bold = fontWeight === 'bold' || (!isNaN(parseInt(fontWeight, 10)) && parseInt(fontWeight, 10) >= 600);
    const italic = fontStyle === 'italic';
    const underline = String(textDecorationLine).includes('underline');

    if (context.type === 'textField') {
      context.tf.font = fontFamily || context.tf.font;
      if (!isNaN(fontSize)) context.tf.fontSize = fontSize;
      context.tf.bold = bold;
      context.tf.italic = italic;
      context.tf.underline = underline;
      context.tf.fontColor = color;
      return;
    }

    const prefix = context.field === 'name'
      ? 'name'
      : (context.field === 'cost' ? 'cost' : 'description');

    context.box[`${prefix}Font`] = fontFamily || context.box[`${prefix}Font`];
    if (!isNaN(fontSize)) context.box[`${prefix}FontSize`] = fontSize;
    context.box[`${prefix}Bold`] = bold;
    context.box[`${prefix}Italic`] = italic;
    context.box[`${prefix}Underline`] = underline;
    context.box[`${prefix}Color`] = color;
  }

  function persistEditableContext(context, syncRootStyles) {
    if (!context) return;

    if (context.type === 'textField') {
      context.tf.text = context.root.innerHTML;
      if (syncRootStyles) syncRootStyleToModel(context);
      context.root.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (context.field === 'name') context.box.name = context.root.innerHTML;
    else if (context.field === 'cost') context.box.cost = context.root.innerHTML;
    else context.box.description = context.root.innerHTML;

    if (syncRootStyles) syncRootStyleToModel(context);

    if (context.field === 'cost') {
      const costFs = context.box.costFontSize || 13;
      const triSize = Math.max(45, costFs * 3.2 + 4);
      context.boxEl.style.setProperty('--tri-size', triSize + 'px');
    }

    env.growBoxToFit(context.box, context.boxEl, context.box.h);
    env.autoSave();
  }

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const root = getEditableRoot(sel.anchorNode);
    if (!root) return;
    const range = sel.getRangeAt(0);
    savedEditableRange = range.cloneRange();
    savedEditableRoot = root;
    savedEditableOffsets = getRangeOffsets(root, range);
  });

  document.addEventListener('focusin', (e) => {
    const root = getEditableRoot(e.target);
    if (root && savedEditableRoot && root !== savedEditableRoot) {
      savedEditableRange = null;
      savedEditableRoot = null;
      savedEditableOffsets = null;
    }
  });

  function withEditableSelection(fn) {
    const root = getEditableRoot(document.activeElement) || savedEditableRoot;
    if (!root || !root.isConnected) return false;

    const context = getEditableContext(root);
    if (!context) return false;

    const hasSelection = !!(
      savedEditableRoot === root &&
      savedEditableOffsets &&
      savedEditableOffsets.end > savedEditableOffsets.start
    );
    fn(context, hasSelection);

    return true;
  }

  function updateSavedSelection(range, root) {
    if (!range || !root) return;
    savedEditableRange = range.cloneRange();
    savedEditableRoot = root;
    savedEditableOffsets = getRangeOffsets(root, range);
    env.storePersistentSelection(savedEditableRange, savedEditableRoot);
  }

  function restoreLiveSelection(context) {
    if (!savedEditableOffsets || savedEditableRoot !== context.root) return false;
    const selection = window.getSelection();
    if (!selection) return false;

    const liveRange = buildRangeFromOffsets(context.root, savedEditableOffsets);
    if (!liveRange) return false;
    selection.removeAllRanges();
    selection.addRange(liveRange);
    return true;
  }

  function applyCommandToSavedSelection(context, command, value) {
    if (!restoreLiveSelection(context)) return false;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, value);

    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      updateSavedSelection(selection.getRangeAt(0), context.root);
    }
    persistEditableContext(context, false);
    return true;
  }

  function unwrapElement(node) {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node);
    }
    parent.removeChild(node);
  }

  function normalizeFragmentForStyles(fragment, styleMap) {
    const props = Object.keys(styleMap);
    const elements = [];
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();

    while (current) {
      elements.push(current);
      current = walker.nextNode();
    }

    elements.reverse().forEach(node => {
      if (!(node instanceof HTMLElement)) return;

      if (props.includes('fontFamily')) {
        node.style.removeProperty('font-family');
        if (node.tagName === 'FONT') node.removeAttribute('face');
      }
      if (props.includes('fontSize')) {
        node.style.removeProperty('font-size');
        if (node.tagName === 'FONT') node.removeAttribute('size');
      }
      if (props.includes('color')) {
        node.style.removeProperty('color');
        if (node.tagName === 'FONT') node.removeAttribute('color');
      }
      if (props.includes('fontWeight')) {
        node.style.removeProperty('font-weight');
      }
      if (props.includes('fontStyle')) {
        node.style.removeProperty('font-style');
      }
      if (props.includes('textDecoration')) {
        node.style.removeProperty('text-decoration');
        node.style.removeProperty('text-decoration-line');
      }

      if (props.includes('fontWeight') && /^(B|STRONG)$/.test(node.tagName)) {
        unwrapElement(node);
        return;
      }
      if (props.includes('fontStyle') && /^(I|EM)$/.test(node.tagName)) {
        unwrapElement(node);
        return;
      }
      if (props.includes('textDecoration') && node.tagName === 'U') {
        unwrapElement(node);
        return;
      }
      if ((props.includes('fontFamily') || props.includes('fontSize') || props.includes('color')) && node.tagName === 'FONT') {
        unwrapElement(node);
      }
    });
  }

  function applyInlineStyleToSavedSelection(context, styleMap) {
    if (!restoreLiveSelection(context)) return false;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return false;

    const fragment = range.extractContents();
    normalizeFragmentForStyles(fragment, styleMap);
    const span = document.createElement('span');
    Object.entries(styleMap).forEach(([key, value]) => {
      span.style[key] = value;
    });
    span.appendChild(fragment);
    range.insertNode(span);

    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(newRange);
    updateSavedSelection(newRange, context.root);
    persistEditableContext(context, false);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /*  Font family — focused element only                                 */
  /* ------------------------------------------------------------------ */

  env.fontSelect.addEventListener('change', () => {
    const font = env.fontSelect.value;

    const applied = withEditableSelection((context, hasSelection) => {
      if (hasSelection) {
        applyInlineStyleToSavedSelection(context, { fontFamily: font });
        return;
      }

      context.root.style.fontFamily = font;
      persistEditableContext(context, true);
    });
    if (!applied) {
      env.globalFont = font;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Font size — focused element only                                    */
  /* ------------------------------------------------------------------ */

  function handleFontSizeInput() {
    const val = parseInt(env.fontSizeInput.value, 10);
    if (isNaN(val) || val < 6) { return; }
    const size = Math.max(6, Math.min(72, val));
    env.fontSizeInput.value = size;

    const applied = withEditableSelection((context, hasSelection) => {
      if (hasSelection) {
        applyInlineStyleToSavedSelection(context, { fontSize: size + 'px' });
        return;
      }

      context.root.style.fontSize = size + 'px';
      persistEditableContext(context, true);
    });
    if (!applied) {
      env.globalFontSize = size;
    }
  }

  env.fontSizeInput.addEventListener('input', handleFontSizeInput);
  env.fontSizeInput.addEventListener('change', handleFontSizeInput);

  /* ------------------------------------------------------------------ */
  /*  Bold button (mousedown to preserve selection)                      */
  /* ------------------------------------------------------------------ */

  env.fontBoldBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();   // keep focus / selection in contenteditable

    withEditableSelection((context, hasSelection) => {
      if (hasSelection) {
        const nextBold = !env.fontBoldBtn.classList.contains('active');
        applyInlineStyleToSavedSelection(context, { fontWeight: nextBold ? 'bold' : 'normal' });
        env.fontBoldBtn.classList.toggle('active', nextBold);
        return;
      }

      const weight = context.root.style.fontWeight || window.getComputedStyle(context.root).fontWeight;
      const isBold = weight === 'bold' || (!isNaN(parseInt(weight, 10)) && parseInt(weight, 10) >= 600);
      const nextBold = !isBold;
      context.root.style.fontWeight = nextBold ? 'bold' : 'normal';
      env.fontBoldBtn.classList.toggle('active', nextBold);
      persistEditableContext(context, true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Italic button                                                       */
  /* ------------------------------------------------------------------ */

  env.fontItalicBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();

    withEditableSelection((context, hasSelection) => {
      if (hasSelection) {
        const nextItalic = !env.fontItalicBtn.classList.contains('active');
        applyInlineStyleToSavedSelection(context, { fontStyle: nextItalic ? 'italic' : 'normal' });
        env.fontItalicBtn.classList.toggle('active', nextItalic);
        return;
      }

      const isItalic = (context.root.style.fontStyle || window.getComputedStyle(context.root).fontStyle) === 'italic';
      const nextItalic = !isItalic;
      context.root.style.fontStyle = nextItalic ? 'italic' : 'normal';
      env.fontItalicBtn.classList.toggle('active', nextItalic);
      persistEditableContext(context, true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Underline button                                                   */
  /* ------------------------------------------------------------------ */

  env.fontUnderlineBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();

    withEditableSelection((context, hasSelection) => {
      if (hasSelection) {
        const nextUnderline = !env.fontUnderlineBtn.classList.contains('active');
        applyInlineStyleToSavedSelection(context, { textDecoration: nextUnderline ? 'underline' : 'none' });
        env.fontUnderlineBtn.classList.toggle('active', nextUnderline);
        return;
      }

      const isUnderlined = (context.root.style.textDecorationLine || window.getComputedStyle(context.root).textDecorationLine).includes('underline');
      const nextUnderline = !isUnderlined;
      context.root.style.textDecoration = nextUnderline ? 'underline' : 'none';
      env.fontUnderlineBtn.classList.toggle('active', nextUnderline);
      persistEditableContext(context, true);
    });
  });

  env.colorFont.addEventListener('input', () => {
    const color = env.colorFont.value;
    const applied = withEditableSelection((context, hasSelection) => {
      if (hasSelection) {
        applyInlineStyleToSavedSelection(context, { color });
        return;
      }

      context.root.style.color = color;
      persistEditableContext(context, true);
    });

    if (!applied) {
      env.globalFontColor = color;
    }
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
  /*  Canvas zoom — Ctrl+Scroll on the page area (not browser zoom)      */
  /* ------------------------------------------------------------------ */

  const pageWrapper = env.pageWrapper;
  pageWrapper.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();

    const oldScale  = env.currentScale;
    const pcRect    = env.pageContainer.getBoundingClientRect();
    // Cursor position in page (A1) coordinates before zoom
    const curPageX  = (e.clientX - pcRect.left) / oldScale;
    const curPageY  = (e.clientY - pcRect.top)  / oldScale;

    const factor = e.deltaY < 0 ? 1.12 : (1 / 1.12);
    env.canvasZoom = env.canvasZoom * factor;
    env.fitToWindow();

    // Scroll so the page point under the cursor stays under the cursor
    const newPcRect = env.pageContainer.getBoundingClientRect();
    const newScale  = env.currentScale;
    window.scrollBy(
      (curPageX * newScale + newPcRect.left) - e.clientX,
      (curPageY * newScale + newPcRect.top)  - e.clientY
    );
  }, { passive: false });

  // Also intercept Ctrl+Wheel on twoCanvas and overlay
  [env.twoCanvas, env.overlay].forEach(el => {
    el.addEventListener('wheel', (e) => {
      if (e.ctrlKey) { e.stopPropagation(); }
    }, { passive: false });
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
    const accel = e.ctrlKey || e.metaKey;

    if (accel && e.key.toLowerCase() === 'c' && (env.isBoxSelected?.(env.focusedBoxId) || env.hasObjectSelection?.() || env.copyCurrentSelection)) {
      if (env.copyCurrentSelection()) {
        e.preventDefault();
        return;
      }
    }

    if (accel && e.key.toLowerCase() === 'v') {
      if (env.pasteClipboard()) {
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const target = e.target;
      const isEditing = !!(target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName)));
      if (!isEditing && env.deleteCurrentSelection()) {
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'Escape') {
      clearPendingBridge();
      if (env.textPlaceMode) {
        env.textPlaceMode = false;
        env.btnAddText.classList.remove('active');
        env.overlay.classList.remove('text-place-mode');
      }
      env.clearObjectSelection();
    }
  });

  return {};
};
