(() => {
  'use strict';

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('canvas_to_blob_failed'));
        },
        'image/png',
        1.0
      );
    });
  }
  function buildExportFilename(value) {
    const safeName = String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 100);
    return `tierlist_${safeName || 'export'}.png`;
  }
  function startBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const EXPORT_MIN_WIDTH = 600;
  const EXPORT_MAX_WIDTH = 1200;
  function numericStyle(style, property) {
    return Number.parseFloat(style[property]) || 0;
  }
  function calculateTierExportWidth(source) {
    const rows = Array.from(source.querySelectorAll('.tier-row-container'));
    const sourceStyle = getComputedStyle(source);
    const sourcePadding =
      numericStyle(sourceStyle, 'paddingLeft') + numericStyle(sourceStyle, 'paddingRight');
    let widestRow = 0;
    rows.forEach((row) => {
      const rowStyle = getComputedStyle(row);
      const header = row.querySelector('.tier-header');
      const imageArea = row.querySelector('.tier-images');
      const images = imageArea ? Array.from(imageArea.querySelectorAll('.drag-image')) : [];
      const imageAreaStyle = imageArea ? getComputedStyle(imageArea) : null;
      const imagePadding = imageAreaStyle
        ? numericStyle(imageAreaStyle, 'paddingLeft') + numericStyle(imageAreaStyle, 'paddingRight')
        : 0;
      const gap = imageAreaStyle ? numericStyle(imageAreaStyle, 'columnGap') : 0;
      const headerWidth = header?.getBoundingClientRect().width || 90;
      const imageWidth = images[0]?.getBoundingClientRect().width || 100;
      const imagesWidth = images.length * imageWidth + Math.max(0, images.length - 1) * gap;
      const rowBorders =
        numericStyle(rowStyle, 'borderLeftWidth') + numericStyle(rowStyle, 'borderRightWidth');
      widestRow = Math.max(widestRow, rowBorders + headerWidth + imagePadding + imagesWidth);
    });
    return Math.min(
      EXPORT_MAX_WIDTH,
      Math.max(EXPORT_MIN_WIDTH, Math.ceil(widestRow + sourcePadding))
    );
  }
  function applyExplicitExportImageFit(
    image,
    naturalWidth,
    naturalHeight,
    box,
    verticalPosition = 'top'
  ) {
    if (!image || !naturalWidth || !naturalHeight || !box.width || !box.height) return;
    const scale = Math.max(box.width / naturalWidth, box.height / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const left = box.left + (box.width - width) / 2;
    const top = verticalPosition === 'top' ? box.top : box.top + (box.height - height) / 2;
    Object.assign(image.style, {
      inset: 'auto',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: 'none',
      maxHeight: 'none',
      objectFit: 'fill',
      objectPosition: 'center',
    });
  }
  function prepareExportRowImages(sourceRow, clonedRow) {
    const sourceCards = Array.from(sourceRow.querySelectorAll('.drag-image'));
    const clonedCards = Array.from(clonedRow.querySelectorAll('.drag-image'));
    sourceCards.forEach((sourceCard, index) => {
      const clonedCard = clonedCards[index];
      const sourceForeground = sourceCard.querySelector('.drag-image-foreground');
      const clonedForeground = clonedCard?.querySelector('.drag-image-foreground');
      if (!clonedCard || !sourceForeground || !clonedForeground) return;
      const naturalWidth = sourceForeground.naturalWidth;
      const naturalHeight = sourceForeground.naturalHeight;
      if (!naturalWidth || !naturalHeight) return;
      const outerWidth = sourceCard.offsetWidth || 100;
      const outerHeight = sourceCard.offsetHeight || 100;
      const contentWidth = sourceCard.clientWidth || outerWidth;
      const contentHeight = sourceCard.clientHeight || outerHeight;
      Object.assign(clonedCard.style, {
        flex: `0 0 ${outerWidth}px`,
        width: `${outerWidth}px`,
        height: `${outerHeight}px`,
        transform: 'none',
      });
      clonedCard.classList.remove('dragging');
      applyExplicitExportImageFit(
        clonedForeground,
        naturalWidth,
        naturalHeight,
        {
          left: 0,
          top: 0,
          width: contentWidth,
          height: contentHeight,
        },
        'top'
      );
    });
  }
  function createTierExportElement(source, width) {
    const rows = Array.from(source.querySelectorAll('.tier-row-container'));
    if (!rows.length) return null;
    const exportArea = document.createElement('div');
    exportArea.className = 'tier-list-area';
    exportArea.setAttribute('aria-hidden', 'true');
    Object.assign(exportArea.style, {
      position: 'fixed',
      left: '-100000px',
      top: '0',
      width: `${width}px`,
      height: 'auto',
      flex: 'none',
      overflow: 'visible',
      background: '#1e1e1e',
    });
    rows.forEach((row) => {
      const clone = row.cloneNode(true);
      clone.style.width = '100%';
      clone.style.overflow = 'visible';
      clone.style.transform = 'none';
      prepareExportRowImages(row, clone);
      exportArea.appendChild(clone);
    });
    document.body.appendChild(exportArea);
    return exportArea;
  }
  Object.assign(window.GameTierApp, {
    canvasToPngBlob,
    buildExportFilename,
    startBrowserDownload,
    EXPORT_MIN_WIDTH,
    EXPORT_MAX_WIDTH,
    numericStyle,
    calculateTierExportWidth,
    applyExplicitExportImageFit,
    prepareExportRowImages,
    createTierExportElement,
  });
})();
