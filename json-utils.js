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

  /* ------------------------------------------------------------------ */
  /*  Build JSON string                                                  */
  /* ------------------------------------------------------------------ */

  function buildJSON() {
    return JSON.stringify({
      meta: {
        font:             env.globalFont,
        fontSize:         env.globalFontSize,
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
      textFields: env.textFields,
      legendPos:  env.legendPos,
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

      // Restore text fields
      if (data.textFields) {
        data.textFields.forEach(tf => env.createTextField(tf));
      }

      // Restore legend position
      if (data.legendPos) {
        env.legendPos = data.legendPos;
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
    env.boxes.forEach(b => {
      if (env.twoBoxShapes[b.id]) {
        env.two.remove(env.twoBoxShapes[b.id]);
      }
      delete env.twoBoxShapes[b.id];
      env.clearSideConnector(b.id);
    });
    env.bridges.forEach(b => {
      if (env.twoBridgeLines[b.id]) env.two.remove(env.twoBridgeLines[b.id]);
      delete env.twoBridgeLines[b.id];
    });

    env.boxes      = [];
    env.bridges    = [];
    env.textFields = [];
    env.nextTextFieldId  = 1;
    env.titleTextFieldId = null;
    env.bridgePending    = null;

    // Remove talent-box and text-field elements (preserve legend)
    env.overlay.querySelectorAll('.talent-box, .text-field').forEach(el => el.remove());
    env.two.update();
  }

  /* ------------------------------------------------------------------ */
  /*  Auto-save / auto-load (localStorage)                               */
  /* ------------------------------------------------------------------ */

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

  return { buildJSON, downloadJSON, loadJSON, clearAll, autoSave, autoLoad };
};
