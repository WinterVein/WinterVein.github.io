(function () {
  'use strict';

  var FULLS_BASE = 'images/fulls';
  var THUMBS_BASE = 'images/thumbs';

  var state = {
    root: null,
    current: null,
    ancestors: [],
  };

  var viewer = {
    el: null,
    imageEl: null,
    infoEl: null,
    isOpen: false,
    isZoomed: false,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    translateAtDragStartX: 0,
    translateAtDragStartY: 0,
    naturalW: 0,
    naturalH: 0,
    fitScale: 1,
    currentAnnotation: null,
    currentExif: null,
  };

  var exifConfig = [];

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }

  function qsa(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  function renderAnnotation(text, isMd) {
    var html = escapeHtml(text);
    if (isMd) {
      html = renderMarkdown(text);
    }
    return '<div class="annotation-inner">' + html + '</div>';
  }

  function loadManifest() {
    return fetch('images/manifest.json?' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error('Failed to load manifest');
      return r.json();
    });
  }

  function init() {
    var mainEl = document.getElementById('main');
    if (!mainEl) return;

    var exifAttr = mainEl.getAttribute('data-exif');
    if (exifAttr) {
      try { exifConfig = JSON.parse(exifAttr); } catch (e) { exifConfig = []; }
    }

    mainEl.innerHTML = '<div class="gallery-loading">Loading gallery...</div>';

    loadManifest().then(function (manifest) {
      state.root = manifest;
      state.current = manifest;
      state.ancestors = [];
      renderGrid();
    }).catch(function (err) {
      mainEl.innerHTML = '<div class="gallery-loading">Failed to load gallery: ' + escapeHtml(err.message) + '</div>';
    });

    buildViewer();
    setupPanelToggle();
  }

  function buildViewer() {
    var overlay = document.createElement('div');
    overlay.id = 'gallery-viewer';
    overlay.className = 'viewer-overlay';
    overlay.innerHTML =
      '<button class="viewer-close" aria-label="Close">&times;</button>' +
      '<div class="viewer-content">' +
        '<div class="viewer-image-wrap">' +
          '<img class="viewer-image" src="" alt="">' +
        '</div>' +
        '<div class="viewer-info">' +
          '<div class="viewer-annotation"></div>' +
          '<div class="viewer-exif"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    viewer.el = overlay;
    viewer.imageEl = qs('.viewer-image', overlay);
    viewer.infoEl = qs('.viewer-info', overlay);

    qs('.viewer-close', overlay).addEventListener('click', closeViewer);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeViewer();
    });
    viewer.imageEl.addEventListener('click', toggleZoom);
    viewer.imageEl.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', endDrag);
    viewer.imageEl.addEventListener('touchstart', startTouchDrag, { passive: false });
    document.addEventListener('touchmove', doTouchDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
    document.addEventListener('keydown', function (e) {
      if (!viewer.isOpen) return;
      if (e.key === 'Escape') closeViewer();
    });
  }

  function renderGrid() {
    var mainEl = document.getElementById('main');
    if (!mainEl) return;
    mainEl.innerHTML = '';
    mainEl.classList.remove('content-active');

    var children = state.current.children || [];

    // Back button if not at root
    if (state.ancestors.length > 0) {
      mainEl.appendChild(createBackCard());
    }

    for (var i = 0; i < children.length; i++) {
      var item = children[i];
      if (item.type === 'folder') {
        mainEl.appendChild(createFolderCard(item));
      } else {
        mainEl.appendChild(createImageCard(item));
      }
    }
  }

  function createBackCard() {
    var article = document.createElement('article');
    article.className = 'thumb back-thumb';
    var a = document.createElement('a');
    a.className = 'image';
    a.href = '#';
    var h2 = document.createElement('h2');
    h2.textContent = '\u2190';
    a.appendChild(h2);
    article.appendChild(a);
    article.addEventListener('click', function (e) {
      e.preventDefault();
      navigateBack();
    });
    return article;
  }

  function createFolderCard(item) {
    var article = document.createElement('article');
    article.className = 'thumb folder-thumb';
    var a = document.createElement('a');
    a.className = 'image';
    a.href = '#';
    var h2 = document.createElement('h2');
    h2.textContent = item.name;
    a.appendChild(h2);
    article.appendChild(a);
    article.addEventListener('click', function (e) {
      e.preventDefault();
      navigateInto(item);
    });
    return article;
  }

  function createImageCard(item) {
    var article = document.createElement('article');
    article.className = 'thumb';

    var imgPath = item._thumbPath || (THUMBS_BASE + '/' + getItemRelPath(item));
    var fullPath = item._fullPath || (FULLS_BASE + '/' + getItemRelPath(item));

    var a = document.createElement('a');
    a.className = 'image';
    a.href = fullPath;
    a.style.backgroundImage = 'url(' + imgPath + ')';
    a.style.backgroundSize = 'cover';
    a.style.backgroundPosition = 'center';

    var img = document.createElement('img');
    img.src = imgPath;
    img.alt = item.name;
    img.setAttribute('data-name', item.name);
    img.setAttribute('data-full', fullPath);
    a.appendChild(img);
    article.appendChild(a);

    article.addEventListener('click', function (e) {
      e.preventDefault();
      openViewer(item, fullPath);
    });

    return article;
  }

  function getItemRelPath(item) {
    var parts = [];
    for (var i = 0; i < state.ancestors.length; i++) {
      parts.push(state.ancestors[i].segment);
    }
    parts.push(item.name);
    return parts.join('/');
  }

  function navigateInto(folder) {
    state.ancestors.push({ node: state.current, segment: folder.name });
    state.current = folder;
    renderGrid();
  }

  function navigateBack() {
    if (state.ancestors.length === 0) return;
    var prev = state.ancestors.pop();
    state.current = prev.node;
    renderGrid();
  }

  // --- Viewer ---

  function openViewer(item, fullPath) {
    viewer.isOpen = true;
    viewer.isZoomed = false;
    viewer.translateX = 0;
    viewer.translateY = 0;
    viewer.currentAnnotation = item.annotation || null;

    var imageEl = viewer.imageEl;
    imageEl.style.transform = '';
    imageEl.classList.remove('zoomed');
    imageEl.style.cursor = 'pointer';
    imageEl.src = '';
    imageEl.alt = item.name;

    qs('.viewer-annotation', viewer.el).innerHTML = '';
    qs('.viewer-exif', viewer.el).innerHTML = '';

    viewer.el.style.display = 'flex';
    document.body.classList.add('modal-active');

    // Load full image
    var img = new Image();
    img.onload = function () {
      viewer.naturalW = img.naturalWidth;
      viewer.naturalH = img.naturalHeight;
      imageEl.src = fullPath;
      imageEl.style.maxWidth = '';
      imageEl.style.maxHeight = '';
      imageEl.style.width = '';
      imageEl.style.height = '';
      imageEl.style.transform = '';

      setTimeout(function () {
        var wrap = qs('.viewer-image-wrap', viewer.el);
        var wrapRect = wrap.getBoundingClientRect();
        var pad = 20;
        var availW = wrapRect.width - pad * 2;
        var availH = wrapRect.height - pad * 2;
        var scaleX = availW / viewer.naturalW;
        var scaleY = availH / viewer.naturalH;
        viewer.fitScale = Math.min(scaleX, scaleY, 1);
        imageEl.style.maxWidth = (viewer.naturalW * viewer.fitScale) + 'px';
        imageEl.style.maxHeight = (viewer.naturalH * viewer.fitScale) + 'px';
      }, 50);

      // Show annotation
      showAnnotation(item);

      // Extract EXIF
      extractExif(img, item.name);
    };
    img.src = fullPath;

    // Pre-fetch annotation if available
    if (item.annotation) {
      qs('.viewer-annotation', viewer.el).innerHTML =
        renderAnnotation(item.annotation, item.name.toLowerCase().endsWith('.md'));
    }
  }

  function closeViewer() {
    if (!viewer.isOpen) return;
    viewer.isOpen = false;
    viewer.isZoomed = false;
    viewer.el.style.display = 'none';
    viewer.imageEl.src = '';
    document.body.classList.remove('modal-active');
  }

  function toggleZoom() {
    if (!viewer.isOpen) return;
    viewer.isZoomed = !viewer.isZoomed;
    viewer.translateX = 0;
    viewer.translateY = 0;

    var imageEl = viewer.imageEl;
    var wrap = qs('.viewer-image-wrap', viewer.el);

    if (viewer.isZoomed) {
      imageEl.style.maxWidth = '';
      imageEl.style.maxHeight = '';
      imageEl.style.width = viewer.naturalW + 'px';
      imageEl.style.height = viewer.naturalH + 'px';

      var wrapRect = wrap.getBoundingClientRect();
      var imgRect = imageEl.getBoundingClientRect();
      viewer.translateX = (wrapRect.width - imgRect.width) / 2;
      viewer.translateY = (wrapRect.height - imgRect.height) / 2;
      imageEl.style.transform = 'translate(' + viewer.translateX + 'px, ' + viewer.translateY + 'px)';
      imageEl.classList.add('zoomed');
    } else {
      imageEl.style.maxWidth = (viewer.naturalW * viewer.fitScale) + 'px';
      imageEl.style.maxHeight = (viewer.naturalH * viewer.fitScale) + 'px';
      imageEl.style.width = '';
      imageEl.style.height = '';
      imageEl.style.transform = '';
      imageEl.classList.remove('zoomed');
    }
  }

  function startDrag(e) {
    if (!viewer.isZoomed) return;
    viewer.isDragging = true;
    viewer.dragStartX = e.clientX;
    viewer.dragStartY = e.clientY;
    viewer.translateAtDragStartX = viewer.translateX;
    viewer.translateAtDragStartY = viewer.translateY;
    viewer.imageEl.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function doDrag(e) {
    if (!viewer.isDragging) return;
    var dx = e.clientX - viewer.dragStartX;
    var dy = e.clientY - viewer.dragStartY;
    viewer.translateX = viewer.translateAtDragStartX + dx;
    viewer.translateY = viewer.translateAtDragStartY + dy;
    viewer.imageEl.style.transform = 'translate(' + viewer.translateX + 'px, ' + viewer.translateY + 'px)';
  }

  function endDrag() {
    if (viewer.isDragging) {
      viewer.isDragging = false;
      if (viewer.imageEl && viewer.isZoomed) viewer.imageEl.style.cursor = 'grab';
    }
  }

  var touchId = null;

  function startTouchDrag(e) {
    if (!viewer.isZoomed) return;
    var touch = e.touches[0];
    if (!touch) return;
    touchId = touch.identifier;
    viewer.isDragging = true;
    viewer.dragStartX = touch.clientX;
    viewer.dragStartY = touch.clientY;
    viewer.translateAtDragStartX = viewer.translateX;
    viewer.translateAtDragStartY = viewer.translateY;
    e.preventDefault();
  }

  function doTouchDrag(e) {
    if (!viewer.isDragging) return;
    var touch = findTouch(e.changedTouches, touchId);
    if (!touch) return;
    var dx = touch.clientX - viewer.dragStartX;
    var dy = touch.clientY - viewer.dragStartY;
    viewer.translateX = viewer.translateAtDragStartX + dx;
    viewer.translateY = viewer.translateAtDragStartY + dy;
    viewer.imageEl.style.transform = 'translate(' + viewer.translateX + 'px, ' + viewer.translateY + 'px)';
    e.preventDefault();
  }

  function findTouch(touches, id) {
    for (var i = 0; i < touches.length; i++) {
      if (touches[i].identifier === id) return touches[i];
    }
    return null;
  }

  function showAnnotation(item) {
    var el = qs('.viewer-annotation', viewer.el);
    if (item.annotation) {
      var isMd = item.name.toLowerCase().endsWith('.md');
      el.innerHTML = renderAnnotation(item.annotation, isMd);
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  function extractExif(img, name) {
    if (!window.EXIF) return;
    var exifEl = qs('.viewer-exif', viewer.el);
    try {
      EXIF.getData(img, function () {
        var html = '';
        for (var i = 0; i < exifConfig.length; i++) {
          var cfg = exifConfig[i];
          var tag = EXIF.getTag(this, cfg.tag);
          if (tag !== undefined && tag !== '') {
            var icon = cfg.icon || '';
            html += '<span class="exif-item">' +
              (icon ? '<i class="' + icon + '"></i> ' : '') +
              escapeHtml(String(tag)) +
              '</span> ';
          }
        }
        if (html) {
          exifEl.innerHTML = html;
          exifEl.style.display = '';
        } else {
          exifEl.style.display = 'none';
        }
      });
    } catch (e) {
      exifEl.style.display = 'none';
    }
  }

  // --- Panel toggle (from old main.js) ---

  function setupPanelToggle() {
    var panelLink = qs('#header nav ul li a[href="#footer"]');
    if (!panelLink) return;
    var footer = document.getElementById('footer');
    if (!footer) return;
    var main = document.getElementById('main');

    panelLink.addEventListener('click', function (e) {
      e.preventDefault();
      var isActive = footer.classList.contains('content-active');
      if (isActive) {
        footer.classList.remove('content-active');
        footer.classList.remove('active');
        if (main) main.classList.remove('content-active');
      } else {
        footer.classList.add('content-active');
        footer.classList.add('active');
        if (main) main.classList.add('content-active');
      }
    });

    // Close panel on overlay click
    var panelInner = qs('.inner', footer);
    if (panelInner) {
      footer.addEventListener('click', function (e) {
        if (e.target === footer || e.target === panelInner) {
          footer.classList.remove('content-active');
          footer.classList.remove('active');
          if (main) main.classList.remove('content-active');
        }
      });
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
