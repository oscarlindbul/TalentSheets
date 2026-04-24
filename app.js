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
  const DEFAULT_LEGEND_WIDTH = 260;
  const DEFAULT_LEGEND_HEIGHT = 248;
  const MIN_LEGEND_WIDTH = 180;
  const MIN_LEGEND_HEIGHT = 150;

  let bridgeWidth     = 2.5;                             // bridge line width

  // Canvas zoom (Ctrl+Scroll)
  let canvasZoom    = 1.0;
  const MIN_CANVAS_ZOOM = 0.15;
  const MAX_CANVAS_ZOOM = 4.0;

  // Snap-to-center alignment threshold (px in A1 space)
  const SNAP_THRESHOLD = 15;

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  let boxes     = [];   // { id, x, y, w, h, name, description, cost, acquired, ranked, font, strokeColor, fillColor }
  let bridges   = [];   // { id, fromId, toId, fromSide, toSide }
  let dashedLines = []; // { id, x1, y1, x2, y2 }
  let textFields = [];  // { id, x, y, text, font, fontSize, fontWeight, width }
  let nextBoxId = 1;
  let nextBridgeId = 1;
  let nextDashedLineId = 1;
  let nextTextFieldId = 1;

  let bridgePending   = null;  // { boxId, side } — first half of a bridge connection
  let textPlaceMode   = false; // when true, next click on page places a text field
  let dashedLinePlaceMode = false;
  let dashedLinePending = null;
  let globalFont      = 'sans-serif';
  let globalFontSize  = 13;
  let globalFontColor = '#222222';
  let globalBold      = false;
  let globalItalic    = false;
  let globalStroke    = '#444444';
  let globalFill      = '#f5f0e1';
  let bridgeColor     = '#666666';
  let darkMode        = false;
  let focusedBoxId    = null;   // id of the box that currently has focus
  let focusedCostBoxId = null;  // id of box whose cost field has focus (or null)
  let focusedBoxField = null;   // name | description | cost
  let focusedTextFieldId = null; // id of the text field that currently has focus
  let lastFocusedInput   = null; // last textarea/contenteditable that had focus
  let legendPos       = { x: -1, y: 42 }; // -1 means "right-anchored at 50px"
  let legendSize      = { width: DEFAULT_LEGEND_WIDTH, height: DEFAULT_LEGEND_HEIGHT };
  let selectedBoxIds = new Set();
  let selectedTextFieldIds = new Set();
  let objectClipboard = null;
  let pasteSequence = 0;

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
  const btnAddDashedLine = document.getElementById('btn-add-dashed-line');
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
  const colorFont     = document.getElementById('font-color-input');
  const fontBoldBtn   = document.getElementById('font-bold-btn');
  const fontItalicBtn = document.getElementById('font-italic-btn');
  const fontUnderlineBtn = document.getElementById('font-underline-btn');
  const btnInsertSymbol  = document.getElementById('btn-insert-symbol');
  const insertSymbolMenu = document.getElementById('insert-symbol-menu');
  const btnInsertImageSymbol = document.getElementById('btn-insert-image-symbol');
  const insertImageSymbolMenu = document.getElementById('insert-image-symbol-menu');
  const sheetLegend   = document.getElementById('sheet-legend');
  const legendContent = sheetLegend.querySelector('.legend-content');
  const legendTitle   = sheetLegend.querySelector('.legend-title');
  const legendItems   = Array.from(sheetLegend.querySelectorAll('.legend-item'));
  const toolbar       = document.getElementById('toolbar');

  /* Title text-field id — the first text field auto-created acts as the title */
  let titleTextFieldId = null;
  let persistentSelectionRange = null;
  let persistentSelectionRoot = null;
  const persistentSelectionHighlightName = 'persistent-selection';

  /* ------------------------------------------------------------------ */
  /*  Two.js setup                                                       */
  /* ------------------------------------------------------------------ */

  const two = new Two({
    type: Two.Types.svg,
    width: A1_WIDTH,
    height: A1_HEIGHT,
  }).appendTo(twoCanvas);

  const dashedLineGroup = two.makeGroup();

  // Maps: boxId → Two.Path (the chamfered rect), bridgeId → Two.Line
  const twoBoxShapes    = {};
  const twoBridgeLines  = {};
  const twoDashedLines  = {};
  let marginShapes      = [];    // Two.js shapes for page-margin dashes
  let previewDashedLine = null;

  /* ------------------------------------------------------------------ */
  /*  Fit page to browser window width                                   */
  /* ------------------------------------------------------------------ */

  function fitToWindow() {
    // Scale so A1 page fits naturally; multiply by canvasZoom for canvas-only zoom
    currentScale = canvasZoom;

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

    // Allow horizontal scroll when page is wider than viewport
    pageWrapper.style.overflowX = visW > window.innerWidth ? 'auto' : 'hidden';
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

  function isBoxSelected(id) {
    return selectedBoxIds.has(id);
  }

  function isTextFieldSelected(id) {
    return selectedTextFieldIds.has(id);
  }

  function syncObjectSelectionStyles() {
    boxes.forEach(box => {
      const el = document.getElementById('box-' + box.id);
      if (el) el.classList.toggle('selected', selectedBoxIds.has(box.id));
    });
    textFields.forEach(tf => {
      const el = document.getElementById('tf-' + tf.id);
      if (el) el.classList.toggle('selected', selectedTextFieldIds.has(tf.id));
    });
  }

  function clearObjectSelection() {
    if (selectedBoxIds.size === 0 && selectedTextFieldIds.size === 0) return;
    selectedBoxIds = new Set();
    selectedTextFieldIds = new Set();
    syncObjectSelectionStyles();
  }

  function setSingleObjectSelection(kind, id) {
    selectedBoxIds = kind === 'box' ? new Set([id]) : new Set();
    selectedTextFieldIds = kind === 'textField' ? new Set([id]) : new Set();
    syncObjectSelectionStyles();
  }

  function addObjectSelection(kind, id) {
    if (kind === 'box') selectedBoxIds.add(id);
    else selectedTextFieldIds.add(id);
    syncObjectSelectionStyles();
  }

  function removeObjectSelection(kind, id) {
    if (kind === 'box') selectedBoxIds.delete(id);
    else selectedTextFieldIds.delete(id);
    syncObjectSelectionStyles();
  }

  function toggleObjectSelection(kind, id) {
    const setRef = kind === 'box' ? selectedBoxIds : selectedTextFieldIds;
    if (setRef.has(id)) setRef.delete(id);
    else setRef.add(id);
    syncObjectSelectionStyles();
  }

  function hasObjectSelection() {
    return selectedBoxIds.size > 0 || selectedTextFieldIds.size > 0;
  }

  function getSelectionSnapshot(anchorKind, anchorId) {
    const boxIds = selectedBoxIds.has(anchorId) || anchorKind !== 'box'
      ? Array.from(selectedBoxIds)
      : [anchorId];
    const textIds = selectedTextFieldIds.has(anchorId) || anchorKind !== 'textField'
      ? Array.from(selectedTextFieldIds)
      : [anchorId];

    if (anchorKind === 'box' && !boxIds.includes(anchorId)) boxIds.unshift(anchorId);
    if (anchorKind === 'textField' && !textIds.includes(anchorId)) textIds.unshift(anchorId);

    return {
      boxes: boxIds.map(id => {
        const box = boxes.find(item => item.id === id);
        return box ? { id, x: box.x, y: box.y } : null;
      }).filter(Boolean),
      textFields: textIds.map(id => {
        const tf = textFields.find(item => item.id === id);
        return tf ? { id, x: tf.x, y: tf.y } : null;
      }).filter(Boolean),
    };
  }

  function moveSelectionFromSnapshot(snapshot, dx, dy) {
    snapshot.boxes.forEach(item => {
      const box = boxes.find(candidate => candidate.id === item.id);
      if (!box) return;
      box.x = Math.max(0, item.x + dx);
      box.y = Math.max(0, item.y + dy);
      const el = document.getElementById('box-' + box.id);
      if (el) {
        el.style.left = box.x + 'px';
        el.style.top = box.y + 'px';
      }
      updateBoxShape(box);
      updateBridgesFor(box.id);
    });

    snapshot.textFields.forEach(item => {
      const tf = textFields.find(candidate => candidate.id === item.id);
      if (!tf) return;
      tf.x = Math.max(0, item.x + dx);
      tf.y = Math.max(0, item.y + dy);
      const el = document.getElementById('tf-' + tf.id);
      if (el) {
        el.style.left = tf.x + 'px';
        el.style.top = tf.y + 'px';
      }
    });

    expandPage();
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function copyCurrentSelection() {
    if (!hasObjectSelection()) return false;
    objectClipboard = {
      boxes: boxes.filter(box => selectedBoxIds.has(box.id)).map(box => cloneData(box)),
      textFields: textFields.filter(tf => selectedTextFieldIds.has(tf.id)).map(tf => cloneData(tf)),
    };
    pasteSequence = 0;
    return objectClipboard.boxes.length > 0 || objectClipboard.textFields.length > 0;
  }

  function pasteClipboard() {
    if (!objectClipboard) return false;
    pasteSequence += 1;
    const offset = 24 * pasteSequence;
    const newBoxIds = [];
    const newTextFieldIds = [];

    objectClipboard.boxes.forEach(source => {
      const data = cloneData(source);
      delete data.id;
      data.x += offset;
      data.y += offset;
      const created = createBox(data);
      newBoxIds.push(created.id);
    });

    objectClipboard.textFields.forEach(source => {
      const data = cloneData(source);
      delete data.id;
      data.x += offset;
      data.y += offset;
      const created = createTextField(data);
      newTextFieldIds.push(created.id);
    });

    selectedBoxIds = new Set(newBoxIds);
    selectedTextFieldIds = new Set(newTextFieldIds);
    syncObjectSelectionStyles();
    autoSave();
    return true;
  }

  function deleteCurrentSelection() {
    if (!hasObjectSelection()) return false;
    Array.from(selectedBoxIds).forEach(id => removeBox(id));
    Array.from(selectedTextFieldIds).forEach(id => removeTextField(id));
    clearObjectSelection();
    autoSave();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /*  Box module initialisation  (box.js)                                */
  /* ------------------------------------------------------------------ */

  const boxEnv = {
    two,
    twoBoxShapes,
    twoBridgeLines,
    overlay,
    pageContainer,
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
    get focusedBoxField() { return focusedBoxField; },
    set focusedBoxField(v) { focusedBoxField = v; },
    isBoxSelected,
    removeObjectSelection,
    addObjectSelection,
    toggleObjectSelection,
    setSingleObjectSelection,
    clearObjectSelection,
    getSelectionSnapshot,
    moveSelectionFromSnapshot,
    syncObjectSelectionStyles,
    set focusedTextFieldId(v) { focusedTextFieldId = v; },
    onBoxFocus(box, isCostFocus) {
      const fieldName = typeof isCostFocus === 'string'
        ? isCostFocus
        : (isCostFocus ? 'cost' : (focusedBoxField || 'description'));
      setFontControlsEnabled(true);
      applyToolbarState(getBoxFieldState(box, fieldName));
    },
    onBoxBlur() {
      focusedCostBoxId = null;
      focusedBoxField = null;
      if (hasPersistentFormattingTarget()) return;
      resetToolbarState();
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
    scheduleTextAutoSave() { scheduleTextAutoSave(); },
    flushScheduledAutoSave() { flushScheduledAutoSave(); },
    clearSideConnector,
    detectSideExtended,
    detectSideConnectorHit,
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

  const SIDE_CONNECTOR_RADIUS = 16;
  const SIDE_CONNECTOR_OUTER_PAD = 34;
  const SIDE_CONNECTOR_INNER_PAD = 24;
  const SIDE_CONNECTOR_CENTER_OFFSET = 6;
  const SIDE_CONNECTOR_HIT_PAD = 8;

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

  function bridgeAnchor(box, side) {
    const inset = Math.max(4, bridgeWidth + 2);

    switch (side) {
      case 'top':
        return [box.x + box.w / 2, box.y + inset];
      case 'bottom':
        return [box.x + box.w / 2, box.y + box.h - inset];
      case 'left':
        return [box.x + inset, box.y + box.h / 2];
      case 'right':
        return [box.x + box.w - inset, box.y + box.h / 2];
    }

    return [box.x + box.w / 2, box.y + box.h / 2];
  }

  function snapDashedLineEnd(startX, startY, endX, endY) {
    const dx = endX - startX;
    const dy = endY - startY;
    const axisSnapThreshold = Math.tan(1 * Math.PI / 180);

    // Near-horizontal drag: snap Y to start Y
    if (Math.abs(dx) > 0 && Math.abs(dy / dx) <= axisSnapThreshold) {
      return [endX, startY];
    }

    // Near-vertical drag: snap X to start X
    if (Math.abs(dy) > 0 && Math.abs(dx / dy) <= axisSnapThreshold) {
      return [startX, endY];
    }

    return [endX, endY];
  }

  function sideConnectorCenter(box, side) {
    let [cx, cy] = sideAnchor(box, side);

    switch (side) {
      case 'top':
        cy -= SIDE_CONNECTOR_CENTER_OFFSET;
        break;
      case 'bottom':
        cy += SIDE_CONNECTOR_CENTER_OFFSET;
        break;
      case 'left':
        cx -= SIDE_CONNECTOR_CENTER_OFFSET;
        break;
      case 'right':
        cx += SIDE_CONNECTOR_CENTER_OFFSET;
        break;
    }

    return [cx, cy];
  }

  function detectSideConnectorHit(box, px, py) {
    let best = null;
    const hitRadius = SIDE_CONNECTOR_RADIUS + SIDE_CONNECTOR_HIT_PAD;

    ['top', 'right', 'bottom', 'left'].forEach(side => {
      const [cx, cy] = sideConnectorCenter(box, side);
      const dist = Math.hypot(px - cx, py - cy);
      if (dist > hitRadius) return;
      if (!best || dist < best.dist) {
        best = { side, dist };
      }
    });

    return best ? best.side : null;
  }

  /** Detect which side the mouse is nearest to, with extended detection outside the box */
  function detectSideExtended(box, px, py) {
    const pad = SIDE_CONNECTOR_OUTER_PAD;   // px detection band OUTSIDE each edge
    const inner = SIDE_CONNECTOR_INNER_PAD; // px detection band INSIDE each edge

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
    const r = SIDE_CONNECTOR_RADIUS;
    const [cx, cy] = sideConnectorCenter(box, side);

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
    path.linewidth = 2;

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

  function createDashedLine(data) {
    const dashedLine = Object.assign({
      id: nextDashedLineId++,
    }, data);

    if (data && data.id && data.id >= nextDashedLineId) {
      nextDashedLineId = data.id + 1;
    }

    dashedLines.push(dashedLine);
    renderDashedLine(dashedLine);
    return dashedLine;
  }

  function removeTwoShape(shape) {
    if (!shape) return;
    if (shape.parent && typeof shape.parent.remove === 'function') {
      shape.parent.remove(shape);
    }
    two.remove(shape);
  }

  function renderBridge(bridge) {
    const fromBox = boxes.find(b => b.id === bridge.fromId);
    const toBox   = boxes.find(b => b.id === bridge.toId);
    if (!fromBox || !toBox) return;

    if (twoBridgeLines[bridge.id]) {
      two.remove(twoBridgeLines[bridge.id]);
    }

    const [x1, y1] = bridgeAnchor(fromBox, bridge.fromSide || 'right');
    const [x2, y2] = bridgeAnchor(toBox,   bridge.toSide   || 'left');

    const color = darkMode ? lighten(bridgeColor) : bridgeColor;

    const line = two.makeLine(x1, y1, x2, y2);
    line.stroke   = color;
    line.linewidth = bridgeWidth;

    twoBridgeLines[bridge.id] = line;
    two.update();
  }

  function renderDashedLine(dashedLine) {
    if (twoDashedLines[dashedLine.id]) {
        two.remove(twoDashedLines[dashedLine.id]);
      //removeTwoShape(twoDashedLines[dashedLine.id]);
    }

    const color = darkMode ? lighten(bridgeColor) : bridgeColor;
    const line = two.makeLine(dashedLine.x1, dashedLine.y1, dashedLine.x2, dashedLine.y2);
    line.stroke = color;
    line.linewidth = bridgeWidth;
    line.dashes = [10, 6];
    dashedLineGroup.add(line);

    twoDashedLines[dashedLine.id] = line;
    two.update();
  }

  function clearDashedLinePreview() {
    if (!previewDashedLine) return;
    removeTwoShape(previewDashedLine);
    previewDashedLine = null;
    two.update();
  }

  function updateDashedLinePreview(x1, y1, x2, y2) {
    const [snappedX2, snappedY2] = snapDashedLineEnd(x1, y1, x2, y2);

    if (previewDashedLine) {
      removeTwoShape(previewDashedLine);
      previewDashedLine = null;
    }

    const color = darkMode ? lighten(bridgeColor) : bridgeColor;
    const line = two.makeLine(x1, y1, snappedX2, snappedY2);
    line.stroke = color;
    line.linewidth = bridgeWidth;
    line.dashes = [10, 6];
    line.opacity = 0.8;
    dashedLineGroup.add(line);
    previewDashedLine = line;

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

  function removeDashedLine(id) {
    if (twoDashedLines[id]) {
      removeTwoShape(twoDashedLines[id]);
      delete twoDashedLines[id];
    }
    dashedLines = dashedLines.filter(line => line.id !== id);
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

  function cssColorToHex(color) {
    if (!color) return '#222222';
    if (color.startsWith('#')) {
      if (color.length === 4) {
        return '#' + color.slice(1).split('').map(ch => ch + ch).join('');
      }
      return color;
    }
    const parts = color.match(/\d+/g);
    if (!parts || parts.length < 3) return '#222222';
    return '#' + parts.slice(0, 3).map(part => Number(part).toString(16).padStart(2, '0')).join('');
  }

  function setFontControlsEnabled(enabled) {
    fontSelect.disabled = !enabled;
    fontSizeInput.disabled = !enabled;
    colorFont.disabled = !enabled;
    fontBoldBtn.disabled = !enabled;
    fontItalicBtn.disabled = !enabled;
    fontUnderlineBtn.disabled = !enabled;
  }

  function defaultBoxFieldColor(fieldName) {
    if (fieldName === 'name') return '#ffffff';
    if (fieldName === 'cost') return darkMode ? '#000000' : '#ffffff';
    return darkMode ? '#dddddd' : '#222222';
  }

  function getTextFieldState(tf) {
    return {
      font: tf.font || globalFont,
      fontSize: tf.fontSize || globalFontSize,
      bold: !!tf.bold,
      italic: !!tf.italic,
      underline: !!tf.underline,
      color: tf.fontColor || (darkMode ? '#dddddd' : '#222222'),
    };
  }

  function getBoxFieldState(box, fieldName) {
    if (fieldName === 'name') {
      return {
        font: box.nameFont || box.font || globalFont,
        fontSize: box.nameFontSize || box.fontSize || globalFontSize,
        bold: box.nameBold != null ? !!box.nameBold : !!box.bold,
        italic: box.nameItalic != null ? !!box.nameItalic : !!box.italic,
        underline: !!box.nameUnderline,
        color: box.nameColor || defaultBoxFieldColor('name'),
      };
    }
    if (fieldName === 'cost') {
      return {
        font: box.costFont || box.font || globalFont,
        fontSize: box.costFontSize || 13,
        bold: box.costBold != null ? !!box.costBold : true,
        italic: !!box.costItalic,
        underline: !!box.costUnderline,
        color: box.costColor || defaultBoxFieldColor('cost'),
      };
    }
    return {
      font: box.descriptionFont || box.font || globalFont,
      fontSize: box.descriptionFontSize || box.fontSize || globalFontSize,
      bold: box.descriptionBold != null ? !!box.descriptionBold : !!box.bold,
      italic: box.descriptionItalic != null ? !!box.descriptionItalic : !!box.italic,
      underline: !!box.descriptionUnderline,
      color: box.descriptionColor || defaultBoxFieldColor('description'),
    };
  }

  function applyToolbarState(state) {
    if (!state) return;
    if (state.font && fontSelect.querySelector(`option[value="${state.font}"]`)) {
      fontSelect.value = state.font;
    }
    if (state.fontSize != null && !Number.isNaN(Number(state.fontSize))) {
      fontSizeInput.value = Math.round(Number(state.fontSize));
    }
    if (state.color) {
      colorFont.value = cssColorToHex(state.color);
    }
    fontBoldBtn.classList.toggle('active', !!state.bold);
    fontItalicBtn.classList.toggle('active', !!state.italic);
    fontUnderlineBtn.classList.toggle('active', !!state.underline);
  }

  function resetToolbarState() {
    setFontControlsEnabled(false);
    fontSelect.value = globalFont;
    fontSizeInput.value = globalFontSize;
    colorFont.value = cssColorToHex(globalFontColor);
    fontBoldBtn.classList.toggle('active', globalBold);
    fontItalicBtn.classList.toggle('active', globalItalic);
    fontUnderlineBtn.classList.remove('active');
  }

  function hasPersistentFormattingTarget() {
    return !!(persistentSelectionRoot && persistentSelectionRoot.isConnected);
  }

  function applyPersistentSelectionHighlight() {
    if (!(window.CSS && CSS.highlights)) return;
    CSS.highlights.delete(persistentSelectionHighlightName);
    if (!persistentSelectionRange || !persistentSelectionRoot || !persistentSelectionRoot.isConnected) return;
    CSS.highlights.set(
      persistentSelectionHighlightName,
      new Highlight(persistentSelectionRange.cloneRange())
    );
  }

  function storePersistentSelection(range, root) {
    if (!range || range.collapsed || !root || !root.isConnected) return;
    persistentSelectionRange = range.cloneRange();
    persistentSelectionRoot = root;
    applyPersistentSelectionHighlight();
  }

  function getEditableSelectionRoot(node) {
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

  function clearPersistentSelection() {
    persistentSelectionRange = null;
    persistentSelectionRoot = null;
    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete(persistentSelectionHighlightName);
    }
  }

  function capturePersistentSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const root = getEditableSelectionRoot(range.commonAncestorContainer) || getEditableSelectionRoot(sel.anchorNode);
    if (!root) return;
    storePersistentSelection(range, root);
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
      fontColor:   globalFontColor,
      fontWeight:  'bold',
      bold:        true,
      italic:      false,
      underline:   false,
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
    el.classList.toggle('selected', isTextFieldSelected(tf.id));

    const weight = tf.bold ? 'bold' : (tf.fontWeight === 'bold' ? 'bold' : 'normal');
    const fStyle = tf.italic ? 'italic' : 'normal';
    const tDeco = tf.underline ? 'underline' : 'none';
    const tColor = tf.fontColor ? `color:${tf.fontColor};` : '';
    el.innerHTML = `
      <span class="tf-drag" title="Drag to move">⋮</span>
      <button class="tf-delete" title="Delete">&times;</button>
      <div class="tf-input" contenteditable="true" role="textbox" data-placeholder="Text…"
        style="font-family:${tf.font}; font-size:${tf.fontSize}px; font-weight:${weight}; font-style:${fStyle}; text-decoration:${tDeco}; ${tColor}"
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
      scheduleTextAutoSave();
    });

    input.addEventListener('blur', () => {
      flushScheduledAutoSave();
    });

    // Focus tracking — update toolbar to show this field's font/size
    el.addEventListener('focusin', () => {
      focusedTextFieldId = tf.id;
      focusedBoxId = null;
      setFontControlsEnabled(true);
      applyToolbarState(getTextFieldState(tf));
    });
    el.addEventListener('focusout', (e) => {
      if (!el.contains(e.relatedTarget)) {
        // Keep toolbar active when focus moves to a toolbar control (for formatting)
        const toolbar = document.getElementById('toolbar');
        if (e.relatedTarget && toolbar && toolbar.contains(e.relatedTarget)) return;
        if (focusedTextFieldId === tf.id) {
          focusedTextFieldId = null;
          if (!hasPersistentFormattingTarget()) {
            resetToolbarState();
          }
        }
      }
    });

    // Drag — initiated from the drag handle only
    const dragHandle = el.querySelector('.tf-drag');
    let dragging = false, startMX, startMY, startX, startY;
    let selectionSnapshot = null;

    function isNearTextFieldBorder(target, event) {
      if (target.closest('.tf-delete, .tf-drag')) return true;
      const inputRect = input.getBoundingClientRect();
      const pad = 10;
      return (
        event.clientX <= inputRect.left + pad ||
        event.clientX >= inputRect.right - pad ||
        event.clientY <= inputRect.top + pad ||
        event.clientY >= inputRect.bottom - pad
      );
    }

    el.addEventListener('mousedown', (e) => {
      if (!isNearTextFieldBorder(e.target, e)) return;
      if (e.ctrlKey || e.shiftKey) {
        toggleObjectSelection('textField', tf.id);
      } else if (!isTextFieldSelected(tf.id)) {
        setSingleObjectSelection('textField', tf.id);
      }
      e.stopPropagation();
    });

    dragHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.ctrlKey || e.shiftKey) {
        toggleObjectSelection('textField', tf.id);
      } else if (!isTextFieldSelected(tf.id)) {
        setSingleObjectSelection('textField', tf.id);
      }
      dragging = true;
      startMX = e.clientX;
      startMY = e.clientY;
      startX = tf.x;
      startY = tf.y;
      selectionSnapshot = getSelectionSnapshot('textField', tf.id);
      el.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startMX) / currentScale;
      const dy = (e.clientY - startMY) / currentScale;
      moveSelectionFromSnapshot(selectionSnapshot || getSelectionSnapshot('textField', tf.id), dx, dy);
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      selectionSnapshot = null;
      el.classList.remove('dragging');
      autoSave();
    });
  }

  function removeTextField(id) {
    const el = document.getElementById('tf-' + id);
    if (el) el.remove();
    textFields = textFields.filter(t => t.id !== id);
    removeObjectSelection('textField', id);
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
      btnInsertImageSymbol.disabled = false;
    }
  });

  document.addEventListener('focusin', (e) => {
    const root = getEditableSelectionRoot(e.target);
    if (root && persistentSelectionRoot && root !== persistentSelectionRoot) {
      clearPersistentSelection();
    }
  });

  // Clear lastFocusedInput only when focus leaves to something outside
  // the insert-symbol button/menu (so clicking Dice doesn't disable itself)
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.closest('#insert-symbol-wrapper, #insert-image-symbol-wrapper')) return;
    if (t.closest('#toolbar') && !t.isContentEditable) {
      // Focused a non-text toolbar control — clear last input
      if (!overlay.contains(t)) {
        lastFocusedInput = null;
        btnInsertSymbol.disabled = true;
        btnInsertImageSymbol.disabled = true;
      }
    }
  });

  overlay.addEventListener('focusout', (e) => {
    // If focus is going to the insert-symbol button/menu, keep lastFocusedInput
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active.closest('#insert-symbol-wrapper, #insert-image-symbol-wrapper')) return;
      if (!overlay.contains(active) && lastFocusedInput) {
        lastFocusedInput = null;
        btnInsertSymbol.disabled = true;
        btnInsertImageSymbol.disabled = true;
      }
    }, 0);
  });

  /**
   * Insert text symbol or inline image at the caret in the last-focused
   * contentEditable element.
   * @param {string|Object} content - text to insert, or { imageSrc, alt, cls }
   * @param {string} [color] - optional CSS color for text span
   * @param {string} [cls] - optional CSS class(es)
   */
  function insertAtCaret(content, color, cls) {
    const el = lastFocusedInput;
    if (!el) return;
    el.focus();
    if (el.isContentEditable) {
      const makeTextSpan = () => {
        const s = document.createElement('span');
        if (color) s.style.color = color;
        if (cls)   s.className = cls;
        s.textContent = String(content || '');
        return s;
      };

      const makeNode = () => {
        if (content && typeof content === 'object' && content.imageSrc) {
          const img = document.createElement('img');
          img.src = content.imageSrc;
          img.alt = content.alt || '';
          img.draggable = false;
          img.className = (content.cls || cls || 'inline-symbol-image').trim();
          return img;
        }

        if (color || cls) return makeTextSpan();
        return document.createTextNode(String(content || ''));
      };

      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = makeNode();
        range.insertNode(node);
        // Move caret after the inserted node
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        const node = makeNode();
        el.appendChild(node);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Selection tracking — update toolbar when caret in text field      */
  /* ------------------------------------------------------------------ */

  document.addEventListener('selectionchange', () => {
    capturePersistentSelection();

    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return;
    const root = getEditableSelectionRoot(sel.anchorNode);
    if (!root) return;

    const anchor = sel.anchorNode;
    const parent = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
    if (parent) {
      const computed = window.getComputedStyle(parent);
      const px = parseFloat(computed.fontSize);
      const weightNum = parseInt(computed.fontWeight, 10);
      setFontControlsEnabled(true);
      applyToolbarState({
        font: computed.fontFamily.replace(/^["']|["']$/g, '').split(',')[0].trim(),
        fontSize: !isNaN(px) ? px : globalFontSize,
        bold: document.queryCommandState('bold') || (!Number.isNaN(weightNum) && weightNum >= 600) || computed.fontWeight === 'bold',
        italic: document.queryCommandState('italic') || computed.fontStyle === 'italic',
        underline: document.queryCommandState('underline') || computed.textDecorationLine.includes('underline'),
        color: computed.color,
      });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Apply font to legend                                               */
  /* ------------------------------------------------------------------ */

  function applyFontToLegend() {
    sheetLegend.style.fontFamily = globalFont;
    layoutLegendContent();
  }

  function clampLegendSize(width, height) {
    return {
      width: Math.max(MIN_LEGEND_WIDTH, Math.min(A1_WIDTH - PAGE_MARGIN, Math.round(width))),
      height: Math.max(MIN_LEGEND_HEIGHT, Math.min(pageHeight - PAGE_MARGIN, Math.round(height))),
    };
  }

  function applyLegendSize() {
    legendSize = clampLegendSize(legendSize.width, legendSize.height);
    sheetLegend.style.width = legendSize.width + 'px';
    sheetLegend.style.height = legendSize.height + 'px';
  }

  function setLegendScale(itemFontSize) {
    const clampedItemSize = Math.max(6, Math.min(72, itemFontSize));
    const titleSize = Math.max(clampedItemSize + 1, clampedItemSize * 1.16);
    const markerWidth = Math.max(22, clampedItemSize * 1.8);
    const swatchWidth = Math.max(14, clampedItemSize * 1.25);
    const swatchHeight = Math.max(10, clampedItemSize * 0.92);
    const checkboxSize = Math.max(14, clampedItemSize * 1.05);
    const rankedSize = Math.max(14, clampedItemSize * 1.2);
    const lineWidth = Math.max(24, clampedItemSize * 2.1);
    const lineStroke = Math.max(2, clampedItemSize * 0.16);
    const gap = Math.max(6, clampedItemSize * 0.45);

    sheetLegend.style.setProperty('--legend-item-size', clampedItemSize + 'px');
    sheetLegend.style.setProperty('--legend-title-size', titleSize + 'px');
    sheetLegend.style.setProperty('--legend-marker-width', markerWidth + 'px');
    sheetLegend.style.setProperty('--legend-swatch-width', swatchWidth + 'px');
    sheetLegend.style.setProperty('--legend-swatch-height', swatchHeight + 'px');
    sheetLegend.style.setProperty('--legend-checkbox-size', checkboxSize + 'px');
    sheetLegend.style.setProperty('--legend-ranked-size', rankedSize + 'px');
    sheetLegend.style.setProperty('--legend-line-width', lineWidth + 'px');
    sheetLegend.style.setProperty('--legend-line-stroke', lineStroke + 'px');
    sheetLegend.style.setProperty('--legend-gap', gap + 'px');
  }

  function legendContentFits() {
    return legendContent.scrollHeight <= legendContent.clientHeight + 1 &&
      legendContent.scrollWidth <= legendContent.clientWidth + 1;
  }

  function legendContentStrictlyFits() {
    return legendContent.scrollHeight <= legendContent.clientHeight &&
      legendContent.scrollWidth <= legendContent.clientWidth;
  }

  function layoutLegendContent() {
    applyLegendSize();

    if (!legendContent.clientWidth || !legendContent.clientHeight) {
      setLegendScale(13);
      return;
    }

    let low = 6;
    let high = Math.min(72, legendContent.clientHeight, legendContent.clientWidth);
    let best = low;

    while ((high - low) > 0.25) {
      const mid = (low + high) / 2;
      setLegendScale(mid);
      if (legendContentFits()) {
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    setLegendScale(best);
    while (!legendContentStrictlyFits() && best > 6) {
      best -= 0.25;
      setLegendScale(best);
    }
    sheetLegend.style.setProperty('--legend-handle-size', Math.max(16, Math.min(22, best * 1.2)) + 'px');
  }

  /* ------------------------------------------------------------------ */
  /*  Legend drag setup                                                  */
  /* ------------------------------------------------------------------ */

  function positionLegend() {
    const el = sheetLegend;
    applyLegendSize();
    if (legendPos.x >= 0) {
      el.style.left  = legendPos.x + 'px';
      el.style.right = 'auto';
    } else {
      el.style.right = '50px';
      el.style.left  = 'auto';
    }
    el.style.top = legendPos.y + 'px';
    layoutLegendContent();
  }

  let legendDragBound = false;
  function initLegendDrag() {
    positionLegend();
    if (legendDragBound) return;
    legendDragBound = true;

    const el = sheetLegend;
    const resizeHandle = el.querySelector('.legend-resize-handle');
    el.style.cursor = 'grab';

    let dragging = false, startMX, startMY, startX, startY;
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('input, .legend-resize-handle')) return;
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

    let resizing = false;
    let resizeStartMX, resizeStartMY, resizeStartX, resizeStartY, resizeStartW, resizeStartH;

    resizeHandle.addEventListener('mousedown', (e) => {
      resizing = true;
      resizeStartMX = e.clientX;
      resizeStartMY = e.clientY;
      const rect = el.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      resizeStartX = (rect.left - overlayRect.left) / currentScale;
      resizeStartY = (rect.top - overlayRect.top) / currentScale;
      resizeStartW = rect.width / currentScale;
      resizeStartH = rect.height / currentScale;
      el.style.left = resizeStartX + 'px';
      el.style.top = resizeStartY + 'px';
      el.style.right = 'auto';
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = (e.clientX - resizeStartMX) / currentScale;
      const dy = (e.clientY - resizeStartMY) / currentScale;
      legendPos.x = resizeStartX;
      legendPos.y = resizeStartY;
      legendSize = clampLegendSize(resizeStartW + dx, resizeStartH + dy);
      applyLegendSize();
      layoutLegendContent();
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
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
    twoDashedLines,
    dashedLineGroup,
    // DOM refs
    fontSelect,
    fontSizeInput,
    colorFont,
    // Proxy objects so json-utils.js can do fontBoldInput.checked = true
    fontBoldInput: {
      get checked() { return fontBoldBtn.classList.contains('active'); },
      set checked(v) { fontBoldBtn.classList.toggle('active', !!v); },
    },
    fontItalicInput: {
      get checked() { return fontItalicBtn.classList.contains('active'); },
      set checked(v) { fontItalicBtn.classList.toggle('active', !!v); },
    },
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
    get dashedLines()        { return dashedLines; },
    set dashedLines(v)       { dashedLines = v; },
    get textFields()         { return textFields; },
    set textFields(v)        { textFields = v; },
    get legendPos()          { return legendPos; },
    set legendPos(v)         { legendPos = v; },
    get legendSize()         { return legendSize; },
    set legendSize(v)        { legendSize = clampLegendSize(v.width, v.height); },
    get globalFont()         { return globalFont; },
    set globalFont(v)        { globalFont = v; },
    get globalFontSize()     { return globalFontSize; },
    set globalFontSize(v)    { globalFontSize = v; },
    get globalFontColor()    { return globalFontColor; },
    set globalFontColor(v)   { globalFontColor = v; },
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
    get nextDashedLineId()   { return nextDashedLineId; },
    set nextDashedLineId(v)  { nextDashedLineId = v; },
    get nextTextFieldId()    { return nextTextFieldId; },
    set nextTextFieldId(v)   { nextTextFieldId = v; },
    get bridgePending()      { return bridgePending; },
    set bridgePending(v)     { bridgePending = v; },
    clearDashedLinePreview,
    // Functions
    applyTheme,
    createBox,
    createBridge,
    createDashedLine,
    createTextField,
    expandPage,
    positionLegend,
    applyFontToLegend,
    layoutLegendContent,
    clearSideConnector,
    clearObjectSelection,
  };

  const {
    buildJSON,
    downloadJSON,
    loadJSON,
    clearAll,
    autoSave,
    autoLoad,
    scheduleTextAutoSave,
    flushScheduledAutoSave,
  } = window.createJsonUtilsModule(jsonEnv);

  /* ------------------------------------------------------------------ */
  /*  PDF Export module initialisation  (pdf-export.js)                   */
  /* ------------------------------------------------------------------ */

  const pdfEnv = {
    get A1_WIDTH()     { return A1_WIDTH; },
    get pageHeight()   { return pageHeight; },
    overlay,
    pageContainer,
    two,
    get bridges()            { return bridges; },
    set bridges(v)           { bridges = v; },
    get bridgeColor()        { return bridgeColor; },
    set bridgeColor(v)       { bridgeColor = v; },
    get bridgeWidth()        { return bridgeWidth; },
    get currentScale() { return currentScale; },
    get boxes()        { return boxes; },
    get darkMode()     { return darkMode; },
    CHAMFER_PCT: 0.20,
    fitToWindow,
    makeChamferedRect,
  };

  const { exportPDF } = window.createPdfExportModule(pdfEnv);

  /* ------------------------------------------------------------------ */
  /*  Theme                                                              */
  /* ------------------------------------------------------------------ */

  function applyTheme() {
    document.documentElement.dataset.theme = darkMode ? 'dark' : '';
    // Re-render all boxes & bridges with new colors
    boxes.forEach(b => updateBoxShape(b));
    dashedLines.forEach(line => renderDashedLine(line));
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
    pageWrapper,
    twoCanvas,
    // DOM refs
    btnAddBox,
    addTalentMenu,
    btnTheme,
    btnAddText,
    btnAddDashedLine,
    btnSave,
    btnLoad,
    btnExportPdf,
    fileInput,
    fontSelect,
    fontSizeInput,
    colorFont,
    fontBoldBtn,
    fontItalicBtn,
    fontUnderlineBtn,
    btnInsertSymbol,
    insertSymbolMenu,
    btnInsertImageSymbol,
    insertImageSymbolMenu,
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
    get dashedLines()    { return dashedLines; },
    get currentScale()   { return currentScale; },
    get canvasZoom()     { return canvasZoom; },
    set canvasZoom(v)    { canvasZoom = Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, v)); },
    get darkMode()       { return darkMode; },
    set darkMode(v)      { darkMode = v; },
    get globalFont()     { return globalFont; },
    set globalFont(v)    { globalFont = v; },
    get globalFontSize() { return globalFontSize; },
    set globalFontSize(v){ globalFontSize = v; },
    get globalFontColor() { return globalFontColor; },
    set globalFontColor(v){ globalFontColor = v; },
    get globalBold()     { return globalBold; },
    set globalBold(v)    { globalBold = v; },
    get globalItalic()   { return globalItalic; },
    set globalItalic(v)  { globalItalic = v; },
    get focusedBoxId()   { return focusedBoxId; },
    get focusedCostBoxId() { return focusedCostBoxId; },
    get focusedBoxField() { return focusedBoxField; },
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
    get dashedLinePlaceMode() { return dashedLinePlaceMode; },
    set dashedLinePlaceMode(v) { dashedLinePlaceMode = v; },
    get dashedLinePending() { return dashedLinePending; },
    set dashedLinePending(v) { dashedLinePending = v; },
    get textFields()     { return textFields; },
    get focusedTextFieldId() { return focusedTextFieldId; },
    isBoxSelected,
    isTextFieldSelected,
    hasObjectSelection,
    removeObjectSelection,
    addObjectSelection,
    toggleObjectSelection,
    setSingleObjectSelection,
    clearObjectSelection,
    getSelectionSnapshot,
    moveSelectionFromSnapshot,
    copyCurrentSelection,
    pasteClipboard,
    deleteCurrentSelection,
    syncObjectSelectionStyles,
    DEFAULT_BOX_H,
    // Functions
    fitToWindow,
    createTextField,
    renderTextField,
    removeTextField,
    storePersistentSelection,
    clearPersistentSelection,
    applyFontToLegend,
    autoSave,
    scheduleTextAutoSave,
    flushScheduledAutoSave,
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
    createDashedLine,
    renderDashedLine,
    removeDashedLine,
    snapDashedLineEnd,
    updateDashedLinePreview,
    clearDashedLinePreview,
    renderBridge,
    removeBridge,
    reconcileAllBridges,
    drawPageMargins,
    bridgeAnchor,
    detectSideExtended,
    detectSideConnectorHit,
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
