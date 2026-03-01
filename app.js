/**
 * Talent Sheet Generator — app.js
 *
 * Main application controller: page layout, grid, bridging lines,
 * side-connector UI, JSON persistence, PDF export, and toolbar wiring.
 *
 * Box creation, rendering, events, and removal live in box.js
 * (loaded via window.createBoxModule).
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

  let gridCols        = 10;
  let gridRows        = 20;                              // max visible rows
  let GRID_GAP        = 0;                               // computed horizontal gap
  let GRID_VGAP       = 16;                              // vertical gap between rows
  let bridgeWidth     = 2.5;                             // bridge line width

  /** Recalculate horizontal spacing from current gridCols (box width stays fixed) */
  function recalcGrid() {
    const usable = A1_WIDTH - PAGE_MARGIN * 2;           // area inside margins
    GRID_GAP  = Math.max(6, Math.floor((usable - gridCols * boxW) / (gridCols + 1)));
  }
  recalcGrid();   // initial calculation

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  let boxes     = [];   // { id, x, y, w, h, name, description, cost, acquired, ranked, font, strokeColor, fillColor }
  let bridges   = [];   // { id, fromId, toId, fromSide, toSide }
  let nextBoxId = 1;
  let nextBridgeId = 1;

  let bridgePending  = null;  // { boxId, side } — first half of a bridge connection
  let globalFont     = 'sans-serif';
  let globalStroke   = '#444444';
  let globalFill     = '#f5f0e1';
  let darkMode       = false;

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
  const btnSave       = document.getElementById('btn-save');
  const btnLoad       = document.getElementById('btn-load');
  const btnExportPdf  = document.getElementById('btn-export-pdf');
  const fileInput     = document.getElementById('file-input');
  const fontSelect    = document.getElementById('font-select');
  const colorStroke   = document.getElementById('color-stroke');
  const colorFill     = document.getElementById('color-fill');
  const gridColsInput = document.getElementById('grid-cols-input');
  const gridRowsInput = document.getElementById('grid-rows-input');
  const vgapInput     = document.getElementById('vgap-input');
  const boxWInput     = document.getElementById('box-w-input');
  const boxHInput     = document.getElementById('box-h-input');
  const bridgeWInput  = document.getElementById('bridge-w-input');
  const sheetTitle    = document.getElementById('sheet-title');

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
  let gridShapes        = [];    // Two.js shapes for visible grid

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

  window.addEventListener('resize', fitToWindow);

  /* ------------------------------------------------------------------ */
  /*  Draw visible grid (editor only, hidden in PDF)                     */
  /* ------------------------------------------------------------------ */

  function drawGrid() {
    // Remove old grid shapes
    gridShapes.forEach(s => two.remove(s));
    gridShapes = [];

    const stroke = darkMode ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)';
    const fill   = darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)';
    const bottomLimit = pageHeight - PAGE_MARGIN;   // nothing drawn below this

    const slotPad = 4;  // px padding around the default box size
    const slotW   = boxW + slotPad * 2;
    const slotH   = boxH + slotPad * 2;

    // Use configured gridRows but clip to what fits within the bottom margin
    const fitRows = Math.floor((bottomLimit - GRID_TOP - GRID_VGAP + GRID_VGAP) / (boxH + GRID_VGAP));
    const maxRows = Math.min(gridRows, fitRows);

    for (let row = 0; row < maxRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const x = gridX(col) - slotPad;
        const y = gridY(row) - slotPad;
        // Skip if this slot would extend past the bottom margin
        if (y + slotH > bottomLimit) continue;
        // Two.makeRectangle uses center coords
        const cx = x + slotW / 2;
        const cy = y + slotH / 2;
        const rect = two.makeRectangle(cx, cy, slotW, slotH);
        rect.stroke    = stroke;
        rect.fill      = fill;
        rect.linewidth = 1;
        rect.dashes    = [4, 3];
        rect.className = 'grid-line';
        gridShapes.push(rect);
      }
    }

    two.update();
  }

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

    
    drawGrid();
    two.update();
  }

  /* ------------------------------------------------------------------ */
  /*  Snap helpers                                                       */
  /* ------------------------------------------------------------------ */

  function gridX(col) {
    return PAGE_MARGIN + GRID_GAP + col * (boxW + GRID_GAP);
  }
  function gridY(row) {
    return GRID_TOP + GRID_VGAP + row * (boxH + GRID_VGAP);
  }

  function snapX(px) {
    const col = Math.round((px - PAGE_MARGIN - GRID_GAP) / (boxW + GRID_GAP));
    return gridX(Math.max(0, Math.min(col, gridCols - 1)));
  }

  function snapY(py) {
    const row = Math.round((py - GRID_TOP - GRID_VGAP) / (boxH + GRID_VGAP));
    return gridY(Math.max(0, row));
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
    get globalStroke()   { return globalStroke; },
    get globalFill()     { return globalFill; },
    get currentScale()   { return currentScale; },
    get gridCols()       { return gridCols; },
    CHAMFER_PCT:  0.20,
    darken,
    lighten,
    escHtml,
    snapX,
    snapY,
    gridX,
    gridY,
    reconcileAllBridges,
    updateBridgesFor,
    expandPage,
    autoSave,
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

  /* Overlay-level mousemove for extended side-connector detection */
  overlay.addEventListener('mousemove', (e) => {
    const rect = pageContainer.getBoundingClientRect();
    const px = (e.clientX - rect.left) / currentScale;
    const py = (e.clientY - rect.top)  / currentScale;

    let foundBox  = null;
    let foundSide = null;

    for (const box of boxes) {
      const side = detectSideExtended(box, px, py);
      if (side) {
        foundBox  = box;
        foundSide = side;
        break;
      }
    }

    if (foundBox && foundSide) {
      if (hoveredBoxId !== foundBox.id || hoveredSide !== foundSide) {
        clearAllSideConnectors();
        hoveredBoxId = foundBox.id;
        hoveredSide  = foundSide;
        drawSideConnector(foundBox, foundSide);
      }
    } else {
      clearAllSideConnectors();
    }
  });

  overlay.addEventListener('mouseleave', () => {
    clearAllSideConnectors();
  });

  /* Click on the overlay to start/complete a bridge via hovered side */
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('input, textarea, button, .ranked-indicator, .box-cost')) return;
    if (!hoveredBoxId || !hoveredSide) return;

    const box = boxes.find(b => b.id === hoveredBoxId);
    if (!box) return;

    if (!bridgePending) {
      // Start bridge
      bridgePending = { boxId: box.id, side: hoveredSide };
      const el = document.getElementById('box-' + box.id);
      if (el) el.style.outline = '3px solid #4a90d9';
    } else {
      // Finish bridge
      if (bridgePending.boxId !== box.id) {
        const fromBox = boxes.find(b => b.id === bridgePending.boxId);
        if (fromBox && sidesCanConnect(fromBox, bridgePending.side, box, hoveredSide)) {
          const exists = bridges.some(b =>
            (b.fromId === bridgePending.boxId && b.toId === box.id &&
             b.fromSide === bridgePending.side && b.toSide === hoveredSide) ||
            (b.fromId === box.id && b.toId === bridgePending.boxId &&
             b.fromSide === hoveredSide && b.toSide === bridgePending.side)
          );
          if (!exists) {
            createBridge({
              fromId: bridgePending.boxId,
              toId: box.id,
              fromSide: bridgePending.side,
              toSide: hoveredSide,
            });
          }
        }
      }
      // Clear pending
      const prevEl = document.getElementById('box-' + bridgePending.boxId);
      if (prevEl) prevEl.style.outline = '';
      bridgePending = null;
      autoSave();
    }
  });

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

    const color = darkMode
      ? getComputedStyle(document.documentElement).getPropertyValue('--bridge-color').trim()
      : '#666';

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

  /* Right-click on bridge line to delete it directly */
  twoCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rect = twoCanvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / currentScale;
    const py = (e.clientY - rect.top) / currentScale;

    for (const bridge of bridges) {
      const fromBox = boxes.find(b => b.id === bridge.fromId);
      const toBox   = boxes.find(b => b.id === bridge.toId);
      if (!fromBox || !toBox) continue;
      const [x1, y1] = sideAnchor(fromBox, bridge.fromSide || 'right');
      const [x2, y2] = sideAnchor(toBox,   bridge.toSide   || 'left');
      if (pointNearLine(px, py, x1, y1, x2, y2, 10)) {
        removeBridge(bridge.id);
        return;
      }
    }
  });

  /* Also handle right-click on overlay (for bridges behind boxes) */
  overlay.addEventListener('contextmenu', (e) => {
    const rect = pageContainer.getBoundingClientRect();
    const px = (e.clientX - rect.left) / currentScale;
    const py = (e.clientY - rect.top)  / currentScale;

    for (const bridge of bridges) {
      const fromBox = boxes.find(b => b.id === bridge.fromId);
      const toBox   = boxes.find(b => b.id === bridge.toId);
      if (!fromBox || !toBox) continue;
      const [x1, y1] = sideAnchor(fromBox, bridge.fromSide || 'right');
      const [x2, y2] = sideAnchor(toBox,   bridge.toSide   || 'left');
      if (pointNearLine(px, py, x1, y1, x2, y2, 10)) {
        e.preventDefault();
        removeBridge(bridge.id);
        return;
      }
    }
  });

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
  /*  Reconcile bridges after a box snaps to the grid                    */
  /*  For each bridge connected to boxId:                                */
  /*   - If the two boxes share the same Y (same row), set sides to     */
  /*     right→left or left→right based on relative X, provided no      */
  /*     other box sits between them on that row.                        */
  /*   - If the two boxes share the same X (same col), set sides to     */
  /*     bottom→top or top→bottom based on relative Y, provided no      */
  /*     other box sits between them on that column.                     */
  /*   - Otherwise delete the bridge.                                   */
  /* ------------------------------------------------------------------ */

  function reconcileAllBridges() {
    const toRemove = [];

    bridges.forEach(bridge => {
      const a  = boxes.find(b => b.id === bridge.fromId);
      const b2 = boxes.find(b => b.id === bridge.toId);
      if (!a || !b2) { toRemove.push(bridge.id); return; }

      const sameRow = Math.abs(a.y - b2.y) < 2;
      const sameCol = Math.abs(a.x - b2.x) < 2;

      if (sameRow && !sameCol) {
        const leftBox  = a.x < b2.x ? a : b2;
        const rightBox = a.x < b2.x ? b2 : a;

        const blocked = boxes.some(other => {
          if (other.id === a.id || other.id === b2.id) return false;
          return Math.abs(other.y - a.y) < 2 &&
                 other.x > leftBox.x && other.x < rightBox.x;
        });

        if (blocked) {
          toRemove.push(bridge.id);
        } else {
          if (a.x < b2.x) {
            bridge.fromSide = 'right';
            bridge.toSide   = 'left';
          } else {
            bridge.fromSide = 'left';
            bridge.toSide   = 'right';
          }
          renderBridge(bridge);
        }
      } else if (sameCol && !sameRow) {
        const topBox    = a.y < b2.y ? a : b2;
        const bottomBox = a.y < b2.y ? b2 : a;

        const blocked = boxes.some(other => {
          if (other.id === a.id || other.id === b2.id) return false;
          return Math.abs(other.x - a.x) < 2 &&
                 other.y > topBox.y && other.y < bottomBox.y;
        });

        if (blocked) {
          toRemove.push(bridge.id);
        } else {
          if (a.y < b2.y) {
            bridge.fromSide = 'bottom';
            bridge.toSide   = 'top';
          } else {
            bridge.fromSide = 'top';
            bridge.toSide   = 'bottom';
          }
          renderBridge(bridge);
        }
      } else {
        toRemove.push(bridge.id);
      }
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
  /*  JSON save / load                                                   */
  /* ------------------------------------------------------------------ */

  function buildJSON() {
    return JSON.stringify({
      meta: {
        font: globalFont,
        strokeColor: globalStroke,
        fillColor: globalFill,
        darkMode: darkMode,
        gridCols: gridCols,
        gridRows: gridRows,
        gridVGap: GRID_VGAP,
        boxWidth: boxW,
        boxHeight: boxH,
        bridgeWidth: bridgeWidth,
        sheetTitle: sheetTitle.value,
      },
      boxes: boxes,
      bridges: bridges,
    }, null, 2);
  }

  function downloadJSON() {
    const blob = new Blob([buildJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'talent_sheet.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ------------------------------------------------------------------ */
  /*  PDF Export  (A1 pages, 594 × 841 mm)                               */
  /* ------------------------------------------------------------------ */

  async function exportPDF() {
    // A1 dimensions in mm
    const A1_W_MM = 594;
    const A1_H_MM = 841;

    // Show a simple progress indicator
    const progress = document.createElement('div');
    progress.id = 'pdf-progress';
    progress.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.45);z-index:9999;color:#fff;font-size:22px;';
    progress.textContent = 'Rendering PDF…';
    document.body.appendChild(progress);

    try {
      // Hide UI elements that shouldn't appear in the PDF
      document.body.classList.add('pdf-exporting');
      const deleteButtons = overlay.querySelectorAll('.box-delete');
      deleteButtons.forEach(b => b.style.display = 'none');

      // Temporarily set container & SVG to full A1 size (1:1) for capture.
      // Model coordinates are already in A1-space so no repositioning needed.
      const savedScale = currentScale;
      pageContainer.style.width     = A1_WIDTH + 'px';
      pageContainer.style.minHeight = pageHeight + 'px';
      const svgEl = two.renderer.domElement;
      svgEl.setAttribute('viewBox', `0 0 ${A1_WIDTH} ${pageHeight}`);
      svgEl.setAttribute('width',  A1_WIDTH);
      svgEl.setAttribute('height', pageHeight);
      svgEl.style.width  = A1_WIDTH + 'px';
      svgEl.style.height = pageHeight + 'px';
      overlay.style.transform = 'scale(1)';
      overlay.style.width  = A1_WIDTH + 'px';
      overlay.style.height = pageHeight + 'px';

      // Capture the page container at 2× for quality
      const scaleFactor = 2;
      const canvas = await html2canvas(pageContainer, {
        scale: scaleFactor,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        width: A1_WIDTH,
        height: pageHeight,
      });

      // Restore scaled dimensions
      deleteButtons.forEach(b => b.style.display = '');
      document.body.classList.remove('pdf-exporting');
      fitToWindow();

      // How many A1 pages are needed vertically?
      const pageWidthPx  = A1_WIDTH * scaleFactor;
      const pageHeightPx = pageHeight * scaleFactor;

      // One A1 page maps to the full captured width;
      // derive the pixel height that corresponds to one A1 page.
      const pxPerMm      = pageWidthPx / A1_W_MM;
      const a1HeightPx   = A1_H_MM * pxPerMm;
      const totalPages   = Math.max(1, Math.ceil(pageHeightPx / a1HeightPx));

      // jsPDF: resolve the constructor from whichever global the UMD exposes
      const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF)
                     || (window.jspdf && window.jspdf.default)
                     || window.jsPDF;
      if (!jsPDFCtor) {
        throw new Error('jsPDF library failed to load. Check your internet connection and reload.');
      }
      const pdf = new jsPDFCtor({
        orientation: 'portrait',
        unit: 'mm',
        format: [A1_W_MM, A1_H_MM],
        compress: true,
      });

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage([A1_W_MM, A1_H_MM], 'portrait');

        // Slice the canvas for this page
        const srcY = page * a1HeightPx;
        const srcH = Math.min(a1HeightPx, pageHeightPx - srcY);

        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width  = pageWidthPx;
        sliceCanvas.height = srcH;
        const ctx = sliceCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, srcY, pageWidthPx, srcH, 0, 0, pageWidthPx, srcH);

        const imgData = sliceCanvas.toDataURL('image/png');
        const imgH_mm = (srcH / pxPerMm);

        pdf.addImage(imgData, 'PNG', 0, 0, A1_W_MM, imgH_mm, undefined, 'FAST');

        progress.textContent = `Rendering PDF… page ${page + 1} / ${totalPages}`;
        // Yield to let the browser paint the progress text
        await new Promise(r => setTimeout(r, 0));
      }

      pdf.save('talent_sheet.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed: ' + err.message);
    } finally {
      progress.remove();
    }
  }

  function loadJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);

      // Clear current state
      clearAll();

      // Restore meta
      if (data.meta) {
        globalFont   = data.meta.font   || 'sans-serif';
        globalStroke  = data.meta.strokeColor || '#444444';
        globalFill    = data.meta.fillColor   || '#f5f0e1';
        darkMode      = !!data.meta.darkMode;
        if (data.meta.gridCols) {
          gridCols = Math.max(1, Math.min(30, data.meta.gridCols));
          gridColsInput.value = gridCols;
        }
        if (data.meta.gridRows) {
          gridRows = Math.max(1, Math.min(100, data.meta.gridRows));
          gridRowsInput.value = gridRows;
        }
        if (data.meta.gridVGap != null) {
          GRID_VGAP = Math.max(0, Math.min(200, data.meta.gridVGap));
          vgapInput.value = GRID_VGAP;
        }
        if (data.meta.boxWidth) {
          boxW = Math.max(60, Math.min(600, data.meta.boxWidth));
          boxWInput.value = boxW;
        }
        if (data.meta.boxHeight) {
          boxH = Math.max(60, Math.min(600, data.meta.boxHeight));
          boxHInput.value = boxH;
        }
        if (data.meta.bridgeWidth != null) {
          bridgeWidth = Math.max(0.5, Math.min(20, data.meta.bridgeWidth));
          bridgeWInput.value = bridgeWidth;
        }
        recalcGrid();
        if (data.meta.sheetTitle) {
          sheetTitle.value = data.meta.sheetTitle;
        }
        applyTheme();
        fontSelect.value      = globalFont;
        colorStroke.value     = globalStroke;
        colorFill.value       = globalFill;
      }

      // Restore boxes
      if (data.boxes) {
        data.boxes.forEach(b => createBox(b));
      }

      // Restore bridges
      if (data.bridges) {
        data.bridges.forEach(b => createBridge(b));
      }

      expandPage();
    } catch (err) {
      alert('Invalid JSON file: ' + err.message);
    }
  }

  function clearAll() {
    boxes.forEach(b => {
      if (twoBoxShapes[b.id]) {
        two.remove(twoBoxShapes[b.id]);
      }
      delete twoBoxShapes[b.id];
      clearSideConnector(b.id);
    });
    bridges.forEach(b => {
      if (twoBridgeLines[b.id]) two.remove(twoBridgeLines[b.id]);
      delete twoBridgeLines[b.id];
    });
    boxes = [];
    bridges = [];
    bridgePending = null;
    // Remove only talent-box elements (preserve header & legend)
    overlay.querySelectorAll('.talent-box').forEach(el => el.remove());
    two.update();
  }

  /* Auto-save to localStorage */
  function autoSave() {
    try {
      localStorage.setItem('talentSheet', buildJSON());
    } catch (_) { /* quota or private mode */ }
  }

  function autoLoad() {
    try {
      const saved = localStorage.getItem('talentSheet');
      if (saved) {
        loadJSON(saved);
        return true;
      }
    } catch (_) { /* ignore */ }
    return false;
  }

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
  /*  Toolbar event wiring                                               */
  /* ------------------------------------------------------------------ */

  // --- Add Talent dropdown menu ---
  btnAddBox.addEventListener('click', (e) => {
    e.stopPropagation();
    addTalentMenu.classList.toggle('open');
  });

  addTalentMenu.querySelectorAll('button[data-type]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ttype = btn.dataset.type;
      addTalentMenu.classList.remove('open');
      const pos = findFreePosition();
      createBox({ x: pos.x, y: pos.y, talentType: ttype });
      expandPage();
      autoSave();
    });
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener('click', () => {
    addTalentMenu.classList.remove('open');
  });

  btnTheme.addEventListener('click', () => {
    darkMode = !darkMode;
    applyTheme();
    autoSave();
  });

  btnSave.addEventListener('click', () => {
    downloadJSON();
  });

  btnLoad.addEventListener('click', () => {
    fileInput.click();
  });

  btnExportPdf.addEventListener('click', () => {
    exportPDF();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      loadJSON(ev.target.result);
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  fontSelect.addEventListener('change', () => {
    globalFont = fontSelect.value;
    boxes.forEach(b => {
      b.font = globalFont;
      const el = document.getElementById('box-' + b.id);
      if (el) {
        el.querySelectorAll('.box-name, .box-description, .box-cost').forEach(f => {
          f.style.fontFamily = globalFont;
        });
      }
    });
    autoSave();
  });

  colorStroke.addEventListener('input', () => {
    globalStroke = colorStroke.value;
    boxes.forEach(b => {
      b.strokeColor = globalStroke;
      updateBoxShape(b);
    });
    autoSave();
  });

  colorFill.addEventListener('input', () => {
    globalFill = colorFill.value;
    boxes.forEach(b => {
      b.fillColor = globalFill;
      updateBoxShape(b);
    });
    autoSave();
  });

  /** Shared helper: after any grid/dimension change, re-snap & redraw */
  function refreshGrid() {
    recalcGrid();
    boxes.forEach(b => {
      b.w = boxW;                       // apply new box width
      if (b.h <= boxH || b.h <= DEFAULT_BOX_H) b.h = boxH;  // apply new box height
      b.x = snapX(b.x);
      b.y = snapY(b.y);
      const el = document.getElementById('box-' + b.id);
      if (el) {
        el.style.left   = b.x + 'px';
        el.style.top    = b.y + 'px';
        el.style.width  = b.w + 'px';
        el.style.height = b.h + 'px';
      }
      updateBoxShape(b);
    });
    // Reconcile all bridges after all boxes have snapped
    reconcileAllBridges();
    drawPageMargins();
    two.update();
    autoSave();
  }

  gridColsInput.addEventListener('change', () => {
    const val = parseInt(gridColsInput.value, 10);
    if (isNaN(val) || val < 1) { gridColsInput.value = gridCols; return; }
    gridCols = Math.max(1, Math.min(30, val));
    gridColsInput.value = gridCols;
    refreshGrid();
  });

  gridRowsInput.addEventListener('change', () => {
    const val = parseInt(gridRowsInput.value, 10);
    if (isNaN(val) || val < 1) { gridRowsInput.value = gridRows; return; }
    gridRows = Math.max(1, Math.min(100, val));
    gridRowsInput.value = gridRows;
    refreshGrid();
  });

  vgapInput.addEventListener('change', () => {
    const val = parseInt(vgapInput.value, 10);
    if (isNaN(val) || val < 0) { vgapInput.value = GRID_VGAP; return; }
    GRID_VGAP = Math.max(0, Math.min(200, val));
    vgapInput.value = GRID_VGAP;
    refreshGrid();
  });

  boxWInput.addEventListener('change', () => {
    const val = parseInt(boxWInput.value, 10);
    if (isNaN(val) || val < 60) { boxWInput.value = boxW; return; }
    boxW = Math.max(60, Math.min(600, val));
    boxWInput.value = boxW;
    refreshGrid();
  });

  boxHInput.addEventListener('change', () => {
    const val = parseInt(boxHInput.value, 10);
    if (isNaN(val) || val < 60) { boxHInput.value = boxH; return; }
    boxH = Math.max(60, Math.min(600, val));
    boxHInput.value = boxH;
    refreshGrid();
  });

  bridgeWInput.addEventListener('change', () => {
    const val = parseFloat(bridgeWInput.value);
    if (isNaN(val) || val < 0.5) { bridgeWInput.value = bridgeWidth; return; }
    bridgeWidth = Math.max(0.5, Math.min(20, val));
    bridgeWInput.value = bridgeWidth;
    bridges.forEach(b => renderBridge(b));
    two.update();
    autoSave();
  });

  sheetTitle.addEventListener('input', () => {
    autoSave();
  });

  /* ------------------------------------------------------------------ */
  /*  Keyboard shortcut: Escape cancels bridge mode                      */
  /* ------------------------------------------------------------------ */

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bridgePending) {
      const prevEl = document.getElementById('box-' + bridgePending.boxId);
      if (prevEl) prevEl.style.outline = '';
      bridgePending = null;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  fitToWindow();   // set scale & sizes before any drawing

  if (!autoLoad()) {
    // Start with one empty box so the user sees something
    createBox({ x: gridX(0), y: gridY(0) });
    autoSave();
  }

  drawPageMargins();
  fitToWindow();   // recalc after content may have changed page height
  two.update();
})();
