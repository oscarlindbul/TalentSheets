/**
 * Box Module — box.js
 *
 * Talent box creation, rendering, overlay events, shape updates,
 * auto-grow, removal, and free-position search.
 *
 * Exposes: window.createBoxModule(env) → {
 *   createBox, renderBox, updateBoxShape, growBoxToFit,
 *   removeBox, findFreePosition, makeChamferedRect, chamfer
 * }
 *
 * `env` is the shared dependency object supplied by app.js.
 */

window.createBoxModule = function (env) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Chamfer helper                                                     */
  /* ------------------------------------------------------------------ */

  function chamfer(w) {
    return w * env.CHAMFER_PCT;
  }

  /* ------------------------------------------------------------------ */
  /*  Helper — draw a chamfered rectangle in Two.js                      */
  /*  Indented (chamfered) corners: lower-left and upper-right           */
  /* ------------------------------------------------------------------ */

  function makeChamferedRect(x, y, w, h, c, strokeColor, fillColor) {
    c = Math.min(c, w / 4, h / 4);

    // Vertices clockwise from top-left
    const anchors = [
      new Two.Anchor(x,         y,             0,0,0,0, Two.Commands.move),   // TL
      new Two.Anchor(x + w - c, y,             0,0,0,0, Two.Commands.line),   // before TR chamfer
      new Two.Anchor(x + w,     y + c,         0,0,0,0, Two.Commands.line),   // after  TR chamfer
      new Two.Anchor(x + w,     y + h,         0,0,0,0, Two.Commands.line),   // BR
      new Two.Anchor(x + c,     y + h,         0,0,0,0, Two.Commands.line),   // before BL chamfer
      new Two.Anchor(x,         y + h - c,     0,0,0,0, Two.Commands.line),   // after  BL chamfer
    ];

    const path = env.two.makePath(anchors, true);
    path.closed    = true;
    path.curved    = false;
    path.automatic = false;
    path.fill      = fillColor;
    path.stroke    = strokeColor;
    path.linewidth = 2;

    return path;
  }

  /* ------------------------------------------------------------------ */
  /*  Background image rendering                                         */
  /* ------------------------------------------------------------------ */

  function renderBgImage(box) {
    let el = document.getElementById('box-bg-' + box.id);

    if (!box.bgImage || !box.bgImage.src) {
      if (el) el.remove();
      return;
    }

    if (!el) {
      el = document.createElement('div');
      el.className = 'box-bg-image';
      el.id = 'box-bg-' + box.id;
      const img = document.createElement('img');
      img.src = box.bgImage.src;
      img.draggable = false;
      el.appendChild(img);

      const handle = document.createElement('div');
      handle.className = 'bg-resize-handle';
      handle.title = 'Resize image';
      el.appendChild(handle);

      const del = document.createElement('button');
      del.className = 'bg-delete';
      del.title = 'Remove image';
      del.innerHTML = '&times;';
      el.appendChild(del);

      env.overlay.appendChild(el);
      bindBgImageEvents(el, box);
    }

    // Update position and size (centered on box, scaled by ratios)
    const ratioW = box.bgImage.ratioW != null ? box.bgImage.ratioW : (box.bgImage.ratio || 1.2);
    const ratioH = box.bgImage.ratioH != null ? box.bgImage.ratioH : (box.bgImage.ratio || 1.2);
    const imgW = box.w * ratioW;
    const imgH = box.h * ratioH;
    const imgX = box.x + (box.w - imgW) / 2;
    const imgY = box.y + (box.h - imgH) / 2;

    el.style.left   = imgX + 'px';
    el.style.top    = imgY + 'px';
    el.style.width  = imgW + 'px';
    el.style.height = imgH + 'px';
  }

  function bindBgImageEvents(el, box) {
    // Delete image
    el.querySelector('.bg-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      box.bgImage = null;
      el.remove();
      env.autoSave();
    });

    // Resize (adjust width/height ratios independently by dragging lower-right corner, stays centered)
    const resizeHandle = el.querySelector('.bg-resize-handle');
    let resizing = false, startMX, startMY, startRatioW, startRatioH;

    resizeHandle.addEventListener('mousedown', (e) => {
      resizing = true;
      startMX = e.clientX;
      startMY = e.clientY;
      startRatioW = box.bgImage.ratioW != null ? box.bgImage.ratioW : (box.bgImage.ratio || 1.2);
      startRatioH = box.bgImage.ratioH != null ? box.bgImage.ratioH : (box.bgImage.ratio || 1.2);
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = (e.clientX - startMX) / env.currentScale;
      const dy = (e.clientY - startMY) / env.currentScale;
      box.bgImage.ratioW = Math.max(0.3, startRatioW + dx / box.w);
      box.bgImage.ratioH = Math.max(0.3, startRatioH + dy / box.h);
      renderBgImage(box);
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      env.autoSave();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Create / render a single talent box                                */
  /* ------------------------------------------------------------------ */

  function createBox(data) {
    const box = Object.assign({
      id:          env.nextBoxId++,
      x:           50,
      y:           150,
      w:           env.boxW,
      h:           env.boxH,
      talentType:  'active',
      name:        'Talent',
      description: '',
      cost:        '0',
      acquired:    false,
      ranked:      false,
      font:        env.globalFont,
      costFont:    env.globalFont,
      costFontSize: 13,
      fontSize:    env.globalFontSize,
      bold:        false,
      italic:      false,
      strokeColor: env.globalStroke,
      fillColor:   env.globalFill,
    }, data);

    if (data && data.id && data.id >= env.nextBoxId) {
      env.nextBoxId = data.id + 1;
    }

    env.boxes.push(box);
    renderBox(box);
    env.reconcileAllBridges();
    return box;
  }

  function renderBox(box) {
    // --- Two.js shape ---
    if (env.twoBoxShapes[box.id]) {
      env.two.remove(env.twoBoxShapes[box.id]);
    }
    const fill   = env.darkMode ? env.darken(box.fillColor) : box.fillColor;
    const stroke = env.darkMode ? env.lighten(box.strokeColor) : box.strokeColor;
    const shape  = makeChamferedRect(box.x, box.y, box.w, box.h, chamfer(box.w), stroke, fill);
    env.twoBoxShapes[box.id] = shape;

    // --- HTML overlay ---
    let el = document.getElementById('box-' + box.id);
    if (el) el.remove();

    el = document.createElement('div');
    el.className = `talent-box talent-${box.talentType || 'active'}`;
    el.id = 'box-' + box.id;
    el.style.left   = box.x + 'px';
    el.style.top    = box.y + 'px';
    el.style.width  = box.w + 'px';
    el.style.setProperty('--box-fill-color', fill);
    el.style.setProperty('--box-stroke-color', stroke);
    el.style.height = box.h + 'px';
    const clampedChamfer = Math.min(chamfer(box.w), box.w / 4, box.h / 4);
    el.style.setProperty('--chamfer', clampedChamfer + 'px');
    //el.style.setProperty('--chamfer-perc', env.CHAMFER_PCT*100 + '%');
    el.dataset.boxId = box.id;

    const costFs = box.costFontSize || 13;
    const triSize = Math.max(45, costFs * 3.2 + 4);   // grow triangle for large text
    el.style.setProperty('--tri-size', triSize + 'px');

    el.innerHTML = `
      <button class="box-delete" title="Delete">&times;</button>
      <button class="box-add-bg" title="Set background image">&#8862;</button>
      <input type="file" class="box-bg-input" accept="image/*" style="display:none">
      <div class="box-header">
        <input type="checkbox" class="box-checkbox" ${box.acquired ? 'checked' : ''} title="Acquired">
        <div class="box-name" contenteditable="true" role="textbox" data-placeholder="Name" style="font-family:${box.font}; font-size:${box.fontSize}px; font-weight:${box.bold ? 'bold' : 'normal'}; font-style:${box.italic ? 'italic' : 'normal'}">${box.name}</div>
      </div>
      <div class="box-body">
        <div class="box-description" contenteditable="true" role="textbox" data-placeholder="Description\u2026" style="font-family:${box.font}; font-size:${box.fontSize}px; font-weight:${box.bold ? 'bold' : 'normal'}; font-style:${box.italic ? 'italic' : 'normal'}">${box.description}</div>
        <div class="box-ranked-row">
          <div class="ranked-indicator ${box.ranked ? 'ranked' : ''}" title="Toggle ranked talent">
            <span class="ranked-cell"></span><span class="ranked-cell"></span>
            <span class="ranked-cell"></span><span class="ranked-cell"></span>
          </div>
        </div>
      </div>
      <span class="box-cost" style="font-family:${box.costFont || box.font}; font-size:${box.costFontSize || 13}px">${env.escHtml(box.cost)}</span>
      <div class="box-resize-handle" title="Resize"></div>`;

    env.overlay.appendChild(el);
    bindBoxEvents(el, box);

    env.two.update();
    renderBgImage(box);
  }

  /* ------------------------------------------------------------------ */
  /*  Bind overlay events for a box                                      */
  /* ------------------------------------------------------------------ */

  function bindBoxEvents(el, box) {
    // --- Focus tracking (used by font/size toolbar to target a single box) ---
    el.addEventListener('focusin', (e) => {
      env.focusedBoxId = box.id;
      env.focusedTextFieldId = null;
      // Detect if the cost span specifically received focus
      const isCostFocus = e.target.closest('.box-cost') != null;
      env.focusedCostBoxId = isCostFocus ? box.id : null;
      env.onBoxFocus(box, isCostFocus);
    });
    el.addEventListener('focusout', (e) => {
      // Only clear if focus leaves this box entirely
      if (!el.contains(e.relatedTarget)) {
        if (env.focusedBoxId === box.id) {
          env.focusedBoxId = null;
          env.onBoxBlur();
        }
      }
    });

    // --- Delete ---
    el.querySelector('.box-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      removeBox(box.id);
    });

    // --- Background image import ---
    el.querySelector('.box-add-bg').addEventListener('click', (e) => {
      e.stopPropagation();
      el.querySelector('.box-bg-input').click();
    });
    el.querySelector('.box-bg-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const oldRatioW = (box.bgImage && box.bgImage.ratioW != null) ? box.bgImage.ratioW : ((box.bgImage && box.bgImage.ratio) || 1.2);
        const oldRatioH = (box.bgImage && box.bgImage.ratioH != null) ? box.bgImage.ratioH : ((box.bgImage && box.bgImage.ratio) || 1.2);
        box.bgImage = { src: ev.target.result, ratioW: oldRatioW, ratioH: oldRatioH };
        // Remove existing bg element so renderBgImage creates a fresh one
        const bgEl = document.getElementById('box-bg-' + box.id);
        if (bgEl) bgEl.remove();
        renderBgImage(box);
        env.autoSave();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    // --- Checkbox (acquired) ---
    el.querySelector('.box-checkbox').addEventListener('change', (e) => {
      box.acquired = e.target.checked;
      env.autoSave();
    });

    // --- Name (auto-grow header on wrap) ---
    const nameInput = el.querySelector('.box-name');
    nameInput.addEventListener('input', () => {
      box.name = nameInput.innerHTML;
      growBoxToFit(box, el);
      env.autoSave();
    });

    // --- Description (auto-grow) ---
    const descArea = el.querySelector('.box-description');
    descArea.addEventListener('input', () => {
      box.description = descArea.innerHTML;
      growBoxToFit(box, el);
      env.autoSave();
    });

    // --- Cost (contenteditable span) ---
    const costSpan = el.querySelector('.box-cost');
    costSpan.contentEditable = 'true';
    costSpan.addEventListener('input', () => {
      box.cost = costSpan.textContent;
      env.autoSave();
    });

    // --- Ranked toggle ---
    el.querySelector('.ranked-indicator').addEventListener('click', () => {
      box.ranked = !box.ranked;
      el.querySelector('.ranked-indicator').classList.toggle('ranked', box.ranked);
      env.autoSave();
    });

    // --- Drag ---
    let dragging = false, startMX, startMY, startBX, startBY;

    el.addEventListener('mousedown', (e) => {
      // Don't drag when clicking interactive elements, side connectors, or resize handle
      if (e.target.closest('input, [contenteditable], button, .ranked-indicator, .box-cost, .side-connector, .box-resize-handle')) return;
      dragging = true;
      startMX = e.clientX;
      startMY = e.clientY;
      startBX = box.x;
      startBY = box.y;
      el.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startMX) / env.currentScale;
      const dy = (e.clientY - startMY) / env.currentScale;
      let newX = Math.max(0, startBX + dx);
      let newY = Math.max(0, startBY + dy);

      // Snap-to-center alignment
      const dragCx = newX + box.w / 2;
      const dragCy = newY + box.h / 2;
      const SNAP = env.SNAP_THRESHOLD;
      let snapV = null, snapH = null;

      for (const other of env.boxes) {
        if (other.id === box.id) continue;
        const otherCx = other.x + other.w / 2;
        const otherCy = other.y + other.h / 2;
        if (snapV == null && Math.abs(dragCx - otherCx) < SNAP) {
          newX = otherCx - box.w / 2;
          snapV = otherCx;
        }
        if (snapH == null && Math.abs(dragCy - otherCy) < SNAP) {
          newY = otherCy - box.h / 2;
          snapH = otherCy;
        }
      }

      box.x = newX;
      box.y = newY;
      el.style.left = box.x + 'px';
      el.style.top  = box.y + 'px';
      updateBoxShape(box);
      env.updateBridgesFor(box.id);
      env.expandPage();
      env.showSnapGuides(snapV, snapH);
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      env.hideSnapGuides();
      env.reconcileAllBridges();
      env.autoSave();
    });

    // --- Resize (lower-right corner) ---
    const resizeHandle = el.querySelector('.box-resize-handle');
    let resizing = false, resizeStartMX, resizeStartMY, resizeStartW, resizeStartH;

    resizeHandle.addEventListener('mousedown', (e) => {
      resizing = true;
      resizeStartMX = e.clientX;
      resizeStartMY = e.clientY;
      resizeStartW = box.w;
      resizeStartH = box.h;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = (e.clientX - resizeStartMX) / env.currentScale;
      const dy = (e.clientY - resizeStartMY) / env.currentScale;
      box.w = Math.max(80, resizeStartW + dx);
      box.h = Math.max(60, resizeStartH + dy);
      el.style.width  = box.w + 'px';
      el.style.height = box.h + 'px';
      const clampedChamfer = Math.min(chamfer(box.w), box.w / 4, box.h / 4);
      el.style.setProperty('--chamfer', clampedChamfer + 'px');
      const costFs = box.costFontSize || 13;
      const triSize = Math.max(45, costFs * 3.2 + 4);
      el.style.setProperty('--tri-size', triSize + 'px');
      updateBoxShape(box);
      env.updateBridgesFor(box.id);
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      env.reconcileAllBridges();
      env.autoSave();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Update Two.js shape for a box in-place                             */
  /* ------------------------------------------------------------------ */

  function updateBoxShape(box) {
    if (env.twoBoxShapes[box.id]) {
      env.two.remove(env.twoBoxShapes[box.id]);
    }
    const fill   = env.darkMode ? env.darken(box.fillColor) : box.fillColor;
    const stroke = env.darkMode ? env.lighten(box.strokeColor) : box.strokeColor;
    const shape  = makeChamferedRect(box.x, box.y, box.w, box.h, chamfer(box.w), stroke, fill);
    const el = document.getElementById('box-' + box.id);
    const clampedChamfer = Math.min(chamfer(box.w), box.w / 4, box.h / 4);
    el.style.setProperty('--chamfer', clampedChamfer + 'px');
    el.style.setProperty('--box-fill-color', fill);
    el.style.setProperty('--box-stroke-color', stroke);
    env.twoBoxShapes[box.id] = shape;
    env.two.update();
    renderBgImage(box);
  }

  /* ------------------------------------------------------------------ */
  /*  Auto-grow box height to fit description text                       */
  /* ------------------------------------------------------------------ */

  function growBoxToFit(box, el) {
    const descArea = el.querySelector('.box-description');

    // Pull textarea out of flex flow so we can measure true content height.
    // position:absolute removes it from flex; width is locked so wrapping
    // stays the same; height & min-height are zeroed so scrollHeight
    // reports only the content.
    const measuredW = descArea.offsetWidth;
    descArea.style.position  = 'absolute';
    descArea.style.width     = measuredW + 'px';
    descArea.style.height    = '0px';
    descArea.style.minHeight = '0px';
    void descArea.offsetHeight;                       // force reflow
    const needed = descArea.scrollHeight;
    // Restore — clear all inline overrides so CSS rules apply again
    descArea.style.position  = '';
    descArea.style.width     = '';
    descArea.style.height    = '';
    descArea.style.minHeight = '';

    const headerH  = el.querySelector('.box-header').offsetHeight;
    const rankedH  = el.querySelector('.box-ranked-row') ? el.querySelector('.box-ranked-row').offsetHeight : 0;
    const pad      = 30; // total vertical padding
    const newH     = Math.max(60, headerH + needed + rankedH + pad);

    box.h = newH;
    el.style.height = newH + 'px';
    updateBoxShape(box);
    env.updateBridgesFor(box.id);
    env.expandPage();
  }

  /* ------------------------------------------------------------------ */
  /*  Remove a box                                                       */
  /* ------------------------------------------------------------------ */

  function removeBox(id) {
    // Remove bridges connected to this box
    env.bridges = env.bridges.filter(b => {
      if (b.fromId === id || b.toId === id) {
        if (env.twoBridgeLines[b.id]) {
          env.two.remove(env.twoBridgeLines[b.id]);
          delete env.twoBridgeLines[b.id];
        }
        return false;
      }
      return true;
    });

    // Remove Two.js shape
    if (env.twoBoxShapes[id]) {
      env.two.remove(env.twoBoxShapes[id]);
      delete env.twoBoxShapes[id];
    }
    env.clearSideConnector(id);

    // Remove overlay
    const el = document.getElementById('box-' + id);
    if (el) el.remove();

    // Remove background image
    const bgEl = document.getElementById('box-bg-' + id);
    if (bgEl) bgEl.remove();

    env.boxes = env.boxes.filter(b => b.id !== id);
    env.two.update();
    env.reconcileAllBridges();
    env.autoSave();
  }

  /* ------------------------------------------------------------------ */
  /*  Find a free grid position (first that doesn't overlap)             */
  /* ------------------------------------------------------------------ */

  function findFreePosition() {
    const defW = env.boxW;
    const defH = env.boxH;
    const startX = 60;
    const startY = 150;
    const cols = Math.max(1, Math.floor((2200 - startX) / (defW + 20)));

    for (let row = 0; row < 100; row++) {
      for (let col = 0; col < cols; col++) {
        const x = startX + col * (defW + 20);
        const y = startY + row * (defH + 20);
        const occupied = env.boxes.some(b =>
          x < b.x + b.w + 10 && x + defW + 10 > b.x &&
          y < b.y + b.h + 10 && y + defH + 10 > b.y
        );
        if (!occupied) return { x, y };
      }
    }
    return { x: startX, y: startY };
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  return {
    createBox,
    renderBox,
    updateBoxShape,
    growBoxToFit,
    removeBox,
    findFreePosition,
    makeChamferedRect,
    chamfer,
    renderBgImage,
  };
};
