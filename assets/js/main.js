/**
 * main.js
 * Photo gallery — lightbox, zoom/pan, keyboard navigation, EXIF display.
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------
  const lightbox     = document.getElementById("lightbox");
  if (!lightbox) return; // not a gallery page

  const lb = {
    image:       lightbox.querySelector(".lightbox__image"),
    zoomWrap:    lightbox.querySelector(".lightbox__zoom-wrap"),
    close:       lightbox.querySelector(".lightbox__close"),
    prev:        lightbox.querySelector(".lightbox__nav--prev"),
    next:        lightbox.querySelector(".lightbox__nav--next"),
    description: lightbox.querySelector(".lightbox__description"),
    exifItems:   lightbox.querySelectorAll(".lightbox__exif-item"),
  };

  // All photo squares on this page, collected once for keyboard nav.
  let photos = [];
  let currentIndex = -1;
  let isZoomed = false;

  // -------------------------------------------------------------------------
  // Collect photo triggers
  // -------------------------------------------------------------------------
  function collectPhotos() {
    photos = Array.from(document.querySelectorAll("[data-lightbox-trigger]"));
  }

  // -------------------------------------------------------------------------
  // Open lightbox
  // -------------------------------------------------------------------------
  function openLightbox(trigger, idx) {
    currentIndex = idx;

    const data = trigger.dataset;

    // Reset zoom
    exitZoom();

    // Image
    lb.image.src  = data.full || "";
    lb.image.alt  = data.description || "";

    // Description
    lb.description.textContent = data.description || "";

    // EXIF fields
    const fieldMap = {
      camera:  data.camera,
      lens:    data.lens,
      focal:   data.focal,
      aperture: data.aperture,
      shutter: data.shutter,
      iso:     data.iso,
      date:    formatDate(data.date),
    };

    lb.exifItems.forEach((item) => {
      const field = item.dataset.field;
      const val   = fieldMap[field];
      const dd    = item.querySelector("dd");
      if (val && val !== "undefined" && val !== "") {
        dd.textContent = val;
        item.classList.add("has-value");
      } else {
        dd.textContent = "";
        item.classList.remove("has-value");
      }
    });

    // Show/hide nav arrows
    lb.prev.style.display = photos.length > 1 ? "" : "none";
    lb.next.style.display = photos.length > 1 ? "" : "none";

    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    // Trap focus
    lb.close.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    lb.image.src = "";
    exitZoom();
    // Return focus to the originating thumbnail
    if (currentIndex >= 0 && photos[currentIndex]) {
      photos[currentIndex].focus();
    }
    currentIndex = -1;
  }

  function navigate(dir) {
    if (photos.length === 0) return;
    currentIndex = (currentIndex + dir + photos.length) % photos.length;
    openLightbox(photos[currentIndex], currentIndex);
  }

  // -------------------------------------------------------------------------
  // Zoom / pan
  // -------------------------------------------------------------------------
  function enterZoom(e) {
    isZoomed = true;
    lb.zoomWrap.classList.add("is-zoomed");
    if (e) setPanOrigin(e);
  }

  function exitZoom() {
    isZoomed = false;
    lb.zoomWrap.classList.remove("is-zoomed");
    lb.image.style.transformOrigin = "center center";
  }

  function setPanOrigin(e) {
    const rect = lb.zoomWrap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width)  * 100;
    const y = ((e.clientY - rect.top)  / rect.height) * 100;
    lb.image.style.transformOrigin = `${x}% ${y}%`;
  }

  lb.zoomWrap.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isZoomed) {
      exitZoom();
    } else {
      enterZoom(e);
    }
  });

  lb.zoomWrap.addEventListener("mousemove", (e) => {
    if (isZoomed) setPanOrigin(e);
  });

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-lightbox-trigger]");
    if (trigger) {
      e.preventDefault();
      collectPhotos();
      const idx = photos.indexOf(trigger);
      openLightbox(trigger, idx >= 0 ? idx : 0);
    }
  });

  lb.close.addEventListener("click", closeLightbox);

  lb.prev.addEventListener("click", (e) => { e.stopPropagation(); navigate(-1); });
  lb.next.addEventListener("click", (e) => { e.stopPropagation(); navigate(+1); });

  // Click outside the stage closes lightbox
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  // Keyboard nav
  document.addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("is-open")) return;
    switch (e.key) {
      case "Escape":     closeLightbox();   break;
      case "ArrowLeft":  navigate(-1);      break;
      case "ArrowRight": navigate(+1);      break;
      case "z":
      case "Z":
        if (isZoomed) exitZoom(); else enterZoom(null);
        break;
    }
  });

  // Swipe support (touch)
  let touchStartX = null;
  lightbox.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  lightbox.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) navigate(dx < 0 ? 1 : -1);
    touchStartX = null;
  }, { passive: true });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function formatDate(iso) {
    if (!iso || iso === "undefined" || iso === "null") return "";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric",
      });
    } catch {
      return iso;
    }
  }

})();
