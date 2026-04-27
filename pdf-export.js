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
  const HEADER_COLORS = {
    action: '#c94040',
    active: '#c94040',
    passive: '#3c78b5',
    skill: '#7b4fbf',
    maneuver: '#d9862a',
    incidental: '#3c9b4a',
  };

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

    console.log('[pdf-export] exportPDF START');
    // Track state that must be restored even if export fails
    let deleteButtons, bgImageEls, savedBgZ = [], savedBgDisplay = [], svgEl, savedSvgDisplay, svgTemp, editables,
      pageWrapper, savedWrapperOverflow, savedWrapperWidth, savedScale, tempHtmlEls = [];

    try {
      // Hide UI elements that shouldn't appear in the PDF
      document.body.classList.add('pdf-exporting');
      deleteButtons = env.overlay.querySelectorAll('.box-delete, .tf-delete, .tf-drag, .box-add-bg, .bg-resize-handle, .bg-delete');
      deleteButtons.forEach(b => b.style.display = 'none');

      /* -------------------------------------------------------------- */
      /*  For PDF export we create temporary HTML elements that mimic    */
      /*  the box visuals (fill, stroke, header, triangle) and place    */
      /*  them above the images. We hide the Two.js SVG during capture  */
      /*  so html2canvas captures the composed HTML layer only.         */
      /* -------------------------------------------------------------- */
      // tempEls deprecated (we now use svgTemp)

      // Temporarily set .box-bg-image z-index to be behind boxes and bridges
      bgImageEls = env.overlay.querySelectorAll('.box-bg-image');
      savedBgZ = [];
      savedBgDisplay = [];
      bgImageEls.forEach(el => {
        savedBgZ.push(el.style.zIndex);
        savedBgDisplay.push(el.style.display);
        // el.style.zIndex = '-1'; // bridges: 2, images: 1, boxes: 3
        // el.style.display = '';
      });

      // Hide the Two.js SVG canvas so it doesn't overlap our temporary HTML
      svgEl = env.two.renderer.domElement;
      savedSvgDisplay = svgEl.style.display;
      // svgEl.style.display = 'none';

      // Create a single SVG overlay for bridges and box visuals
      const svgNS = 'http://www.w3.org/2000/svg';
      svgTemp = document.createElementNS(svgNS, 'svg');
      svgTemp.setAttribute('viewBox', `0 0 ${env.A1_WIDTH} ${env.pageHeight}`);
      svgTemp.setAttribute('width', env.A1_WIDTH);
      svgTemp.setAttribute('height', env.pageHeight);
      svgTemp.style.position = 'absolute';
      svgTemp.style.left = '0px';
      svgTemp.style.top = '0px';
      svgTemp.style.zIndex = '-1';
      svgTemp.style.pointerEvents = 'none';

      // Helper to compute anchor points on box sides
      function sideAnchor(box, side) {
        switch (side) {
          case 'top':    return [box.x + box.w / 2, box.y];
          case 'bottom': return [box.x + box.w / 2, box.y + box.h];
          case 'left':   return [box.x,             box.y + box.h / 2];
          case 'right':  return [box.x + box.w,     box.y + box.h / 2];
        }
        return [box.x + box.w / 2, box.y + box.h / 2];
      }

      // Draw bridges first (so boxes render above)
    //   if (env.bridges) {
    //     env.bridges.forEach(b => {
    //       const fromBox = env.boxes.find(x => x.id === b.fromId);
    //       const toBox = env.boxes.find(x => x.id === b.toId);
    //       if (!fromBox || !toBox) return;
    //       const [x1,y1] = sideAnchor(fromBox, b.fromSide || 'right');
    //       const [x2,y2] = sideAnchor(toBox, b.toSide || 'left');
    //       const line = document.createElementNS(svgNS, 'line');
    //       line.setAttribute('x1', x1);
    //       line.setAttribute('y1', y1);
    //       line.setAttribute('x2', x2);
    //       line.setAttribute('y2', y2);
    //       const bridgeColor = (env.bridgeColor !== undefined) ? env.bridgeColor : '#666666';
    //       line.setAttribute('stroke', bridgeColor);
    //       line.setAttribute('stroke-width', (env.bridgeWidth || 2.5));
    //       line.setAttribute('stroke-linecap', 'round');
    //       line.style.zIndex = '-2';
    //       svgTemp.appendChild(line);
    //     });
    //   }

      // Draw boxes (fill, header, triangle, stroke)
    //   env.boxes.forEach(box => {
    //     const fill = box.fillColor || '#fff';
    //     const stroke = box.strokeColor || '#444';
    //     const c = clampedChamfer(box);

    //     // Chamfered rect path
    //     const d = `M ${box.x} ${box.y} ` +
    //               `L ${box.x + box.w - c} ${box.y} ` +
    //               `L ${box.x + box.w} ${box.y + c} ` +
    //               `L ${box.x + box.w} ${box.y + box.h} ` +
    //               `L ${box.x + c} ${box.y + box.h} ` +
    //               `L ${box.x} ${box.y + box.h - c} Z`;
    //     const path = document.createElementNS(svgNS, 'path');
    //     path.setAttribute('d', d);
    //     path.setAttribute('fill', fill);
    //     path.setAttribute('stroke', stroke);
    //     path.setAttribute('stroke-width', '2');
    //     svgTemp.appendChild(path);

    //     // Header
    //     const el = document.getElementById('box-' + box.id);
    //     if (el) {
    //       const headerEl = el.querySelector('.box-header');
    //       if (headerEl) {
                // const hH = headerEl.scrollHeight;
                // const color = HEADER_COLORS[box.talentType] || HEADER_COLORS.active;

                // Apply the same layout + clip-path styles to the live header element
                // try {
                //   headerEl.style.display = 'flex';
                //   headerEl.style.alignItems = 'flex-start';
                //   headerEl.style.margin = '1px';
                //   const cs = window.getComputedStyle(headerEl);
                //   const bgColor = cs.getPropertyValue('background-color') || color;
                //   headerEl.style.background = bgColor;
                //   // keep existing CSS variable padding if present, otherwise fall back to computed padding
                  
                //   const padTop = cs.getPropertyValue('--label-padding-height') || cs.paddingTop;
                //   const padSides = cs.getPropertyValue('--label-padding-width') || cs.paddingRight;
                //   headerEl.style.padding = `${padTop} ${padSides}`;
                //   headerEl.style.flexShrink = '0';
                //   // replicate the clip-path used in CSS, using the chamfer value `c`
                //   headerEl.style.clipPath = `polygon(0% 0%, calc(100% - ${c}px + 2px) 0%, 100% calc(${c}px - 2px), 100% 100%, 0% 100%)`;
                // } catch (e) {
                //   // ignore if styles cannot be applied
                // }

                // Create a header container div that matches the live header's position, size,
                // background color and clip-path. Use it as a container for the checkbox and name.
                // const cs = window.getComputedStyle(headerEl);
                // const container = document.createElement('div');
                // container.className = 'pdf-header-container';
                // container.style.position = 'absolute';
                // container.style.left = box.x + 'px';
                // container.style.top = box.y + 'px';
                // container.style.width = box.w + 'px';
                // container.style.height = hH + 'px';
                // // copy background color (fall back to computed value or the talent-type color)
                // container.style.background = cs.getPropertyValue('background-color') || color;
                // // copy clip-path if present
                // const clip = cs.getPropertyValue('clip-path') || cs.getPropertyValue('clipPath');
                // if (clip && clip !== 'none') container.style.clipPath = clip;
                // container.style.zIndex = '10';
                // container.style.pointerEvents = 'none'; // non-interactive for rendering

                // // Append container to overlay and track for cleanup
                // svgTemp.appendChild(container);

                // Draw header polygon in SVG to match the CSS clip-path (using c and ±2px as in the CSS)
                // const adjTopX = box.x + box.w - c + 2;          // calc(100% - c + 2px)
                // const adjTopY = box.y + Math.max(0, hH - 2);     // calc(c - 2px)
                // const headerPolyPoints = [
                //   `${box.x},${box.y}`,
                //   `${adjTopX},${box.y}`,
                //   `${box.x + box.w},${adjTopY}`,
                //   `${box.x + box.w},${box.y + c}`,
                //   `${box.x},${box.y + c}`
                // ].join(' ');
                // const headerPoly = document.createElementNS(svgNS, 'polygon');
                // headerPoly.setAttribute('points', headerPolyPoints);
                // headerPoly.setAttribute('fill', color);
                // svgTemp.appendChild(headerPoly);

                // Create an HTML checkbox element and append it to the HTML overlay
                // (appending HTML inputs into an <svg> doesn't render; use overlay)
                // const checkboxDiv = document.createElement('div');
                // checkboxDiv.style.position = 'absolute';
                // checkboxDiv.style.left = box.x + 'px';
                // // center the 16px checkbox vertically in the header
                // const cbSize = 16;
                // const topOffset = box.y + (hH - cbSize) / 2;
                // checkboxDiv.style.top = topOffset + 'px';
                // checkboxDiv.style.width = cbSize + 'px';
                // checkboxDiv.style.height = cbSize + 'px';
                // checkboxDiv.style.marginLeft = '4px'; // small gap from the left edge
                // checkboxDiv.style.zIndex = '10';
                // checkboxDiv.className = 'pdf-temp-checkbox';

                // const checkbox = document.createElement('input');
                // checkbox.type = 'checkbox';
                // checkbox.className = 'box-checkbox';
                // checkbox.title = 'Acquired';
                // if (box.acquired) checkbox.checked = true;
                // // apply styles to match .talent-box .box-checkbox
                // checkbox.style.width = '16px';
                // checkbox.style.height = '16px';
                // checkbox.style.accentColor = '#fff';
                // checkbox.style.cursor = 'pointer';
                // checkbox.style.flexShrink = '0';
                // checkbox.style.marginTop = '2px';

                // checkboxDiv.appendChild(checkbox);
                // env.overlay.appendChild(checkboxDiv);
                // container.appendChild(checkboxDiv);
                // tempHtmlEls.push(checkboxDiv);

                // Render header text as an absolutely-positioned HTML div so we
                // can apply the same CSS as .talent-box .box-name
                // const headerText = box.name || '';
                // if (headerText) {
                //     const nameDiv = document.createElement('div');
                //     nameDiv.className = 'box-name';
                //     nameDiv.textContent = headerText;
                //     nameDiv.style.position = 'absolute';
                //     nameDiv.style.left = box.x + 'px';
                //     nameDiv.style.top = box.y + 'px';
                //     nameDiv.style.width = box.w + 'px';
                //     nameDiv.style.height = hH + 'px';
                //     nameDiv.style.zIndex = '10';
                //     nameDiv.style.display = 'flex';
                //     nameDiv.style.alignItems = 'center';
                //     nameDiv.style.justifyContent = 'center';
                //     nameDiv.style.fontWeight = 'bold';
                //     nameDiv.style.fontSize = '14px';
                //     nameDiv.style.textAlign = 'center';
                //     nameDiv.style.background = 'transparent';
                //     nameDiv.style.border = 'none';
                //     nameDiv.style.borderBottom = '1px dashed transparent';
                //     nameDiv.style.color = '#fff';
                //     nameDiv.style.outline = 'none';
                //     nameDiv.style.padding = '1px calc(var(--chamfer, 14px)) 1px 4px';
                //     nameDiv.style.fontFamily = box.font || 'inherit';
                //     nameDiv.style.minWidth = '0';
                //     nameDiv.style.overflow = 'hidden';
                //     nameDiv.style.lineHeight = '1.3';
                //     nameDiv.style.wordWrap = 'break-word';
                //     nameDiv.style.whiteSpace = 'pre-wrap';
                //     nameDiv.style.pointerEvents = 'none';

                //     container.appendChild(nameDiv);
                //     env.overlay.appendChild(nameDiv);
                //     tempHtmlEls.push(nameDiv);
                // }
        //     }
        // }

        // // Cost triangle
        // const costFs = box.costFontSize || 13;
        // const triSize = Math.max(45, costFs * 3.2 + 4);
        // const triColor = env.darkMode ? '#fff' : '#000';
        // const tri = document.createElementNS(svgNS, 'polygon');
        // const triPoints = `${box.x + box.w},${box.y + box.h - triSize} ${box.x + box.w},${box.y + box.h} ${box.x + box.w - triSize},${box.y + box.h}`;
        // tri.setAttribute('points', triPoints);
        // tri.setAttribute('fill', triColor);
        // svgTemp.appendChild(tri);

        // if (box.cost !== undefined && box.cost !== null) {
        //     const X = box.x + box.w;
        //     const Y = box.y + box.h;
        //     const cx = X - triSize / 3;
        //     const cy = Y - triSize / 3;

        //     const costText = document.createElementNS(svgNS, 'text');
        //     costText.setAttribute('x', cx);
        //     costText.setAttribute('y', cy);
        //     costText.setAttribute('text-anchor', 'middle');
        //     costText.setAttribute('dominant-baseline', 'middle');
        //     costText.setAttribute('fill', env.darkMode ? '#000' : '#fff');
        //     costText.setAttribute('font-family', box.font || 'sans-serif');
        //     costText.setAttribute('font-size', costFs);
        //     costText.setAttribute('font-weight', 'bold');
        //     costText.setAttribute('pointer-events', 'none');
        //     costText.setAttribute('pointer-events', 'none');
        //     // apply transform similar to the CSS: translate(var(--tri-size)/6, var(--tri-size)/6) rotate(-45deg)
        //     const triTranslate = (triSize / 6);
        //     // CSS fallback: translate + rotate around element center
        //     costText.style.transform = `rotate(-45deg)`;
        //     costText.style.transformOrigin = `${cx}px ${cy}px`;
        //     //costText.style.transformOrigin = '50% 50%';
        //     costText.textContent = String(box.cost);

        //     //svgTemp.appendChild(costText);
        // }


    //   });

    //   env.overlay.appendChild(svgTemp);
    //   console.log('[pdf-export] svgTemp appended to overlay');

      //env.two.update();

      // Temporarily set container & SVG to full A1 size (1:1) for capture.
      // Model coordinates are already in A1-space so no repositioning needed.
      savedScale = env.currentScale;

      // Remove overflow clipping so html2canvas can see full width
      pageWrapper = env.pageContainer.parentElement;
      savedWrapperOverflow = pageWrapper.style.overflow;
      savedWrapperWidth    = pageWrapper.style.width;
      pageWrapper.style.overflow = 'visible';
      pageWrapper.style.width    = env.A1_WIDTH + 'px';

      env.pageContainer.style.width     = env.A1_WIDTH + 'px';
      env.pageContainer.style.minHeight = env.pageHeight + 'px';
      env.pageContainer.style.overflow  = 'visible';
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
      editables = env.overlay.querySelectorAll('[contenteditable]');
      editables.forEach(el => el.contentEditable = 'false');

      console.log('[pdf-export] about to capture canvas', {
        savedBgZCount: savedBgZ.length,
        bgImageEls: bgImageEls.length,
        boxes: env.boxes.length,
        bridges: env.bridges ? env.bridges.length : 0,
      });

      // Capture the page container at 2× for quality using html2canvas
    const scaleFactor = 1;

    // Render the page container to a PNG data URL using dom-to-image
    const domToImageOptions = {
      width: env.A1_WIDTH * scaleFactor,
      height: env.pageHeight * scaleFactor,
      bgcolor: null,
      cacheBust: true,
      // ensure cloned node uses same box-sizing/layout (optional)
      style: {
        transform: 'scale(1)',
        transformOrigin: '0 0'
      }
    };
    const domLib = window.domtoimage || window.domtoimage2;
    if (!domLib) {
        throw new Error('dom-to-image library failed to load. Check your internet connection and reload.');
    }
    const imgDataUrl = await domLib.toPng(env.pageContainer, domToImageOptions);

    // Create an Image from the rendered PNG so we can slice it into pages
    const renderedImg = new Image();
    renderedImg.src = imgDataUrl;
    await new Promise((res, rej) => {
      renderedImg.onload = () => res();
      renderedImg.onerror = e => rej(new Error('dom-to-image produced an invalid image: ' + e));
    });

    console.log('[pdf-export] capture complete (dom-to-image), building PDF pages');

    // Compute pixel dimensions and pages (matching previous html2canvas logic)
    const pageWidthPx  = env.A1_WIDTH * scaleFactor;
    const pageHeightPx = env.pageHeight * scaleFactor;
    const pxPerMm      = pageWidthPx / A1_W_MM;
    const a1HeightPx   = A1_H_MM * pxPerMm;
    const totalPages   = Math.max(1, Math.ceil(pageHeightPx / a1HeightPx));

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

      const srcY = Math.floor(page * a1HeightPx);
      const srcH = Math.min(Math.floor(a1HeightPx), Math.floor(pageHeightPx - srcY));

      // Create a canvas for this page slice and draw the corresponding portion of the image
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = pageWidthPx;
      sliceCanvas.height = srcH;
      const sliceCtx = sliceCanvas.getContext('2d');
      sliceCtx.drawImage(renderedImg, 0, srcY, pageWidthPx, srcH, 0, 0, pageWidthPx, srcH);

      const sliceData = sliceCanvas.toDataURL('image/png');
      const imgH_mm = (srcH / pxPerMm);

      pdf.addImage(sliceData, 'PNG', 0, 0, A1_W_MM, imgH_mm, undefined, 'FAST');

      progress.textContent = `Rendering PDF… page ${page + 1} / ${totalPages}`;
      await new Promise(r => setTimeout(r, 0));
    }

    pdf.save('talent_sheet.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed: ' + err.message);
    } finally {
      try {
        console.log('[pdf-export] running cleanup');
        if (typeof svgTemp !== 'undefined' && svgTemp && svgTemp.parentNode) {
          svgTemp.remove();
          console.log('[pdf-export] svgTemp removed');
        }
        // remove any temporary HTML elements we injected during export
        if (tempHtmlEls && tempHtmlEls.length) {
          tempHtmlEls.forEach(el => { try { if (el.parentNode) el.parentNode.removeChild(el); } catch(e){} });
          console.log('[pdf-export] removed', tempHtmlEls.length, 'temporary HTML elements');
        }
        if (svgEl) {
          svgEl.style.display = savedSvgDisplay || '';
          console.log('[pdf-export] restored svgEl.display =', savedSvgDisplay);
        }
        if (env && env.two && typeof env.two.update === 'function') {
          env.two.update();
          console.log('[pdf-export] env.two.update() called');
        }
        if (editables) editables.forEach(el => el.contentEditable = 'true');
        if (deleteButtons) deleteButtons.forEach(b => b.style.display = '');
        if (bgImageEls) bgImageEls.forEach((el, i) => {
          el.style.zIndex = savedBgZ[i] || '';
          el.style.display = savedBgDisplay[i] || '';
        });
        document.body.classList.remove('pdf-exporting');
        if (pageWrapper) {
          pageWrapper.style.overflow = savedWrapperOverflow;
          pageWrapper.style.width    = savedWrapperWidth;
        }
        if (env && env.pageContainer) env.pageContainer.style.overflow = '';
        if (typeof env.fitToWindow === 'function') env.fitToWindow();
        console.log('[pdf-export] cleanup complete');
      } catch (cleanupErr) {
        console.error('PDF cleanup failed:', cleanupErr);
      }
      progress.remove();
    }
  }

  return { exportPDF };
};
