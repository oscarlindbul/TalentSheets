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
    return Math.round(w * env.CHAMFER_PCT);
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
  /*  Create / render a single talent box                                */
  /* ------------------------------------------------------------------ */

  function createBox(data) {
    const box = Object.assign({
      id:          env.nextBoxId++,
      x:           env.gridX(0),
      y:           env.gridY(0),
      w:           env.boxW,
      h:           env.boxH,
      talentType:  'active',
      name:        'Talent',
      description: '',
      cost:        '0',
      acquired:    false,
      ranked:      false,
      font:        env.globalFont,
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
    el.style.height = box.h + 'px';
    el.style.setProperty('--chamfer', chamfer(box.w) + 'px');
    el.dataset.boxId = box.id;

    el.innerHTML = `
      <button class="box-delete" title="Delete">&times;</button>
      <div class="box-header">
        <input type="checkbox" class="box-checkbox" ${box.acquired ? 'checked' : ''} title="Acquired">
        <textarea class="box-name" rows="1" placeholder="Name" style="font-family:${box.font}">${env.escHtml(box.name)}</textarea>
      </div>
      <div class="box-body">
        <textarea class="box-description" placeholder="Description…" style="font-family:${box.font}">${env.escHtml(box.description)}</textarea>
        <div class="box-ranked-row">
          <div class="ranked-indicator ${box.ranked ? 'ranked' : ''}" title="Toggle ranked talent">
            <span class="ranked-cell"></span><span class="ranked-cell"></span>
            <span class="ranked-cell"></span><span class="ranked-cell"></span>
          </div>
        </div>
      </div>
      <span class="box-cost" style="font-family:${box.font}">${env.escHtml(box.cost)}</span>`;

    env.overlay.appendChild(el);
    bindBoxEvents(el, box);

    env.two.update();
  }

  /* ------------------------------------------------------------------ */
  /*  Bind overlay events for a box                                      */
  /* ------------------------------------------------------------------ */

  function bindBoxEvents(el, box) {
    // --- Delete ---
    el.querySelector('.box-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      removeBox(box.id);
    });

    // --- Checkbox (acquired) ---
    el.querySelector('.box-checkbox').addEventListener('change', (e) => {
      box.acquired = e.target.checked;
      env.autoSave();
    });

    // --- Name (auto-grow header on wrap) ---
    const nameInput = el.querySelector('.box-name');
    function autoSizeName() {
      nameInput.style.height = '0';
      nameInput.style.height = nameInput.scrollHeight + 'px';
    }
    autoSizeName();  // initial sizing
    nameInput.addEventListener('input', () => {
      box.name = nameInput.value;
      autoSizeName();
      growBoxToFit(box, el);
      env.autoSave();
    });

    // --- Description (auto-grow) ---
    const descArea = el.querySelector('.box-description');
    descArea.addEventListener('input', () => {
      box.description = descArea.value;
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
      // Don't drag when clicking interactive elements or side connectors
      if (e.target.closest('input, textarea, button, .ranked-indicator, .box-cost, .side-connector')) return;
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
      box.x = Math.max(0, startBX + dx);
      box.y = Math.max(0, startBY + dy);
      el.style.left = box.x + 'px';
      el.style.top  = box.y + 'px';
      updateBoxShape(box);
      env.updateBridgesFor(box.id);
      env.expandPage();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      // Snap to grid
      box.x = env.snapX(box.x);
      box.y = env.snapY(box.y);
      el.style.left = box.x + 'px';
      el.style.top  = box.y + 'px';
      updateBoxShape(box);
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
    env.twoBoxShapes[box.id] = shape;
    env.two.update();
  }

  /* ------------------------------------------------------------------ */
  /*  Auto-grow box height to fit description text                       */
  /* ------------------------------------------------------------------ */

  function growBoxToFit(box, el) {
    const descArea = el.querySelector('.box-description');

    // Temporarily collapse to minimum so scrollHeight reflects true content
    el.style.height = env.boxH + 'px';
    descArea.style.height = '0';
    descArea.style.height = descArea.scrollHeight + 'px';
    const needed = descArea.scrollHeight;

    const headerH  = el.querySelector('.box-header').offsetHeight;
    const rankedH  = el.querySelector('.box-ranked-row') ? el.querySelector('.box-ranked-row').offsetHeight : 0;
    const pad      = 30; // total vertical padding
    const newH     = Math.max(env.boxH, headerH + needed + rankedH + pad);

    if (newH !== box.h) {
      box.h = newH;
      el.style.height = newH + 'px';
      updateBoxShape(box);
      env.updateBridgesFor(box.id);
      env.expandPage();
    } else {
      el.style.height = box.h + 'px';
    }
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

    env.boxes = env.boxes.filter(b => b.id !== id);
    env.two.update();
    env.reconcileAllBridges();
    env.autoSave();
  }

  /* ------------------------------------------------------------------ */
  /*  Find a free grid position (first that doesn't overlap)             */
  /* ------------------------------------------------------------------ */

  function findFreePosition() {
    for (let row = 0; row < 100; row++) {
      for (let col = 0; col < env.gridCols; col++) {
        const x = env.gridX(col);
        const y = env.gridY(row);
        const occupied = env.boxes.some(b =>
          Math.abs(b.x - x) < env.boxW / 2 && Math.abs(b.y - y) < env.boxH / 2
        );
        if (!occupied) return { x, y };
      }
    }
    return { x: env.gridX(0), y: env.gridY(0) };
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
  };
};
