/**
 * Talent Sheet Generator — app.js
 *
 * Main application controller: page layout, grid, bridging lines,
 * side-connector UI, JSON persistence, and module wiring.
 *
 * Box creation, rendering, events, and removal live in box.js
 * (loaded via window.createBoxModule).
 * PDF export lives in pdf-export.js (loaded via window.createPdfExportModule).
 * Event listeners and toolbar wiring live in events.js
 * (loaded via window.createEventsModule).
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Constants                                                          */
  /* ------------------------------------------------------------------ */

  const A1_WIDTH  = 2245;   // px  (≈ 594 mm at 96 dpi)
  const A1_HEIGHT = 3178;   // px  (≈ 841 mm at 96 dpi)

  // Current page height in A1 space (may grow when boxes overflow)
  let pageHeight = A1_HEIGHT;

  // Grid settings — boxes snap to a grid (all coords in A1 space)
  const PAGE_MARGIN   = 40;                              // px margin inside A1 page
  let   boxW          = 200;                             // customizable box width
  let   boxH          = 140;                             // customizable box height
  const DEFAULT_BOX_H = 140;
  const HEADER_HEIGHT = 90;                              // px reserved for header/legend row
  const GRID_TOP      = PAGE_MARGIN + HEADER_HEIGHT;     // y where box grid starts

  let bridgeWidth     = 2.5;                             // bridge line width

  // Snap-to-center alignment threshold (px in A1 space)
  const SNAP_THRESHOLD = 15;

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  let boxes     = [];   // { id, x, y, w, h, name, description, cost, acquired, ranked, font, strokeColor, fillColor }
  let bridges   = [];   // { id, fromId, toId, fromSide, toSide }
  let textFields = [];  // { id, x, y, text, font, fontSize, fontWeight, width }
  let nextBoxId = 1;
  let nextBridgeId = 1;
  let nextTextFieldId = 1;

  let bridgePending   = null;  // { boxId, side } — first half of a bridge connection
  let textPlaceMode   = false; // when true, next click on page places a text field
  let globalFont      = 'sans-serif';
  let globalFontSize  = 13;
  let globalBold      = false;
  let globalItalic    = false;
  let globalStroke    = '#444444';
  let globalFill      = '#f5f0e1';
  let bridgeColor     = '#666666';
  let darkMode        = false;
  let focusedBoxId    = null;   // id of the box that currently has focus
  let focusedCostBoxId = null;  // id of box whose cost field has focus (or null)
  let focusedTextFieldId = null; // id of the text field that currently has focus
  let lastFocusedInput   = null; // last textarea/contenteditable that had focus
  let legendPos       = { x: -1, y: 42 }; // -1 means "right-anchored at 50px"

  /* ------------------------------------------------------------------ */
  /*  DOM refs                                                           */
  /* ------------------------------------------------------------------ */

  const pageWrapper   = document.getElementById('page-wrapper');
  const pageContainer = document.getElementById('page-container');
  const twoCanvas     = document.getElementById('two-canvas');
  const overlay       = document.getElementById('overlay');

  let currentScale    = 1;  // CSS scale factor for fit-to-window

  const btnAddBox     = document.getElementById('btn-add-box');
  const addTalentMenu = document.getElementById('add-talent-menu');
  const btnTheme      = document.getElementById('btn-toggle-theme');
  const btnAddText    = document.getElementById('btn-add-text');
  const btnSave       = document.getElementById('btn-save');
  const btnLoad       = document.getElementById('btn-load');
  const btnExportPdf  = document.getElementById('btn-export-pdf');
  const fileInput     = document.getElementById('file-input');
  const fontSelect    = document.getElementById('font-select');
  const colorStroke   = document.getElementById('color-stroke');
  const colorFill     = document.getElementById('color-fill');
  const colorBridge   = document.getElementById('color-bridge');
  const boxWInput     = document.getElementById('box-w-input');
  const boxHInput     = document.getElementById('box-h-input');
  const bridgeWInput  = document.getElementById('bridge-w-input');
  const fontSizeInput = document.getElementById('font-size-input');
  const fontBoldInput = document.getElementById('font-bold-input');
  const fontItalicInput = document.getElementById('font-italic-input');
  const btnInsertSymbol  = document.getElementById('btn-insert-symbol');
  const insertSymbolMenu = document.getElementById('insert-symbol-menu');
  const sheetLegend   = document.getElementById('sheet-legend');

  /* Title text-field id — the first text field auto-created acts as the title */
  let titleTextFieldId = null;

  /* ------------------------------------------------------------------ */
  /*  Two.js setup                                                       */
  /* ------------------------------------------------------------------ */

  const two = new Two({
    type: Two.Types.svg,
    width: A1_WIDTH,
    height: A1_HEIGHT,
  }).appendTo(twoCanvas);

  // Maps: boxId → Two.Path (the chamfered rect), bridgeId → Two.Line
  const twoBoxShapes    = {};
  const twoBridgeLines  = {};
  let marginShapes      = [];    // Two.js shapes for page-margin dashes

  /* ------------------------------------------------------------------ */
  /*  Fit page to browser window width                                   */
  /* ------------------------------------------------------------------ */

  function fitToWindow() {
    const WINDOW_W = window.innerWidth;
    // Scale so A1 page fits within the window; never upscale past 1
    currentScale = Math.min(1, WINDOW_W / A1_WIDTH);

    const visW = Math.round(A1_WIDTH * currentScale);
    const visH = Math.round(pageHeight * currentScale);

    // Size the page container to the *visual* size (no CSS transform on it)
    pageContainer.style.width     = visW + 'px';
    pageContainer.style.minHeight = visH + 'px';

    // SVG viewBox lets Two.js keep drawing in A1-space; the browser
    // scales the SVG to the visual size natively.
    const svgEl = two.renderer.domElement;
    svgEl.setAttribute('viewBox', `0 0 ${A1_WIDTH} ${pageHeight}`);
    svgEl.setAttribute('width',  visW);
    svgEl.setAttribute('height', visH);
    svgEl.style.width  = visW + 'px';
    svgEl.style.height = visH + 'px';

    // The HTML overlay lives in A1-space and is scaled with CSS transform
    overlay.style.width  = A1_WIDTH + 'px';
    overlay.style.height = pageHeight + 'px';
    overlay.style.transform = `scale(${currentScale})`;
    overlay.style.transformOrigin = 'top left';

    // Wrapper takes the visual size so scrollbars work correctly.
    // If window is narrower than A1 at scale=1 we already shrink;
    // if scale would be > 1 we capped it, so horizontal scroll appears
    // only when the browser is very narrow (objects too big).
    pageWrapper.style.width  = visW + 'px';
    pageWrapper.style.height = (visH + 40) + 'px';
    pageWrapper.style.margin = '0 auto';

    // Allow horizontal scroll when objects are larger than viewport
    pageWrapper.style.overflowX = visW > WINDOW_W ? 'auto' : 'hidden';
  }

  /* ------------------------------------------------------------------ */
  /*  Draw dashed margin lines on the page                               */
  /* ------------------------------------------------------------------ */

  /** Draw dashed margin lines on the page */
  function drawPageMargins() {
    // Remove old margin shapes
    marginShapes.forEach(s => two.remove(s));
    marginShapes = [];

    const m  = PAGE_MARGIN;
    const pw = A1_WIDTH;
    const ph = pageHeight;

    const color = darkMode ? '#555' : '#aaa';
    const lines = [
      [m, m, pw - m, m],           // top
      [m, m, m, ph - m],           // left
      [pw - m, m, pw - m, ph - m], // right
      [m, ph - m, pw - m, ph - m], // bottom
    ];

    lines.forEach(([x1,y1,x2,y2]) => {
      const line = two.makeLine(x1, y1, x2, y2);
      line.stroke    = color;
      line.linewidth  = 1;
      line.dashes     = [10, 6];
      marginShapes.push(line);
    });

    // Draw a thin separator below header area
    const sep = two.makeLine(m, GRID_TOP - 8, pw - m, GRID_TOP - 8);
    sep.stroke    = color;
    sep.linewidth = 0.8;
    sep.dashes    = [6, 4];
    marginShapes.push(sep);

    two.update();
  }

  /* ------------------------------------------------------------------ */
  /*  Snap-to-center alignment guides                                    */
  /* ------------------------------------------------------------------ */

  let snapGuideH = null;
  let snapGuideV = null;

  function showSnapGuides(vx, hy) {
    if (vx != null) {
      if (!snapGuideV) {
        snapGuideV = document.createElement('div');
        snapGuideV.className = 'snap-guide-v';
        overlay.appendChild(snapGuideV);
      }
      snapGuideV.style.left = vx + 'px';
      snapGuideV.style.display = '';
    } else if (snapGuideV) {
      snapGuideV.style.display = 'none';
    }

    if (hy != null) {
      if (!snapGuideH) {
        snapGuideH = document.createElement('div');
        snapGuideH.className = 'snap-guide-h';
        overlay.appendChild(snapGuideH);
      }
      snapGuideH.style.top = hy + 'px';
      snapGuideH.style.display = '';
    } else if (snapGuideH) {
      snapGuideH.style.display = 'none';
    }
  }

  function hideSnapGuides() {
    if (snapGuideV) snapGuideV.style.display = 'none';
    if (snapGuideH) snapGuideH.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /*  Box module initialisation  (box.js)                                */
  /* ------------------------------------------------------------------ */

  const boxEnv = {
    two,
    twoBoxShapes,
    twoBridgeLines,
    overlay,
    get boxes()          { return boxes; },
    set boxes(v)         { boxes = v; },
    get bridges()        { return bridges; },
    set bridges(v)       { bridges = v; },
    get nextBoxId()      { return nextBoxId; },
    set nextBoxId(v)     { nextBoxId = v; },
    get darkMode()       { return darkMode; },
    get boxW()           { return boxW; },
    get boxH()           { return boxH; },
    get globalFont()     { return globalFont; },
    get globalFontSize() { return globalFontSize; },
    get globalStroke()   { return globalStroke; },
    get globalFill()     { return globalFill; },
    get currentScale()   { return currentScale; },
    get focusedBoxId()   { return focusedBoxId; },
    set focusedBoxId(v)  { focusedBoxId = v; },
    get focusedCostBoxId()  { return focusedCostBoxId; },
    set focusedCostBoxId(v) { focusedCostBoxId = v; },
    set focusedTextFieldId(v) { focusedTextFieldId = v; },
    onBoxFocus(box, isCostFocus) {
      fontSelect.disabled     = false;
      fontSizeInput.disabled  = false;
      fontBoldInput.disabled  = false;
      fontItalicInput.disabled = false;
      if (isCostFocus) {
        fontSelect.value      = box.costFont || box.font || globalFont;
        fontSizeInput.value   = box.costFontSize || 13;
      } else {
        fontSelect.value      = box.font  || globalFont;
        fontSizeInput.value   = box.fontSize || globalFontSize;
      }
      fontBoldInput.checked = !!(box.bold);
      fontItalicInput.checked = !!(box.italic);
    },
    onBoxBlur() {
      focusedCostBoxId = null;
      fontSelect.disabled     = true;
      fontSizeInput.disabled  = true;
      fontBoldInput.disabled  = true;
      fontItalicInput.disabled = true;
      fontSelect.value      = globalFont;
      fontSizeInput.value   = globalFontSize;
      fontBoldInput.checked = globalBold;
      fontItalicInput.checked = globalItalic;
    },
    CHAMFER_PCT:  0.20,
    darken,
    lighten,
    escHtml,
    SNAP_THRESHOLD,
    showSnapGuides,
    hideSnapGuides,
    reconcileAllBridges,
    updateBridgesFor,
    expandPage,
    autoSave() { autoSave(); },
    clearSideConnector,
  };

  const {
    createBox, renderBox, updateBoxShape, growBoxToFit,
    removeBox, findFreePosition, makeChamferedRect, chamfer,
  } = window.createBoxModule(boxEnv);

  /* ------------------------------------------------------------------ */
  /*  Bridge (connecting) lines                                          */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /*  Side-connector helpers                                             */
  /* ------------------------------------------------------------------ */

  /** Return the anchor point on the given side of a box */
  function sideAnchor(box, side) {
    switch (side) {
      case 'top':    return [box.x + box.w / 2, box.y];
      case 'bottom': return [box.x + box.w / 2, box.y + box.h];
      case 'left':   return [box.x,             box.y + box.h / 2];
      case 'right':  return [box.x + box.w,     box.y + box.h / 2];
    }
    return [box.x + box.w / 2, box.y + box.h / 2];
  }

  /** Detect which side the mouse is nearest to, with extended detection outside the box */
  function detectSideExtended(box, px, py) {
    const pad = 24;   // px detection band OUTSIDE each edge
    const inner = 18; // px detection band INSIDE each edge

    // Check if point is within the extended bounding box
    if (px < box.x - pad || px > box.x + box.w + pad ||
        py < box.y - pad || py > box.y + box.h + pad) {
      return null;
    }

    // Distances to each edge (negative = outside the box on that side)
    const dTop    = py - box.y;
    const dBottom = (box.y + box.h) - py;
    const dLeft   = px - box.x;
    const dRight  = (box.x + box.w) - px;

    // For each side, check if we're within the detection band
    const sides = [];
    if (dTop >= -pad && dTop <= inner)       sides.push({ side: 'top',    dist: Math.abs(dTop) });
    if (dBottom >= -pad && dBottom <= inner)  sides.push({ side: 'bottom', dist: Math.abs(dBottom) });
    if (dLeft >= -pad && dLeft <= inner)      sides.push({ side: 'left',   dist: Math.abs(dLeft) });
    if (dRight >= -pad && dRight <= inner)    sides.push({ side: 'right',  dist: Math.abs(dRight) });

    if (sides.length === 0) return null;
    sides.sort((a, b) => a.dist - b.dist);
    return sides[0].side;
  }

  /* Per-box side-connector hover shapes (Two.js half-circles) */
  const sideConnectorShapes = {};   // boxId → Two.Path | null
  let hoveredBoxId = null;
  let hoveredSide  = null;

  function clearSideConnector(boxId) {
    if (sideConnectorShapes[boxId]) {
      two.remove(sideConnectorShapes[boxId]);
      sideConnectorShapes[boxId] = null;
      two.update();
    }
  }

  function clearAllSideConnectors() {
    if (hoveredBoxId != null) {
      clearSideConnector(hoveredBoxId);
      hoveredBoxId = null;
      hoveredSide  = null;
    }
  }

  function drawSideConnector(box, side) {
    clearSideConnector(box.id);
    const r = 12;
    const [cx, cy] = sideAnchor(box, side);

    // Build a half-circle arc on the OUTSIDE of the given side
    const pts = [];
    const n = 16;
    let startA, endA;
    switch (side) {
      case 'top':    startA = Math.PI;  endA = 0;           break;
      case 'bottom': startA = -Math.PI;  endA = 0;     break;
      case 'left':   startA = Math.PI/2;  endA = 3*Math.PI/2; break;
      case 'right':  startA = -Math.PI/2; endA = Math.PI/2;  break;
    }
    for (let i = 0; i <= n; i++) {
      const t = startA + (endA - startA) * (i / n);
      pts.push(new Two.Anchor(cx + r * Math.cos(t), cy - r * Math.sin(t)));
    }

    const path = two.makePath(pts, false);
    path.closed    = true;
    path.curved    = false;
    path.automatic = false;
    path.fill      = 'rgba(74,144,217,0.35)';
    path.stroke    = '#4a90d9';
    path.linewidth = 1.5;

    sideConnectorShapes[box.id] = path;
    two.update();
  }

  /** Check whether two sides can validly form a bridge (face each other) */
  function sidesCanConnect(fromBox, fromSide, toBox, toSide) {
    // Opposite side pairs: right↔left, top↔bottom
    const horiz = (fromSide === 'right' && toSide === 'left') ||
                  (fromSide === 'left'  && toSide === 'right');
    const vert  = (fromSide === 'bottom' && toSide === 'top') ||
                  (fromSide === 'top'    && toSide === 'bottom');

    if (!horiz && !vert) return false;  // same orientation sides can't connect

    if (horiz) {
      // The 'right' box must actually be to the right of the 'left' box
      if (fromSide === 'right' && (fromBox.x + fromBox.w) > (toBox.x + toBox.w)) return false;
      if (fromSide === 'left'  && fromBox.x < toBox.x) return false;
    }
    if (vert) {
      // The 'bottom' box must actually be above the 'top' box
      if (fromSide === 'bottom' && (fromBox.y + fromBox.h) > (toBox.y + toBox.h)) return false;
      if (fromSide === 'top'    && fromBox.y < toBox.y) return false;
    }
    return true;
  }



  /* ------------------------------------------------------------------ */
  /*  Bridge (connecting) lines                                          */
  /* ------------------------------------------------------------------ */

  function createBridge(data) {
    const bridge = Object.assign({
      id: nextBridgeId++,
      fromSide: 'right',
      toSide: 'left',
    }, data);

    if (data && data.id && data.id >= nextBridgeId) {
      nextBridgeId = data.id + 1;
    }

    bridges.push(bridge);
    renderBridge(bridge);
    return bridge;
  }

  function renderBridge(bridge) {
    const fromBox = boxes.find(b => b.id === bridge.fromId);
    const toBox   = boxes.find(b => b.id === bridge.toId);
    if (!fromBox || !toBox) return;

    if (twoBridgeLines[bridge.id]) {
      two.remove(twoBridgeLines[bridge.id]);
    }

    const [x1, y1] = sideAnchor(fromBox, bridge.fromSide || 'right');
    const [x2, y2] = sideAnchor(toBox,   bridge.toSide   || 'left');

    const color = darkMode ? lighten(bridgeColor) : bridgeColor;

    const line = two.makeLine(x1, y1, x2, y2);
    line.stroke   = color;
    line.linewidth = bridgeWidth;

    twoBridgeLines[bridge.id] = line;
    two.update();
  }

  function updateBridgesFor(boxId) {
    bridges.forEach(b => {
      if (b.fromId === boxId || b.toId === boxId) {
        renderBridge(b);
      }
    });
  }



  function pointNearLine(px, py, x1, y1, x2, y2, threshold) {
    const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;
    param = Math.max(0, Math.min(1, param));
    const xx = x1 + param * C;
    const yy = y1 + param * D;
    const dist = Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
    return dist < threshold;
  }

  function removeBridge(id) {
    if (twoBridgeLines[id]) {
      two.remove(twoBridgeLines[id]);
      delete twoBridgeLines[id];
    }
    bridges = bridges.filter(b => b.id !== id);
    two.update();
    autoSave();
  }

  /* ------------------------------------------------------------------ */
  /*  Reconcile bridge sides based on relative box positions              */
  /*  Auto-determines the best from/to sides. Removes orphaned bridges.  */
  /* ------------------------------------------------------------------ */

  function reconcileAllBridges() {
    const toRemove = [];

    bridges.forEach(bridge => {
      const a  = boxes.find(b => b.id === bridge.fromId);
      const b2 = boxes.find(b => b.id === bridge.toId);
      if (!a || !b2) { toRemove.push(bridge.id); return; }

      // Determine best connection sides based on relative center positions
      const aCx = a.x + a.w / 2, aCy = a.y + a.h / 2;
      const bCx = b2.x + b2.w / 2, bCy = b2.y + b2.h / 2;
      const dx = bCx - aCx;
      const dy = bCy - aCy;

      if (Math.abs(dx) >= Math.abs(dy)) {
        // More horizontal separation → use left/right
        if (dx >= 0) {
          bridge.fromSide = 'right';
          bridge.toSide   = 'left';
        } else {
          bridge.fromSide = 'left';
          bridge.toSide   = 'right';
        }
      } else {
        // More vertical separation → use top/bottom
        if (dy >= 0) {
          bridge.fromSide = 'bottom';
          bridge.toSide   = 'top';
        } else {
          bridge.fromSide = 'top';
          bridge.toSide   = 'bottom';
        }
      }
      renderBridge(bridge);
    });

    toRemove.forEach(id => removeBridge(id));
  }

  /* ------------------------------------------------------------------ */
  /*  Expand page height if boxes overflow                               */
  /* ------------------------------------------------------------------ */

  function expandPage() {
    let maxY = A1_HEIGHT;
    boxes.forEach(b => {
      const bottom = b.y + b.h + PAGE_MARGIN;
      if (bottom > maxY) maxY = bottom;
    });
    pageHeight = maxY;
    fitToWindow();      // re-applies sizes & viewBox with new pageHeight
    drawPageMargins();
  }

  /* ------------------------------------------------------------------ */
  /*  Color helpers for dark mode                                        */
  /* ------------------------------------------------------------------ */

  function darken(hex) {
    return adjustBrightness(hex, -140);
  }

  function lighten(hex) {
    return adjustBrightness(hex, 100);
  }

  function adjustBrightness(hex, amount) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    let r = Math.max(0, Math.min(255, parseInt(hex.substring(0,2), 16) + amount));
    let g = Math.max(0, Math.min(255, parseInt(hex.substring(2,4), 16) + amount));
    let b = Math.max(0, Math.min(255, parseInt(hex.substring(4,6), 16) + amount));
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ------------------------------------------------------------------ */
  /*  Text field management                                              */
  /* ------------------------------------------------------------------ */

  function createTextField(data) {
    const tf = Object.assign({
      id:          nextTextFieldId++,
      x:           50,
      y:           42,
      text:        'Text',
      font:        globalFont,
      fontSize:    32,
      fontWeight:  'bold',
      bold:        true,
      italic:      false,
      width:       600,
    }, data);

    if (data && data.id && data.id >= nextTextFieldId) {
      nextTextFieldId = data.id + 1;
    }

    textFields.push(tf);
    renderTextField(tf);
    return tf;
  }

  function renderTextField(tf) {
    let el = document.getElementById('tf-' + tf.id);
    if (el) el.remove();

    el = document.createElement('div');
    el.className = 'text-field';
    el.id = 'tf-' + tf.id;
    el.style.left     = tf.x + 'px';
    el.style.top      = tf.y + 'px';
    el.style.width    = 'auto';
    el.dataset.tfId   = tf.id;

    const weight = tf.bold ? 'bold' : (tf.fontWeight === 'bold' ? 'bold' : 'normal');
    const fStyle = tf.italic ? 'italic' : 'normal';
    el.innerHTML = `
      <span class="tf-drag" title="Drag to move">⋮</span>
      <button class="tf-delete" title="Delete">&times;</button>
      <div class="tf-input" contenteditable="true" role="textbox" data-placeholder="Text…"
        style="font-family:${tf.font}; font-size:${tf.fontSize}px; font-weight:${weight}; font-style:${fStyle}"
      >${tf.text}</div>`;

    overlay.appendChild(el);
    bindTextFieldEvents(el, tf);
  }

  function bindTextFieldEvents(el, tf) {
    // Delete
    el.querySelector('.tf-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      removeTextField(tf.id);
    });

    // Text editing
    const input = el.querySelector('.tf-input');
    function autoSizeInput() {
      // Reset dimensions to measure natural size
      input.style.width  = '0';
      input.style.height = '0';
      const newW = Math.max(60, input.scrollWidth + 2);
      const newH = input.scrollHeight;
      input.style.width  = newW + 'px';
      input.style.height = newH + 'px';
      tf.width = newW;
    }
    autoSizeInput();
    input.addEventListener('input', () => {
      tf.text = input.innerHTML;
      autoSizeInput();
      autoSave();
    });

    // Focus tracking — update toolbar to show this field's font/size
    el.addEventListener('focusin', () => {
      focusedTextFieldId = tf.id;
      focusedBoxId = null;
      fontSelect.disabled     = false;
      fontSizeInput.disabled  = false;
      fontBoldInput.disabled  = false;
      fontItalicInput.disabled = false;
      fontSelect.value      = tf.font  || globalFont;
      fontSizeInput.value   = tf.fontSize || globalFontSize;
      fontBoldInput.checked = !!(tf.bold);
      fontItalicInput.checked = !!(tf.italic);
    });
    el.addEventListener('focusout', (e) => {
      if (!el.contains(e.relatedTarget)) {
        if (focusedTextFieldId === tf.id) {
          focusedTextFieldId = null;
          fontSelect.disabled     = true;
          fontSizeInput.disabled  = true;
          fontBoldInput.disabled  = true;
          fontItalicInput.disabled = true;
          fontSelect.value      = globalFont;
          fontSizeInput.value   = globalFontSize;
          fontBoldInput.checked = globalBold;
          fontItalicInput.checked = globalItalic;
        }
      }
    });

    // Drag — initiated from the drag handle only
    const dragHandle = el.querySelector('.tf-drag');
    let dragging = false, startMX, startMY, startX, startY;
    dragHandle.addEventListener('mousedown', (e) => {
      dragging = true;
      startMX = e.clientX;
      startMY = e.clientY;
      startX = tf.x;
      startY = tf.y;
      el.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startMX) / currentScale;
      const dy = (e.clientY - startMY) / currentScale;
      tf.x = Math.max(0, startX + dx);
      tf.y = Math.max(0, startY + dy);
      el.style.left = tf.x + 'px';
      el.style.top  = tf.y + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      autoSave();
    });
  }

  function removeTextField(id) {
    const el = document.getElementById('tf-' + id);
    if (el) el.remove();
    textFields = textFields.filter(t => t.id !== id);
    autoSave();
  }

  /* ------------------------------------------------------------------ */
  /*  Track the last-focused text input for symbol insertion             */
  /* ------------------------------------------------------------------ */

  overlay.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.isContentEditable) {
      lastFocusedInput = t;
      btnInsertSymbol.disabled = false;
    }
  });

  // Clear lastFocusedInput only when focus leaves to something outside
  // the insert-symbol button/menu (so clicking Dice doesn't disable itself)
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.closest('#insert-symbol-wrapper')) return;  // clicking Dice button/menu
    if (t.closest('#toolbar') && !t.isContentEditable) {
      // Focused a non-text toolbar control — clear last input
      if (!overlay.contains(t)) {
        lastFocusedInput = null;
        btnInsertSymbol.disabled = true;
      }
    }
  });

  overlay.addEventListener('focusout', (e) => {
    // If focus is going to the insert-symbol button/menu, keep lastFocusedInput
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active.closest('#insert-symbol-wrapper')) return;
      if (!overlay.contains(active) && lastFocusedInput) {
        lastFocusedInput = null;
        btnInsertSymbol.disabled = true;
      }
    }, 0);
  });

  /**
   * Insert a symbol (optionally colored/classed) at the caret in the
   * last-focused contentEditable element.
   * @param {string} text  – the character(s) to insert
   * @param {string} [color] – optional CSS color for the span
   * @param {string} [cls]   – optional CSS class(es) for the span
   */
  function insertAtCaret(text, color, cls) {
    const el = lastFocusedInput;
    if (!el) return;
    el.focus();
    if (el.isContentEditable) {
      const makeSpan = () => {
        const s = document.createElement('span');
        if (color) s.style.color = color;
        if (cls)   s.className = cls;
        s.textContent = text;
        return s;
      };
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = (color || cls) ? makeSpan() : document.createTextNode(text);
        range.insertNode(node);
        // Move caret after the inserted node
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        const node = (color || cls) ? makeSpan() : document.createTextNode(text);
        el.appendChild(node);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Apply font to legend                                               */
  /* ------------------------------------------------------------------ */

  function applyFontToLegend() {
    sheetLegend.style.fontFamily = globalFont;
  }

  /* ------------------------------------------------------------------ */
  /*  Legend drag setup                                                  */
  /* ------------------------------------------------------------------ */

  function positionLegend() {
    const el = sheetLegend;
    if (legendPos.x >= 0) {
      el.style.left  = legendPos.x + 'px';
      el.style.right = 'auto';
    } else {
      el.style.right = '50px';
      el.style.left  = 'auto';
    }
    el.style.top = legendPos.y + 'px';
  }

  let legendDragBound = false;
  function initLegendDrag() {
    positionLegend();
    if (legendDragBound) return;
    legendDragBound = true;

    const el = sheetLegend;
    el.style.cursor = 'grab';

    let dragging = false, startMX, startMY, startX, startY;
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('input')) return;
      dragging = true;
      startMX = e.clientX;
      startMY = e.clientY;
      const rect = el.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      startX = (rect.left - overlayRect.left) / currentScale;
      startY = (rect.top - overlayRect.top) / currentScale;
      // Switch to absolute left positioning
      el.style.left  = startX + 'px';
      el.style.right = 'auto';
      el.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startMX) / currentScale;
      const dy = (e.clientY - startMY) / currentScale;
      const nx = Math.max(0, startX + dx);
      const ny = Math.max(0, startY + dy);
      el.style.left = nx + 'px';
      el.style.top  = ny + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = 'grab';
      legendPos.x = parseInt(el.style.left, 10);
      legendPos.y = parseInt(el.style.top, 10);
      autoSave();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  JSON utilities module initialisation  (json-utils.js)              */
  /* ------------------------------------------------------------------ */

  const jsonEnv = {
    two,
    overlay,
    twoBoxShapes,
    twoBridgeLines,
    // DOM refs
    fontSelect,
    fontSizeInput,
    fontBoldInput,
    fontItalicInput,
    colorStroke,
    colorFill,
    colorBridge,
    boxWInput,
    boxHInput,
    bridgeWInput,
    // State getters / setters
    get boxes()              { return boxes; },
    set boxes(v)             { boxes = v; },
    get bridges()            { return bridges; },
    set bridges(v)           { bridges = v; },
    get textFields()         { return textFields; },
    set textFields(v)        { textFields = v; },
    get legendPos()          { return legendPos; },
    set legendPos(v)         { legendPos = v; },
    get globalFont()         { return globalFont; },
    set globalFont(v)        { globalFont = v; },
    get globalFontSize()     { return globalFontSize; },
    set globalFontSize(v)    { globalFontSize = v; },
    get globalBold()         { return globalBold; },
    set globalBold(v)        { globalBold = v; },
    get globalItalic()       { return globalItalic; },
    set globalItalic(v)      { globalItalic = v; },
    get globalStroke()       { return globalStroke; },
    set globalStroke(v)      { globalStroke = v; },
    get globalFill()         { return globalFill; },
    set globalFill(v)        { globalFill = v; },
    get bridgeColor()        { return bridgeColor; },
    set bridgeColor(v)       { bridgeColor = v; },
    get darkMode()           { return darkMode; },
    set darkMode(v)          { darkMode = v; },
    get boxW()               { return boxW; },
    set boxW(v)              { boxW = v; },
    get boxH()               { return boxH; },
    set boxH(v)              { boxH = v; },
    get bridgeWidth()        { return bridgeWidth; },
    set bridgeWidth(v)       { bridgeWidth = v; },
    get titleTextFieldId()   { return titleTextFieldId; },
    set titleTextFieldId(v)  { titleTextFieldId = v; },
    get nextTextFieldId()    { return nextTextFieldId; },
    set nextTextFieldId(v)   { nextTextFieldId = v; },
    get bridgePending()      { return bridgePending; },
    set bridgePending(v)     { bridgePending = v; },
    // Functions
    applyTheme,
    createBox,
    createBridge,
    createTextField,
    expandPage,
    positionLegend,
    applyFontToLegend,
    clearSideConnector,
  };

  const { buildJSON, downloadJSON, loadJSON, clearAll, autoSave, autoLoad } =
    window.createJsonUtilsModule(jsonEnv);

  /* ------------------------------------------------------------------ */
  /*  PDF Export module initialisation  (pdf-export.js)                   */
  /* ------------------------------------------------------------------ */

  const pdfEnv = {
    get A1_WIDTH()     { return A1_WIDTH; },
    get pageHeight()   { return pageHeight; },
    overlay,
    pageContainer,
    two,
    get currentScale() { return currentScale; },
    get boxes()        { return boxes; },
    get darkMode()     { return darkMode; },
    CHAMFER_PCT: 0.20,
    fitToWindow,
  };

  const { exportPDF } = window.createPdfExportModule(pdfEnv);

  /* ------------------------------------------------------------------ */
  /*  Theme                                                              */
  /* ------------------------------------------------------------------ */

  function applyTheme() {
    document.documentElement.dataset.theme = darkMode ? 'dark' : '';
    // Re-render all boxes & bridges with new colors
    boxes.forEach(b => updateBoxShape(b));
    bridges.forEach(b => renderBridge(b));
    drawPageMargins();
    two.update();
  }

  /* ------------------------------------------------------------------ */
  /*  Events module initialisation  (events.js)                          */
  /* ------------------------------------------------------------------ */

  const eventsEnv = {
    two,
    overlay,
    pageContainer,
    twoCanvas,
    // DOM refs
    btnAddBox,
    addTalentMenu,
    btnTheme,
    btnAddText,
    btnSave,
    btnLoad,
    btnExportPdf,
    fileInput,
    fontSelect,
    fontSizeInput,
    fontBoldInput,
    fontItalicInput,
    btnInsertSymbol,
    insertSymbolMenu,
    insertAtCaret,
    colorStroke,
    colorFill,
    colorBridge,
    boxWInput,
    boxHInput,
    bridgeWInput,
    sheetLegend,
    // State getters / setters
    get boxes()          { return boxes; },
    get bridges()        { return bridges; },
    get currentScale()   { return currentScale; },
    get darkMode()       { return darkMode; },
    set darkMode(v)      { darkMode = v; },
    get globalFont()     { return globalFont; },
    set globalFont(v)    { globalFont = v; },
    get globalFontSize() { return globalFontSize; },
    set globalFontSize(v){ globalFontSize = v; },
    get globalBold()     { return globalBold; },
    set globalBold(v)    { globalBold = v; },
    get globalItalic()   { return globalItalic; },
    set globalItalic(v)  { globalItalic = v; },
    get focusedBoxId()   { return focusedBoxId; },
    get focusedCostBoxId() { return focusedCostBoxId; },
    get globalStroke()   { return globalStroke; },
    set globalStroke(v)  { globalStroke = v; },
    get globalFill()     { return globalFill; },
    set globalFill(v)    { globalFill = v; },
    get bridgeColor()    { return bridgeColor; },
    set bridgeColor(v)   { bridgeColor = v; },
    get bridgePending()  { return bridgePending; },
    set bridgePending(v) { bridgePending = v; },
    get hoveredBoxId()   { return hoveredBoxId; },
    set hoveredBoxId(v)  { hoveredBoxId = v; },
    get hoveredSide()    { return hoveredSide; },
    set hoveredSide(v)   { hoveredSide = v; },
    get boxW()           { return boxW; },
    set boxW(v)          { boxW = v; },
    get boxH()           { return boxH; },
    set boxH(v)          { boxH = v; },
    get bridgeWidth()    { return bridgeWidth; },
    set bridgeWidth(v)   { bridgeWidth = v; },
    get textPlaceMode()  { return textPlaceMode; },
    set textPlaceMode(v) { textPlaceMode = v; },
    get textFields()     { return textFields; },
    get focusedTextFieldId() { return focusedTextFieldId; },
    DEFAULT_BOX_H,
    // Functions
    fitToWindow,
    createTextField,
    renderTextField,
    removeTextField,
    applyFontToLegend,
    autoSave,
    expandPage,
    applyTheme,
    downloadJSON,
    loadJSON,
    exportPDF,
    createBox,
    findFreePosition,
    updateBoxShape,
    growBoxToFit,
    renderBox,
    createBridge,
    renderBridge,
    removeBridge,
    reconcileAllBridges,
    drawPageMargins,
    detectSideExtended,
    clearAllSideConnectors,
    drawSideConnector,
    sidesCanConnect,
    sideAnchor,
    pointNearLine,
  };

  window.createEventsModule(eventsEnv);

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  fitToWindow();   // set scale & sizes before any drawing

  if (!autoLoad()) {
    // Create default title text field
    const titleTf = createTextField({
      x: 50, y: 42, text: 'Talent Sheet', font: globalFont,
      fontSize: 32, fontWeight: 'bold', width: 600,
    });
    titleTextFieldId = titleTf.id;
    // Start with one empty box so the user sees something
    createBox({ x: PAGE_MARGIN + 20, y: GRID_TOP + 20 });
    autoSave();
  }

  initLegendDrag();
  applyFontToLegend();
  drawPageMargins();
  fitToWindow();   // recalc after content may have changed page height
  two.update();
})();
