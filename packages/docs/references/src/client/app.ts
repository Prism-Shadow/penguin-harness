(() => {
  interface SearchHit {
    t: string;
    sub: string;
    k: string;
    c: string;
    u: string;
  }

  const win = window as Window & {
    penguinSearchIndex?: SearchHit[];
  };

  const html = document.documentElement;
  const THEME_KEY = "refs-theme";
  const BRAND_KEY = "refs-brand-v2";
  const COLLAPSE_KEY = "refs-sidebar-collapsed";
  const WIDTH_KEY = "refs-sidebar-width";
  const BRANDS = new Set(["frost", "console", "adev"]);

  const safeGet = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const safeSet = (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable (private mode or sandboxed iframe)
    }
  };
  const safeRemove = (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable
    }
  };

  /* ---------- Theme & Brand ---------- */

  const themeBtn = document.getElementById("theme-toggle");
  const segBtns = Array.from(document.querySelectorAll<HTMLElement>("[data-set-brand]"));

  function applyTheme(t: string): void {
    const mode = t === "dark" ? "dark" : "light";
    html.classList.remove("docs-light-mode", "docs-dark-mode");
    html.classList.add(mode === "dark" ? "docs-dark-mode" : "docs-light-mode");
    html.dataset.theme = mode;
    safeSet(THEME_KEY, mode);
  }

  function applyBrand(raw: string): void {
    const b = BRANDS.has(raw) ? raw : "frost";
    if (b === "adev") delete html.dataset.brand;
    else html.dataset.brand = b;
    for (const btn of segBtns) {
      btn.classList.toggle("active", btn.getAttribute("data-set-brand") === b);
    }
    safeSet(BRAND_KEY, b);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const initialTheme =
    urlParams.get("theme") ||
    safeGet(THEME_KEY) ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const initialBrand = urlParams.get("brand") || safeGet(BRAND_KEY) || "frost";
  applyTheme(initialTheme);
  applyBrand(initialBrand);

  requestAnimationFrame(() => {
    html.classList.add("ui-ready");
  });

  themeBtn?.addEventListener("click", () => {
    applyTheme(html.classList.contains("docs-dark-mode") ? "light" : "dark");
  });
  for (const btn of segBtns) {
    btn.addEventListener("click", () => {
      applyBrand(btn.getAttribute("data-set-brand") || "frost");
    });
  }

  /* ---------- Sidebar Collapse, Resize & Group Fold ---------- */

  const secSidebar = document.getElementById("secondary-sidebar");
  const collapseBtn = document.getElementById("sidebar-collapse-btn");
  const unfoldBtn = document.getElementById("sidebar-unfold-btn");
  const foldAllBtn = document.getElementById("sidebar-fold-all");
  const resizer = document.getElementById("sidebar-resizer");

  const mobileMq = window.matchMedia("(max-width: 920px)");

  function syncSidebarInert(): void {
    if (!secSidebar) return;
    const hidden = mobileMq.matches
      ? !html.classList.contains("mobile-sidebar-open")
      : html.classList.contains("sidebar-collapsed");
    secSidebar.inert = hidden;
  }

  function setSidebarCollapsed(collapsed: boolean, moveFocus = false): void {
    if (mobileMq.matches) {
      html.classList.toggle("mobile-sidebar-open", !collapsed);
      syncSidebarInert();
      if (moveFocus) (collapsed ? unfoldBtn : collapseBtn)?.focus();
      return;
    }
    html.classList.toggle("sidebar-collapsed", collapsed);
    safeSet(COLLAPSE_KEY, collapsed ? "1" : "0");
    syncSidebarInert();
    if (moveFocus) (collapsed ? unfoldBtn : collapseBtn)?.focus();
  }

  if (safeGet(COLLAPSE_KEY) === "1") html.classList.add("sidebar-collapsed");
  syncSidebarInert();
  mobileMq.addEventListener("change", syncSidebarInert);
  const savedWidth = safeGet(WIDTH_KEY);
  if (savedWidth && /^\d{3}px$/.test(savedWidth)) {
    html.style.setProperty("--secondary-nav-width", savedWidth);
  }

  collapseBtn?.addEventListener("click", () => setSidebarCollapsed(true, true));
  unfoldBtn?.addEventListener("click", () => setSidebarCollapsed(false, true));
  document.getElementById("back-to-top")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const ctxBtn = document.getElementById("ctx-switcher-btn");
  const ctxMenu = document.getElementById("ctx-switcher-menu");
  if (ctxBtn && ctxMenu) {
    const closeCtx = (): void => {
      ctxMenu.classList.remove("open");
      ctxBtn.setAttribute("aria-expanded", "false");
    };
    ctxBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = ctxMenu.classList.toggle("open");
      ctxBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (target instanceof Node && !ctxMenu.contains(target) && target !== ctxBtn) {
        closeCtx();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && ctxMenu.classList.contains("open")) closeCtx();
    });
  }

  // CSS renders a single chevron via .docs-secondary-nav-header::after
  // and collapses the adjacent .docs-faceted-list when .folded is present.
  const navHeaders = Array.from(
    document.querySelectorAll<HTMLElement>(".docs-nav-secondary .docs-secondary-nav-header"),
  );
  for (const hdr of navHeaders) {
    const list = hdr.nextElementSibling;
    if (!list || !list.classList.contains("docs-faceted-list")) continue;
    hdr.setAttribute("role", "button");
    hdr.setAttribute("tabindex", "0");
    hdr.setAttribute("aria-expanded", hdr.classList.contains("folded") ? "false" : "true");
    const toggle = (): void => {
      const folded = hdr.classList.toggle("folded");
      hdr.setAttribute("aria-expanded", folded ? "false" : "true");
    };
    hdr.addEventListener("click", toggle);
    hdr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  }

  if (foldAllBtn && navHeaders.length > 0) {
    foldAllBtn.addEventListener("click", () => {
      const anyOpen = navHeaders.some((h) => !h.classList.contains("folded"));
      for (const h of navHeaders) {
        h.classList.toggle("folded", anyOpen);
        h.setAttribute("aria-expanded", anyOpen ? "false" : "true");
      }
    });
  }

  if (resizer && secSidebar) {
    let dragging = false;
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      html.classList.add("sidebar-resizing");
      resizer.classList.add("dragging");

      const onMove = (ev: MouseEvent): void => {
        if (!dragging) return;
        const rect = secSidebar.getBoundingClientRect();
        const w = Math.max(180, Math.min(520, Math.round(ev.clientX - rect.left)));
        html.style.setProperty("--secondary-nav-width", `${w}px`);
      };
      const onUp = (): void => {
        if (!dragging) return;
        dragging = false;
        html.classList.remove("sidebar-resizing");
        resizer.classList.remove("dragging");
        const finalW = getComputedStyle(html).getPropertyValue("--secondary-nav-width").trim();
        if (finalW) safeSet(WIDTH_KEY, finalW);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    resizer.addEventListener("dblclick", () => {
      html.style.removeProperty("--secondary-nav-width");
      safeRemove(WIDTH_KEY);
    });
  }

  const activeNav = document.querySelector<HTMLElement>(
    ".docs-nav-secondary .docs-faceted-list-item-active",
  );
  const secScroll = document.getElementById("sidebar-scroll-area");
  if (activeNav && secScroll) {
    const aRect = activeNav.getBoundingClientRect();
    const sRect = secScroll.getBoundingClientRect();
    if (aRect.bottom > sRect.bottom - 20 || aRect.top < sRect.top + 48) {
      secScroll.scrollTop = Math.max(0, activeNav.offsetTop - 96);
    }
  }

  /* ---------- Copy Code Buttons ---------- */

  for (const btn of document.querySelectorAll<HTMLButtonElement>("button[docs-copy-source-code]")) {
    btn.addEventListener("click", () => {
      const parent = btn.parentElement;
      if (!parent) return;
      const explicit = parent.getAttribute("data-copy-code");
      const code = parent.querySelector<HTMLElement>("pre code, code");
      const text = explicit || code?.innerText || "";
      if (!text || !navigator.clipboard) return;
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.classList.add("copied");
          window.setTimeout(() => btn.classList.remove("copied"), 1400);
        })
        .catch(() => {
          btn.title = "Copy failed";
        });
    });
  }

  /* ---------- Catalog Filter & Kernel Tier Toggle ---------- */

  const filterInput = document.querySelector<HTMLInputElement>("[data-filter-input]");
  const filterPills = Array.from(document.querySelectorAll<HTMLElement>("[data-filter-type]"));
  const tierBtns = Array.from(document.querySelectorAll<HTMLElement>("[data-tier-btn]"));

  if (filterInput || filterPills.length > 0 || tierBtns.length > 0) {
    let activeType = "all";
    let activeTier = "public";

    const applyFilter = (): void => {
      const q = filterInput ? filterInput.value.trim().toLowerCase() : "";
      for (const el of document.querySelectorAll<HTMLElement>("[data-item-name]")) {
        const okType = activeType === "all" || el.getAttribute("data-item-type") === activeType;
        const name = el.getAttribute("data-item-name") ?? "";
        const okQ = !q || name.includes(q);
        el.style.display = okType && okQ ? "" : "none";
      }
      for (const sec of document.querySelectorAll<HTMLElement>("[data-section-group]")) {
        const items = Array.from(sec.querySelectorAll<HTMLElement>("[data-item-name]"));
        const any = items.some((el) => el.style.display !== "none");
        sec.style.display = any ? "" : "none";
        const det = sec.querySelector<HTMLDetailsElement>("details.kernel-group-details");
        if (det) {
          if (q || activeTier === "all" || activeType !== "all") det.open = any;
          else det.open = false;
        }
      }
    };

    filterInput?.addEventListener("input", applyFilter);
    for (const pill of filterPills) {
      const activatePill = (): void => {
        for (const p of filterPills) {
          p.classList.remove("adev-reference-list-type-filter-item-active");
          p.setAttribute("aria-pressed", "false");
        }
        pill.classList.add("adev-reference-list-type-filter-item-active");
        pill.setAttribute("aria-pressed", "true");
        activeType = pill.getAttribute("data-filter-type") || "all";
        applyFilter();
      };
      pill.addEventListener("click", activatePill);
      pill.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activatePill();
        }
      });
    }
    for (const btn of tierBtns) {
      btn.addEventListener("click", () => {
        for (const b of tierBtns) b.classList.remove("active");
        btn.classList.add("active");
        activeTier = btn.getAttribute("data-tier-btn") || "public";
        applyFilter();
      });
    }
  }

  /* ---------- Right TOC Active Tracking ---------- */

  const tocLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("#toc-list a"));
  if (tocLinks.length > 0 && "IntersectionObserver" in window) {
    const heads = tocLinks
      .map((a) => {
        const href = a.getAttribute("href");
        return href && href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
      })
      .filter((el): el is HTMLElement => el !== null);

    const setAct = (id: string): void => {
      for (const a of tocLinks) {
        a.classList.toggle("docs-faceted-list-item-active", a.getAttribute("href") === `#${id}`);
      }
    };

    if (heads[0]) setAct(heads[0].id);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setAct(entry.target.id);
        }
      },
      { rootMargin: "-10% 0px -75% 0px" },
    );
    for (const h of heads) io.observe(h);
  }

  /* ---------- Quick Search Dialog (Safe DOM rendering, no innerHTML) ---------- */

  const dlgEl = document.getElementById("search-dialog");
  const dlg = dlgEl instanceof HTMLDialogElement ? dlgEl : null;
  const sInputEl = document.getElementById("search-input");
  const sInput = sInputEl instanceof HTMLInputElement ? sInputEl : null;
  const sResults = document.getElementById("search-results");
  const sTrigger = document.getElementById("search-trigger");
  const sClose = document.getElementById("search-close");
  const rootPrefix = html.dataset.refsRoot ?? "";
  const index: readonly SearchHit[] = Array.isArray(win.penguinSearchIndex)
    ? win.penguinSearchIndex
    : [];

  function renderHits(query: string): void {
    if (!sResults) return;
    const needle = query.trim().toLowerCase();
    const hits = index
      .filter(
        (x) =>
          !needle || x.t.toLowerCase().includes(needle) || x.sub.toLowerCase().includes(needle),
      )
      .slice(0, 32);

    const frag = document.createDocumentFragment();
    for (const h of hits) {
      const a = document.createElement("a");
      a.className = "adev-search-hit";
      a.href = `${rootPrefix}${h.u}`;

      const badge = document.createElement("span");
      const safeKind = /^[a-z0-9_-]+$/i.test(h.k) ? h.k : "block";
      badge.className = `docs-api-item-label type-${safeKind}`;
      badge.textContent = h.c;

      const title = document.createElement("span");
      title.textContent = h.t;

      const sub = document.createElement("span");
      sub.className = "adev-search-hit-sub";
      sub.textContent = h.sub;

      a.append(badge, title, sub);
      frag.append(a);
    }
    sResults.replaceChildren(frag);
  }

  function openSearch(): void {
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    renderHits(sInput?.value ?? "");
    sInput?.focus();
  }

  sTrigger?.addEventListener("click", openSearch);
  sClose?.addEventListener("click", () => dlg?.close());
  dlg?.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  sInput?.addEventListener("input", () => renderHits(sInput.value));

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    const isTyping =
      active instanceof HTMLElement &&
      (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
    if (isTyping) return;

    if (e.key === "/") {
      e.preventDefault();
      openSearch();
    } else if (e.key === "[") {
      e.preventDefault();
      if (mobileMq.matches) {
        setSidebarCollapsed(html.classList.contains("mobile-sidebar-open"), true);
      } else {
        setSidebarCollapsed(!html.classList.contains("sidebar-collapsed"), true);
      }
    }
  });

  /* ---------- Twoslash Popup Horizontal Viewport Clamp ---------- */

  for (const tok of document.querySelectorAll<HTMLElement>(".twoslash .twoslash-hover")) {
    tok.addEventListener("mouseenter", () => {
      const pop = tok.querySelector<HTMLElement>(".twoslash-popup-container");
      if (!pop) return;
      pop.style.marginLeft = "";
      const rect = pop.getBoundingClientRect();
      if (rect.right > window.innerWidth - 16) {
        pop.style.marginLeft = `${Math.round(window.innerWidth - 16 - rect.right)}px`;
      } else if (rect.left < 16) {
        pop.style.marginLeft = `${Math.round(16 - rect.left)}px`;
      }
    });
  }
})();
