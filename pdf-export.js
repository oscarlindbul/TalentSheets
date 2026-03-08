/**
 * PDF Export Module — pdf-export.js
 *
 * Handles rendering the talent sheet to a multi-page A1 PDF.
 *
 * Exposes: window.createPdfExportModule(env) → { exportPDF }
 *
 * `env` is the shared dependency object supplied by app.js.
 */
window.createPdfExportModule = function (env) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  PDF Export  (A1 pages, 594 × 841 mm)                               */
  /* ------------------------------------------------------------------ */

  /* Helper: chamfer value clamped the same way box.js does */
  function clampedChamfer(box) {
    const raw = box.w * env.CHAMFER_PCT;
    return Math.min(raw, box.w / 4, box.h / 4);
  }

  /* Talent-type header colours */
  const HEADER_COLORS = { active: '#c94040', passive: '#3c78b5', skill: '#7b4fbf' };

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
      const deleteButtons = env.overlay.querySelectorAll('.box-delete, .tf-delete, .tf-drag');
      deleteButtons.forEach(b => b.style.display = 'none');

      /* -------------------------------------------------------------- */
      /*  Draw header backgrounds & cost triangles as Two.js SVG shapes  */
      /*  because html2canvas does not support CSS clip-path.            */
      /* -------------------------------------------------------------- */
      const tempShapes = [];

      env.boxes.forEach(box => {
        const el = document.getElementById('box-' + box.id);
        if (!el) return;

        const c = clampedChamfer(box);
        const m = 1;  // matches CSS margin: 1px on .box-header

        /* --- Header background --- */
        const headerEl = el.querySelector('.box-header');
        if (headerEl) {
          const hH = headerEl.offsetHeight;
          const color = HEADER_COLORS[box.talentType] || HEADER_COLORS.active;

          const hAnchors = [
            new Two.Anchor(box.x + m,               box.y + m,          0,0,0,0, Two.Commands.move),
            new Two.Anchor(box.x + box.w - c + m,   box.y + m,          0,0,0,0, Two.Commands.line),
            new Two.Anchor(box.x + box.w - m,        box.y + c - m,     0,0,0,0, Two.Commands.line),
            new Two.Anchor(box.x + box.w - m,        box.y + m + hH,    0,0,0,0, Two.Commands.line),
            new Two.Anchor(box.x + m,                box.y + m + hH,    0,0,0,0, Two.Commands.line),
          ];
          const hPath = env.two.makePath(hAnchors, true);
          hPath.closed    = true;
          hPath.curved    = false;
          hPath.automatic = false;
          hPath.fill       = color;
          hPath.stroke     = 'none';
          hPath.linewidth  = 0;
          tempShapes.push(hPath);
        }

        /* --- Cost corner triangle (bottom-right) --- */
        const costFs = box.costFontSize || 13;
        const triSize = Math.max(45, costFs * 3.2 + 4);
        const triColor = env.darkMode ? '#fff' : '#000';
        const tAnchors = [
          new Two.Anchor(box.x + box.w,             box.y + box.h - triSize, 0,0,0,0, Two.Commands.move),
          new Two.Anchor(box.x + box.w,             box.y + box.h,           0,0,0,0, Two.Commands.line),
          new Two.Anchor(box.x + box.w - triSize,   box.y + box.h,           0,0,0,0, Two.Commands.line),
        ];
        const tPath = env.two.makePath(tAnchors, true);
        tPath.closed    = true;
        tPath.curved    = false;
        tPath.automatic = false;
        tPath.fill       = triColor;
        tPath.stroke     = 'none';
        tPath.linewidth  = 0;
        tempShapes.push(tPath);
      });

      env.two.update();

      // Temporarily set container & SVG to full A1 size (1:1) for capture.
      // Model coordinates are already in A1-space so no repositioning needed.
      const savedScale = env.currentScale;

      // Remove overflow clipping so html2canvas can see full width
      const pageWrapper = env.pageContainer.parentElement;
      const savedWrapperOverflow = pageWrapper.style.overflow;
      const savedWrapperWidth    = pageWrapper.style.width;
      pageWrapper.style.overflow = 'visible';
      pageWrapper.style.width    = env.A1_WIDTH + 'px';

      env.pageContainer.style.width     = env.A1_WIDTH + 'px';
      env.pageContainer.style.minHeight = env.pageHeight + 'px';
      env.pageContainer.style.overflow  = 'visible';
      const svgEl = env.two.renderer.domElement;
      svgEl.setAttribute('viewBox', `0 0 ${env.A1_WIDTH} ${env.pageHeight}`);
      svgEl.setAttribute('width',  env.A1_WIDTH);
      svgEl.setAttribute('height', env.pageHeight);
      svgEl.style.width  = env.A1_WIDTH + 'px';
      svgEl.style.height = env.pageHeight + 'px';
      env.overlay.style.transform = 'none';
      env.overlay.style.width  = env.A1_WIDTH + 'px';
      env.overlay.style.height = env.pageHeight + 'px';

      // All text fields are now contenteditable divs — disable editing
      // during capture so the dashed focus borders don't show, but the
      // coloured span content renders natively for html2canvas.
      const editables = env.overlay.querySelectorAll('[contenteditable]');
      editables.forEach(el => el.contentEditable = 'false');

      // Capture the page container at 2× for quality
      const scaleFactor = 2;
      const canvas = await html2canvas(env.pageContainer, {
        scale: scaleFactor,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        width: env.A1_WIDTH,
        height: env.pageHeight,
        scrollX: 0,
        scrollY: 0,
        windowWidth: env.A1_WIDTH,
      });

      // Remove temporary SVG shapes, restore editability & CSS
      tempShapes.forEach(s => env.two.remove(s));
      env.two.update();
      // Restore contenteditable
      editables.forEach(el => el.contentEditable = 'true');
      deleteButtons.forEach(b => b.style.display = '');
      document.body.classList.remove('pdf-exporting');
      pageWrapper.style.overflow = savedWrapperOverflow;
      pageWrapper.style.width    = savedWrapperWidth;
      env.pageContainer.style.overflow = '';
      env.fitToWindow();

      // How many A1 pages are needed vertically?
      const pageWidthPx  = env.A1_WIDTH * scaleFactor;
      const pageHeightPx = env.pageHeight * scaleFactor;

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

  return { exportPDF };
};
