/**
 * JSON Utilities Module — json-utils.js
 *
 * Serialisation, download, load-from-file, auto-save (localStorage),
 * auto-load, and clearAll logic for the Talent Sheet.
 *
 * Exposes: window.createJsonUtilsModule(env) → {
 *   buildJSON, downloadJSON, loadJSON, clearAll, autoSave, autoLoad
 * }
 *
 * `env` is the shared dependency object supplied by app.js.
 */
window.createJsonUtilsModule = function (env) {
  'use strict';

  const TEXT_AUTOSAVE_INTERVAL_MS = 60 * 1000;
  let pendingTextAutoSave = false;
  let textAutoSaveTimer = null;

  /* ------------------------------------------------------------------ */
  /*  Build JSON string                                                  */
  /* ------------------------------------------------------------------ */

  function buildJSON() {
    return JSON.stringify({
      meta: {
        font:             env.globalFont,
        fontSize:         env.globalFontSize,
        fontColor:        env.globalFontColor,
        bold:             env.globalBold,
        italic:           env.globalItalic,
        strokeColor:      env.globalStroke,
        fillColor:        env.globalFill,
        bridgeColor:      env.bridgeColor,
        darkMode:         env.darkMode,
        boxWidth:         env.boxW,
        boxHeight:        env.boxH,
        bridgeWidth:      env.bridgeWidth,
        titleTextFieldId: env.titleTextFieldId,
      },
      boxes:      env.boxes,
      bridges:    env.bridges,
      dashedLines: env.dashedLines,
      textFields: env.textFields,
      legendPos:  env.legendPos,
      legendSize: env.legendSize,
    }, null, 2);
  }

  /* ------------------------------------------------------------------ */
  /*  Download JSON file                                                 */
  /* ------------------------------------------------------------------ */

  function downloadJSON() {
    const blob = new Blob([buildJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'talent_sheet.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ------------------------------------------------------------------ */
  /*  Load JSON string (restore full state)                              */
  /* ------------------------------------------------------------------ */

  function loadJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);

      // Clear current state
      clearAll();

      // Restore meta
      if (data.meta) {
        env.globalFont     = data.meta.font        || 'sans-serif';
        env.globalFontSize = data.meta.fontSize     || 13;
        env.globalFontColor = data.meta.fontColor   || '#222222';
        env.globalBold     = !!data.meta.bold;
        env.globalItalic   = !!data.meta.italic;
        env.globalStroke   = data.meta.strokeColor  || '#444444';
        env.globalFill     = data.meta.fillColor    || '#f5f0e1';
        env.bridgeColor    = data.meta.bridgeColor  || '#666666';
        env.darkMode       = !!data.meta.darkMode;

        if (data.meta.boxWidth) {
          env.boxW = Math.max(60, Math.min(600, data.meta.boxWidth));
          env.boxWInput.value = env.boxW;
        }
        if (data.meta.boxHeight) {
          env.boxH = Math.max(60, Math.min(600, data.meta.boxHeight));
          env.boxHInput.value = env.boxH;
        }
        if (data.meta.bridgeWidth != null) {
          env.bridgeWidth = Math.max(0.5, Math.min(20, data.meta.bridgeWidth));
          env.bridgeWInput.value = env.bridgeWidth;
        }

        if (data.meta.titleTextFieldId != null) {
          env.titleTextFieldId = data.meta.titleTextFieldId;
        }

        env.applyTheme();

        env.fontSelect.value        = env.globalFont;
        env.fontSizeInput.value     = env.globalFontSize;
        env.colorFont.value         = env.globalFontColor;
        env.fontBoldInput.checked   = env.globalBold;
        env.fontItalicInput.checked = env.globalItalic;
        env.colorStroke.value       = env.globalStroke;
        env.colorFill.value         = env.globalFill;
        env.colorBridge.value       = env.bridgeColor;
      }

      // Restore boxes
      if (data.boxes) {
        data.boxes.forEach(b => env.createBox(b));
      }

      // Restore bridges
      if (data.bridges) {
        data.bridges.forEach(b => env.createBridge(b));
      }

      // Restore dashed lines
      if (data.dashedLines) {
        data.dashedLines.forEach(line => env.createDashedLine(line));
      }

      // Restore text fields
      if (data.textFields) {
        data.textFields.forEach(tf => env.createTextField(tf));
      }

      // Restore legend position
      if (data.legendPos) {
        env.legendPos = data.legendPos;
      }
      if (data.legendSize) {
        env.legendSize = data.legendSize;
      }
      env.positionLegend();
      env.applyFontToLegend();

      env.expandPage();
    } catch (err) {
      alert('Invalid JSON file: ' + err.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Clear all state                                                    */
  /* ------------------------------------------------------------------ */

  function clearAll() {
    // Remove all tracked shapes from Two.js
    Object.values(env.twoBoxShapes).forEach(shape => {
      if (shape) env.two.remove(shape);
    });
    Object.values(env.twoBridgeLines).forEach(shape => {
      if (shape) env.two.remove(shape);
    });
    Object.values(env.twoDashedLines).forEach(shape => {
      if (shape) env.two.remove(shape);
    });

    // Two.js group can still retain stale dashed children not present in map
    if (env.dashedLineGroup && Array.isArray(env.dashedLineGroup.children)) {
      const children = env.dashedLineGroup.children.slice();
      children.forEach(shape => {
        env.dashedLineGroup.remove(shape);
        env.two.remove(shape);
      });
    }

    // Clear all shape tracking maps
    Object.keys(env.twoBoxShapes).forEach(key => delete env.twoBoxShapes[key]);
    Object.keys(env.twoBridgeLines).forEach(key => delete env.twoBridgeLines[key]);
    Object.keys(env.twoDashedLines).forEach(key => delete env.twoDashedLines[key]);

    env.boxes      = [];
    env.bridges    = [];
    env.dashedLines = [];
    env.textFields = [];
    env.nextDashedLineId = 1;
    env.nextTextFieldId  = 1;
    env.titleTextFieldId = null;
    env.bridgePending    = null;
    env.clearDashedLinePreview();
    env.clearObjectSelection();

    // Remove talent-box and text-field elements (preserve legend)
    env.overlay.querySelectorAll('.talent-box, .text-field, .box-bg-image').forEach(el => el.remove());
    env.two.update();
  }

  /* ------------------------------------------------------------------ */
  /*  IndexedDB helpers for large auto-save data                         */
  /* ------------------------------------------------------------------ */

  const IDB_NAME = 'TalentSheetDB';
  const IDB_STORE = 'state';
  const IDB_KEY = 'talentSheet';

  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbSet(key, value) {
    return openIDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  }

  function idbGet(key) {
    return openIDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    }));
  }

  /* ------------------------------------------------------------------ */
  /*  Auto-save / auto-load (IndexedDB primary, localStorage fallback)   */
  /* ------------------------------------------------------------------ */

  function autoSave() {
    pendingTextAutoSave = false;
    if (textAutoSaveTimer) {
      clearTimeout(textAutoSaveTimer);
      textAutoSaveTimer = null;
    }

    const json = buildJSON();
    // Save to IndexedDB (handles large image data)
    idbSet(IDB_KEY, json).catch(() => {});
    // Also try localStorage as a fallback
    try {
      localStorage.setItem('talentSheet', json);
    } catch (_) {
      // Quota exceeded — strip image data for localStorage copy
      try {
        const data = JSON.parse(json);
        if (data.boxes) {
          data.boxes.forEach(b => {
            if (b.bgImage && b.bgImage.src) {
              b.bgImage = { ratioW: b.bgImage.ratioW, ratioH: b.bgImage.ratioH, ratio: b.bgImage.ratio };
            }
          });
        }
        localStorage.setItem('talentSheet', JSON.stringify(data));
      } catch (_2) { /* private mode or still too large */ }
    }
  }

  function scheduleTextAutoSave(delayMs) {
    pendingTextAutoSave = true;
    if (textAutoSaveTimer) return;

    textAutoSaveTimer = setTimeout(() => {
      textAutoSaveTimer = null;
      if (!pendingTextAutoSave) return;
      autoSave();
    }, typeof delayMs === 'number' ? delayMs : TEXT_AUTOSAVE_INTERVAL_MS);
  }

  function flushScheduledAutoSave() {
    if (!pendingTextAutoSave) return;
    autoSave();
  }

  function autoLoad() {
    // autoLoad is called synchronously at boot, so we try localStorage
    // first (sync), then upgrade from IndexedDB (async) if it has
    // richer data (e.g. with embedded images).
    let loaded = false;
    try {
      const saved = localStorage.getItem('talentSheet');
      if (saved) {
        loadJSON(saved);
        loaded = true;
      }
    } catch (_) { /* ignore */ }

    // Async: check IndexedDB for a version with image data
    idbGet(IDB_KEY).then(saved => {
      if (!saved) return;
      // Only reload from IDB if it has image data that localStorage lost
      try {
        const idbData = JSON.parse(saved);
        const hasImages = idbData.boxes && idbData.boxes.some(
          b => b.bgImage && b.bgImage.src
        );
        if (hasImages) {
          loadJSON(saved);
        }
      } catch (_) { /* ignore parse errors */ }
    }).catch(() => {});

    return loaded;
  }

  window.addEventListener('beforeunload', flushScheduledAutoSave);
  window.addEventListener('pagehide', flushScheduledAutoSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushScheduledAutoSave();
  });

  return {
    buildJSON,
    downloadJSON,
    loadJSON,
    clearAll,
    autoSave,
    autoLoad,
    scheduleTextAutoSave,
    flushScheduledAutoSave,
  };
};
