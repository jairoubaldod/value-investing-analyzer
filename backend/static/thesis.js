const charts = {};

/* Bloomberg Terminal chart / data palette */
const BB = {
  amber: "#ff9900",
  white: "#ffffff",
  gray: "#666666",
  grayLight: "#999999",
  axisRight: "#848484",
  red: "#ff3333",
  green: "#33cc33",
  cyan: "#00ffff",
  gold: "#e6ac00",
  orangeDark: "#cc6600",
  grid: "#333333",
  bg: "#000000",
  border: "#333333",
};

const CHART_SERIES = [BB.amber, BB.gold, BB.cyan, BB.green, BB.red, BB.grayLight];

const GROUP_COLORS = {
  equity: BB.amber,
  assets: BB.grayLight,
  liabilities: BB.red,
  default: BB.amber,
  growth: BB.green,
  growth_neg: BB.red,
};

/** Income-statement waterfall signs for block 1 (patch stale API). */
const MAGIC_FLOW_SIGNS = {
  TOTALREVENUE: "+",
  "COST OF REVENUES": "-",
  "GROSS PROFIT": "=",
  "TOTAL EXPENSES": "-",
  EBIT: "=",
  "INTEREST& OTHER": "-",
  EBT: "=",
  TAXES: "-",
  "NET INCOME": "=",
  CFO: "+",
  "-CAPEX": "-",
  "INTEREST (1-T)": "+",
  FCFF: "=",
};

function flowSignTag(sign) {
  if (!sign) return "";
  if (sign === "=") return "(=)";
  if (sign === "+") return "(+)";
  if (sign === "-") return "(-)";
  return `(${sign})`;
}

function flowSignClass(sign) {
  if (sign === "=") return "metric-flow-sign--eq";
  if (sign === "+") return "metric-flow-sign--pos";
  if (sign === "-") return "metric-flow-sign--neg";
  return "";
}

/** Display labels for block 1 metrics (patch stale API). */
const MAGIC_METRIC_LABELS = {
  TOTALREVENUE: "Total Revenue",
  "COST OF REVENUES": "Cost of Revenue",
  "INTEREST& OTHER": "Interest & Other",
};

function metricDisplayLabel(metric) {
  if (metric.label && metric.label !== metric.key) return metric.label;
  return MAGIC_METRIC_LABELS[metric.key] || metric.label || metric.key;
}

function metricFlowSign(block, metric) {
  if (metric.flow_sign) return metric.flow_sign;
  if (!/generate cash/i.test(block.name || "")) return null;
  return MAGIC_FLOW_SIGNS[metric.key] || MAGIC_FLOW_SIGNS[metric.label] || null;
}

function renderMetricLabelHtml(block, metric) {
  const label = metricDisplayLabel(metric);
  const sign = metricFlowSign(block, metric);
  const tag = flowSignTag(sign);
  if (!tag) return label;
  return `${label}<span class="metric-flow-sign ${flowSignClass(sign)}">${tag}</span>`;
}

let chartJsPromise = null;

function applyChartDefaults() {
  if (typeof Chart === "undefined") return;
  Chart.defaults.color = BB.amber;
  Chart.defaults.borderColor = BB.grid;
  Chart.defaults.backgroundColor = BB.bg;
  Chart.defaults.font.family = "Consolas, Courier New, monospace";
  Chart.defaults.font.size = 10;
}

function ensureChartJs() {
  if (typeof Chart !== "undefined") {
    applyChartDefaults();
    return Promise.resolve();
  }
  if (!chartJsPromise) {
    chartJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js";
      script.async = true;
      script.onload = () => {
        applyChartDefaults();
        resolve();
      };
      script.onerror = () => reject(new Error("Chart.js failed to load"));
      document.head.appendChild(script);
    });
  }
  return chartJsPromise;
}

let READY_TICKERS = ["MSFT", "AAPL", "NVDA", "GOOGL", "AMZN"];
let TICKER_CATALOG = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeTickerInput(raw) {
  return String(raw || "").trim().toUpperCase();
}

function resolveTicker(ticker) {
  const sym = normalizeTickerInput(ticker || "MSFT");
  if (!sym) return READY_TICKERS.includes("MSFT") ? "MSFT" : READY_TICKERS[0] || "MSFT";
  if (READY_TICKERS.includes(sym)) return sym;
  const match = TICKER_CATALOG.find((row) => row.ticker === sym);
  if (match) return match.ticker;
  // Keep explicit URL tickers (e.g. META) before async /api/tickers hydrates READY_TICKERS
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(sym)) return sym;
  if (READY_TICKERS.includes("MSFT")) return "MSFT";
  return READY_TICKERS[0] || "MSFT";
}

function setTickerInputValue(ticker) {
  const input = document.getElementById("ticker-input");
  if (input) input.value = resolveTicker(ticker);
}

function releaseMobileInputZoom() {
  const input = document.getElementById("ticker-input");
  const search = document.getElementById("ticker-picker-search");
  if (document.activeElement === input) input.blur();
  if (document.activeElement === search) search.blur();
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
  });
}

function renderTickerPickerList(query) {
  const listEl = document.getElementById("ticker-picker-list");
  if (!listEl) return;
  const q = String(query || "").trim().toLowerCase();
  const rows = TICKER_CATALOG.filter((row) => {
    if (!q) return true;
    return row.ticker.toLowerCase().includes(q) || row.company.toLowerCase().includes(q);
  });
  if (!rows.length) {
    listEl.innerHTML = `<p class="ticker-picker-empty">No matches for “${escapeHtml(q)}”.</p>`;
    return;
  }
  listEl.innerHTML = rows
    .map(
      (row) => `
        <button type="button" class="ticker-picker-item" data-ticker="${escapeHtml(row.ticker)}" role="option">
          <span class="ticker-picker-item-sym">${escapeHtml(row.ticker)}</span>
          <span class="ticker-picker-item-name">${escapeHtml(row.market_cap_label ? `${row.market_cap_label} · ${row.company}` : row.company)}</span>
        </button>`
    )
    .join("");
}

function setTickerPickerOpen(open) {
  const root = document.getElementById("ticker-picker");
  const toggle = document.getElementById("ticker-picker-toggle");
  const input = document.getElementById("ticker-input");
  if (!root) return;
  root.hidden = !open;
  root.setAttribute("aria-hidden", open ? "false" : "true");
  root.classList.toggle("ticker-picker--open", open);
  document.body.classList.toggle("ticker-picker-open", open);
  toggle?.setAttribute("aria-expanded", open ? "true" : "false");
  input?.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) {
    releaseMobileInputZoom();
    return;
  }
  const search = document.getElementById("ticker-picker-search");
  renderTickerPickerList(search?.value || "");
  if (!isMobileLayout()) {
    window.setTimeout(() => search?.focus(), 0);
  }
}

function openTickerPicker() {
  setTickerPickerOpen(true);
  fetchTickerCatalog().catch(() => {});
}

function closeTickerPicker() {
  setTickerPickerOpen(false);
}

function toggleTickerPicker() {
  const root = document.getElementById("ticker-picker");
  if (!root) return;
  if (root.hidden) openTickerPicker();
  else closeTickerPicker();
}

async function fetchReadyTickers({ catalog = false } = {}) {
  try {
    const url = catalog ? "/api/tickers?catalog=1" : "/api/tickers";
    const res = await fetch(url);
    if (!res.ok) return READY_TICKERS;
    const data = await res.json();
    if (Array.isArray(data.ready) && data.ready.length) {
      READY_TICKERS = data.ready;
    }
    if (Array.isArray(data.catalog) && data.catalog.length) {
      TICKER_CATALOG = data.catalog
        .map((row) => ({
          ticker: String(row.ticker || "").toUpperCase(),
          company: String(row.company || row.ticker || "").trim(),
          market_cap_label: String(row.market_cap_label || "").trim(),
        }))
        .filter((row) => row.ticker);
    } else if (catalog) {
      TICKER_CATALOG = READY_TICKERS.map((t) => ({ ticker: t, company: t }));
    }
  } catch {
    if (catalog) TICKER_CATALOG = READY_TICKERS.map((t) => ({ ticker: t, company: t }));
  }
  const note = document.getElementById("sidebar-ticker-note");
  if (note) note.textContent = `${READY_TICKERS.length} companies · cached · instant`;
  const countEl = document.getElementById("ticker-picker-count");
  if (countEl) countEl.textContent = `${READY_TICKERS.length} ready`;
  if (catalog || TICKER_CATALOG.length) renderTickerPickerList(document.getElementById("ticker-picker-search")?.value || "");
  return READY_TICKERS;
}

async function fetchTickerCatalog() {
  if (TICKER_CATALOG.length >= READY_TICKERS.length && TICKER_CATALOG.length > 5) {
    return TICKER_CATALOG;
  }
  await fetchReadyTickers({ catalog: true });
  return TICKER_CATALOG;
}

function bindTickerPicker() {
  const root = document.getElementById("ticker-picker");
  const search = document.getElementById("ticker-picker-search");
  const listEl = document.getElementById("ticker-picker-list");
  const toggle = document.getElementById("ticker-picker-toggle");

  toggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleTickerPicker();
  });

  root?.querySelectorAll("[data-close-ticker-picker]").forEach((el) => {
    el.addEventListener("click", closeTickerPicker);
  });

  search?.addEventListener("input", () => renderTickerPickerList(search.value));

  listEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-ticker]");
    if (!btn) return;
    const sym = btn.getAttribute("data-ticker");
    closeTickerPicker();
    navigateTicker(sym);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root && !root.hidden) {
      event.preventDefault();
      closeTickerPicker();
    }
  });

  document.addEventListener("click", (event) => {
    if (!root || root.hidden || isMobileLayout()) return;
    if (event.target.closest("#ticker-picker-panel") || event.target.closest("#ticker-picker-toggle")) return;
    closeTickerPicker();
  });
}

function findCachedTicker(raw) {
  const sym = normalizeTickerInput(raw);
  if (!sym) return null;
  return READY_TICKERS.includes(sym) ? sym : null;
}

function showTickerInputError(message) {
  const input = document.getElementById("ticker-input");
  if (!input) return;
  input.classList.add("bb-ticker-input--error");
  input.setAttribute("aria-invalid", "true");
  input.title = message;
  window.setTimeout(() => {
    input.classList.remove("bb-ticker-input--error");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("title");
  }, 2200);
}

function submitTickerFromInput() {
  const input = document.getElementById("ticker-input");
  if (!input) return;
  const sym = findCachedTicker(input.value);
  if (!sym) {
    showTickerInputError(`Ticker “${normalizeTickerInput(input.value)}” is not cached. Open the list or type a valid symbol.`);
    return;
  }
  closeTickerPicker();
  releaseMobileInputZoom();
  navigateTicker(sym);
}

function bindTickerInput() {
  const input = document.getElementById("ticker-input");
  const goBtn = document.getElementById("ticker-go");
  goBtn?.addEventListener("click", submitTickerFromInput);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitTickerFromInput();
    }
  });
  input?.addEventListener("blur", () => {
    const sym = findCachedTicker(input.value);
    if (sym) input.value = sym;
    window.setTimeout(releaseMobileInputZoom, 80);
  });
}

function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  const ticker = resolveTicker(p.get("ticker") || "MSFT");
  const hash = window.location.hash.replace("#", "").toLowerCase();

  let domain = "one-pager";
  let valMethod = "dcf1";
  let fundSection = null;
  let chartSection = null;

  if (hash.startsWith("valuation")) {
    domain = "valuation";
    valMethod =
      hash === "valuation-multiples"
        ? "multiples"
        : hash === "valuation-consensus"
          ? "consensus"
          : hash === "valuation-dcf-draft"
            ? "dcf-draft"
            : "dcf1";
  } else if (hash === "fundamentals" || hash.startsWith("block-") || hash.startsWith("chart-")) {
    domain = "fundamentals";
    if (hash.startsWith("block-")) fundSection = Number(hash.replace("block-", ""));
    if (hash.startsWith("chart-")) chartSection = Number(hash.replace("chart-", ""));
  }

  return {
    ticker,
    domain,
    valMethod,
    fundSection,
    chartSection,
  };
}

let currentValuationMethod = "dcf1";
let currentDomain = "one-pager";

function captureNavState() {
  const { fundSection, chartSection } = getUrlParams();
  return {
    domain: currentDomain,
    valMethod: currentValuationMethod,
    fundSection,
    chartSection,
    mobileChartSection: mobileActiveChartSection,
  };
}

function navHashForState(state) {
  if (state.domain === "valuation") {
    if (state.valMethod === "multiples") return "#valuation-multiples";
    if (state.valMethod === "consensus") return "#valuation-consensus";
    if (state.valMethod === "dcf-draft") return "#valuation-dcf-draft";
    return "#valuation";
  }
  if (state.domain === "fundamentals") {
    if (state.chartSection != null && !Number.isNaN(state.chartSection)) {
      return `#chart-${state.chartSection}`;
    }
    if (state.fundSection != null && !Number.isNaN(state.fundSection)) {
      return `#block-${state.fundSection}`;
    }
    return "#fundamentals";
  }
  return "#one-pager";
}

function syncNavUrl(ticker, state) {
  const sym = resolveTicker(ticker);
  const params = new URLSearchParams();
  if (sym !== "MSFT") params.set("ticker", sym);
  const qs = params.toString();
  const hash = navHashForState(state);
  window.history.replaceState({}, "", `${qs ? `?${qs}` : "/"}${hash}`);
}

function restoreFundamentalsSection(state) {
  if (state.domain !== "fundamentals") return;
  if (isMobileLayout()) {
    if (state.chartSection != null && !Number.isNaN(state.chartSection)) {
      mobileActiveChartSection = state.chartSection;
    } else if (state.mobileChartSection != null && !Number.isNaN(state.mobileChartSection)) {
      mobileActiveChartSection = state.mobileChartSection;
    }
    applyMobileFundamentalsDefaults();
    return;
  }
  if (state.fundSection != null && !Number.isNaN(state.fundSection)) {
    collapseAllBlocksExcept(state.fundSection);
    syncFundamentalsNavActive({ block: state.fundSection });
  } else if (state.chartSection != null && !Number.isNaN(state.chartSection)) {
    collapseAllChartSectionsExcept(state.chartSection);
    syncFundamentalsNavActive({ chart: state.chartSection });
  } else {
    applyFundamentalsDefaults();
  }
}

const DOMAIN_LABELS = {
  "one-pager": "One-Pager",
  valuation: "Valuation",
  fundamentals: "Fundamentals",
};

function updateDomainUrl(domain) {
  const params = new URLSearchParams(window.location.search);
  const qs = params.toString();
  let hash = "";
  if (domain === "valuation") {
    hash =
      currentValuationMethod === "multiples"
        ? "#valuation-multiples"
        : currentValuationMethod === "consensus"
          ? "#valuation-consensus"
          : currentValuationMethod === "dcf-draft"
            ? "#valuation-dcf-draft"
            : "#valuation";
  } else if (domain === "fundamentals") {
    hash = "#fundamentals";
  } else {
    hash = "#one-pager";
  }
  window.history.replaceState({}, "", `${qs ? `?${qs}` : "/"}${hash}`);
}

function setNavSubExpanded(domain, expanded) {
  const group = document.querySelector(`.nav-domain-group[data-domain-group="${domain}"]`);
  if (!group) return;
  const expandBtn = group.querySelector(".nav-expand-btn");
  const sub = group.querySelector(".nav-sub");
  if (expandBtn) {
    expandBtn.textContent = expanded ? "−" : "+";
    expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    expandBtn.setAttribute(
      "aria-label",
      expanded
        ? domain === "valuation"
          ? "Hide valuation methods"
          : "Hide fundamentals sections"
        : domain === "valuation"
          ? "Show valuation methods"
          : "Show fundamentals sections",
    );
    expandBtn.classList.toggle("is-expanded", expanded);
  }
  if (sub) sub.hidden = !expanded;
}

function toggleNavSub(domain) {
  const group = document.querySelector(`.nav-domain-group[data-domain-group="${domain}"]`);
  if (!group) return;
  const expandBtn = group.querySelector(".nav-expand-btn");
  const isExpanded = expandBtn?.getAttribute("aria-expanded") === "true";
  setNavSubExpanded(domain, !isExpanded);
}

function syncMainNavActive(domain) {
  document.querySelectorAll("#main-nav [data-domain]").forEach((el) => {
    const isActive = el.dataset.domain === domain;
    el.classList.toggle("active", isActive);
  });
  if (domain === "valuation") setNavSubExpanded("valuation", true);
  if (domain === "fundamentals") setNavSubExpanded("fundamentals", true);
}

function setDomain(domain, { updateUrl = true } = {}) {
  if (!["one-pager", "valuation", "fundamentals"].includes(domain)) domain = "one-pager";
  currentDomain = domain;

  document.getElementById("view-one-pager")?.classList.toggle("active", domain === "one-pager");
  document.getElementById("view-valuation")?.classList.toggle("active", domain === "valuation");
  document.getElementById("view-fundamentals")?.classList.toggle("active", domain === "fundamentals");

  syncMainNavActive(domain);

  if (domain === "one-pager") {
    setNavSubExpanded("valuation", false);
    setNavSubExpanded("fundamentals", false);
  }

  const titleEl = document.getElementById("bb-redbar-title");
  if (titleEl) titleEl.textContent = DOMAIN_LABELS[domain] || "One-Pager";

  const engineEl = document.getElementById("bb-engine-status");
  if (engineEl) {
    if (domain === "valuation") {
      engineEl.textContent =
        currentValuationMethod === "multiples"
          ? "Engine: Multiples · P/E & P/BV"
          : currentValuationMethod === "consensus"
            ? "Engine: Analyst consensus"
            : currentValuationMethod === "dcf-draft"
              ? "Engine: DCF · Draft"
              : "Engine: DCF · Method 1";
    } else if (domain === "fundamentals") {
      engineEl.textContent = "Engine: Fundamentals · historical review";
    } else {
      engineEl.textContent = "Engine: One-Pager";
    }
  }

  const badge = document.getElementById("bb-badge")?.textContent || "";
  document.title = `THESIS · ${(DOMAIN_LABELS[domain] || "One-Pager").toUpperCase()} · ${badge}`;

  if (updateUrl) updateDomainUrl(domain);

  if (domain !== "one-pager" && currentThesisData) {
    ensureHeavySectionsRendered(currentThesisData);
  }

  if (domain === "valuation" && valuationFlowChart) {
    requestAnimationFrame(() => syncValuationFlowFooter(valuationFlowChart));
  }
  if (domain === "valuation" && currentValuationMethod === "multiples") {
    ensurePeChartsVisible();
    ensurePbvChartsVisible();
  }

  if (isMobileLayout() && domain === "valuation") {
    setupMobileValuationNav();
    syncMobileValuationNav();
  }
  syncMobileChrome();
}

let mobileActiveChartSection = 0;

function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function syncMobileChrome() {
  const mobile = isMobileLayout();
  document.body.classList.toggle("layout-mobile", mobile);
  const bar = document.getElementById("mobile-back-bar");
  const titleEl = document.getElementById("mobile-back-title");
  const tickerEl = document.getElementById("mobile-back-ticker");
  if (!bar) return;
  if (mobile && currentDomain !== "one-pager") {
    bar.hidden = false;
    if (titleEl) titleEl.textContent = DOMAIN_LABELS[currentDomain] || "One-Pager";
    if (tickerEl) tickerEl.textContent = document.getElementById("bb-badge")?.textContent || "";
  } else {
    bar.hidden = true;
  }
}

function bindMobileShell() {
  document.getElementById("mobile-back-btn")?.addEventListener("click", () => setDomain("one-pager"));
  document.getElementById("one-pager-container")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mobile-go]");
    if (!btn) return;
    const go = btn.dataset.mobileGo;
    if (go === "fundamentals") {
      ensureHeavySectionsRendered(currentThesisData).then(() => {
        setDomain("fundamentals");
        applyMobileFundamentalsDefaults();
      });
    } else if (go === "valuation") {
      ensureHeavySectionsRendered(currentThesisData).then(() => {
        setValuationMethod("dcf1");
        setDomain("valuation");
      });
    }
  });
  window.matchMedia("(max-width: 900px)").addEventListener("change", () => {
    syncMobileChrome();
    if (currentThesisData) {
      setupMobileFundamentalsNav(currentThesisData);
      setupMobileMagicNav(currentThesisData.blocks);
      setupMobileValuationNav();
    }
    setupMobileChartCarousels();
    syncMobileMagicLabelColumn();
    if (isMobileLayout() && currentDomain === "fundamentals") applyMobileFundamentalsDefaults();
  });
}

function applyMobileFundamentalsDefaults() {
  if (!isMobileLayout()) {
    applyFundamentalsDefaults();
    return;
  }
  setMobileActiveChartSection(mobileActiveChartSection || 0);
  collapseAllBlocksExcept(0);
  syncFundamentalsNavActive({ chart: mobileActiveChartSection, block: 0 });
}

function setMobileActiveChartSection(sectionIndex) {
  if (!isMobileLayout()) return;
  mobileActiveChartSection = sectionIndex;
  document.querySelectorAll(".chart-section").forEach((section, i) => {
    const isActive = i === sectionIndex;
    section.classList.toggle("mobile-chart-active", isActive);
    const toggle = section.querySelector(".section-toggle");
    const body = section.querySelector(".section-body");
    if (!toggle || !body) return;
    if (isActive) {
      openCollapsible(toggle, body, false);
      ensureChartsInBody(body);
    } else {
      closeCollapsible(toggle, body);
    }
  });
  document.querySelectorAll("#mobile-fd-nav .mobile-fd-pill").forEach((pill, i) => {
    pill.classList.toggle("is-active", i === sectionIndex);
  });
  teardownMobileChartCarousels();
  setupMobileChartCarousels();
}

function teardownMobileChartCarousels() {
  document.querySelectorAll(".mobile-carousel-wrap").forEach((el) => el.remove());
  document.querySelectorAll(".charts-grid-inner").forEach((track) => {
    const slides = [...track.querySelectorAll(".mobile-chart-slide")];
    if (slides.length) {
      const cards = [];
      slides.forEach((slide) => {
        slide.querySelectorAll(".chart-card").forEach((card) => cards.push(card));
      });
      track.replaceChildren(...cards);
      const body = track.closest(".section-body");
      if (body) {
        ensureChartsInBody(body);
        Object.values(charts).forEach((c) => {
          try {
            c.resize();
          } catch {
            /* chart may have been destroyed */
          }
        });
      }
    }
    track.classList.remove("mobile-carousel-track", "mobile-carousel-single");
    delete track.dataset.carouselBound;
  });
}

function setupMobileChartCarousels() {
  teardownMobileChartCarousels();
  if (!isMobileLayout()) return;

  document
    .querySelectorAll(".chart-section.mobile-chart-active .charts-grid-inner")
    .forEach((track) => {
    if (track.dataset.carouselBound) return;
    const cards = [...track.querySelectorAll(":scope > .chart-card")];
    if (cards.length <= 2) {
      track.classList.add("mobile-carousel-track", "mobile-carousel-single");
      track.dataset.carouselBound = "1";
      return;
    }

    track.dataset.carouselBound = "1";
    track.classList.add("mobile-carousel-track");
    track.replaceChildren();

    const slideCount = Math.ceil(cards.length / 2);
    for (let s = 0; s < slideCount; s += 1) {
      const slide = document.createElement("div");
      slide.className = "mobile-chart-slide";
      slide.appendChild(cards[s * 2]);
      if (cards[s * 2 + 1]) slide.appendChild(cards[s * 2 + 1]);
      track.appendChild(slide);
    }

    const body = track.closest(".section-body");
    if (body) ensureChartsInBody(body);

    const wrap = document.createElement("div");
    wrap.className = "mobile-carousel-wrap";

    const hint = document.createElement("p");
    hint.className = "mobile-carousel-hint";
    hint.textContent = slideCount > 1 ? "Swipe for next pair →" : "";

    const dots = document.createElement("div");
    dots.className = "mobile-carousel-dots";
    dots.setAttribute("role", "tablist");

    for (let i = 0; i < slideCount; i += 1) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "mobile-carousel-dot" + (i === 0 ? " is-active" : "");
      dot.setAttribute("aria-label", `Chart pair ${i + 1} of ${slideCount}`);
      dot.addEventListener("click", () => {
        const w = track.clientWidth || 1;
        track.scrollTo({ left: w * i, behavior: "smooth" });
      });
      dots.appendChild(dot);
    }

    const onScroll = () => {
      const w = track.clientWidth || 1;
      const idx = Math.min(slideCount - 1, Math.max(0, Math.round(track.scrollLeft / w)));
      dots.querySelectorAll(".mobile-carousel-dot").forEach((d, i) => {
        d.classList.toggle("is-active", i === idx);
      });
      Object.values(charts).forEach((c) => {
        try {
          c.resize();
        } catch {
          /* ignore */
        }
      });
    };

    track.addEventListener("scroll", onScroll, { passive: true });

    if (slideCount > 1) wrap.appendChild(hint);
    wrap.appendChild(dots);
    track.after(wrap);
  });
}

function setupMobileFundamentalsNav(data) {
  const existing = document.getElementById("mobile-fd-nav");
  if (existing) existing.remove();
  if (!isMobileLayout()) return;

  const panel = document.getElementById("fundamentals-graphs-panel");
  const grid = document.getElementById("charts-grid");
  const sections = normalizeChartSections(data);
  if (!panel || !grid || !sections.length) return;

  const nav = document.createElement("nav");
  nav.id = "mobile-fd-nav";
  nav.className = "mobile-fd-nav";
  nav.setAttribute("aria-label", "Graph sections");
  nav.innerHTML = sections
    .map(
      (s, i) =>
        `<button type="button" class="mobile-fd-pill" data-scroll-chart="${i}">${navShortTitle(s.title)}</button>`,
    )
    .join("");

  nav.addEventListener("click", (e) => {
    const pill = e.target.closest("[data-scroll-chart]");
    if (!pill) return;
    setMobileActiveChartSection(Number(pill.dataset.scrollChart));
  });

  nav.querySelector(".mobile-fd-pill")?.classList.add("is-active");
  panel.insertBefore(nav, grid);
}

function setupMobileValuationNav() {
  const existing = document.getElementById("mobile-val-nav");
  if (existing) existing.remove();
  if (!isMobileLayout()) return;

  const main = document.querySelector("#view-valuation .main-valuation");
  if (!main) return;

  const nav = document.createElement("nav");
  nav.id = "mobile-val-nav";
  nav.className = "mobile-val-nav";
  nav.setAttribute("aria-label", "Valuation methods");
  nav.innerHTML = `
    <span class="mobile-val-nav-title">Valuation</span>
    <div class="mobile-val-nav-tabs">
      <button type="button" class="mobile-val-tab" data-val-method="dcf1">DCF</button>
      <button type="button" class="mobile-val-tab" data-val-method="dcf-draft">Draft</button>
      <button type="button" class="mobile-val-tab" data-val-method="multiples">Multiples</button>
      <button type="button" class="mobile-val-tab" data-val-method="consensus">Consensus</button>
    </div>`;

  nav.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-val-method]");
    if (!tab) return;
    setValuationMethod(tab.dataset.valMethod);
    syncMobileValuationNav();
  });

  main.insertBefore(nav, main.firstElementChild);
  syncMobileValuationNav();
}

function syncMobileValuationNav() {
  document.querySelectorAll("#mobile-val-nav .mobile-val-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.valMethod === currentValuationMethod);
  });
}

function syncMobileMagicLabelColumn() {
  if (!isMobileLayout()) {
    document.documentElement.style.removeProperty("--mobile-mn-col-w");
    document.documentElement.style.removeProperty("--mobile-mn-col-w-wide");
    return;
  }
  const panel = document.getElementById("fundamentals-data-panel");
  if (!panel) return;

  const probe = document.createElement("span");
  probe.className = "mobile-mn-probe";
  document.body.appendChild(probe);

  const standardCells = [];
  const wideCells = [];
  panel.querySelectorAll(".magic-table").forEach((table) => {
    const bucket = table.classList.contains("mn-table-wide") ? wideCells : standardCells;
    table.querySelectorAll("tbody td:first-child, thead th.corner-cell").forEach((cell) => bucket.push(cell));
  });

  const measure = (cells) => {
    let maxW = 0;
    cells.forEach((cell) => {
      probe.textContent = cell.textContent.replace(/\s+/g, " ").trim();
      maxW = Math.max(maxW, probe.offsetWidth);
    });
    return maxW;
  };

  const panelW = panel.clientWidth || window.innerWidth;
  const stdMax = measure(standardCells);
  const wideMax = wideCells.length ? measure(wideCells) : 0;
  probe.remove();

  const stdPx = Math.min(Math.max(stdMax + 24, 104), Math.round(panelW * 0.42));
  const widePx = wideMax
    ? Math.min(Math.max(wideMax + 24, stdPx + 16), Math.round(panelW * 0.52))
    : stdPx;

  document.documentElement.style.setProperty("--mobile-mn-col-w", `${stdPx}px`);
  document.documentElement.style.setProperty("--mobile-mn-col-w-wide", `${widePx}px`);
}

function setupMobileMagicNav(blocks) {
  const existing = document.getElementById("mobile-mn-nav");
  if (existing) existing.remove();
  if (!isMobileLayout()) return;

  const panel = document.getElementById("fundamentals-data-panel");
  const container = document.getElementById("blocks-container");
  const topBlocks = (blocks || []).filter(
    (b) => !b.display?.parent_section && !b.name.includes("% of assets"),
  );
  if (!panel || !container || !topBlocks.length) return;

  const nav = document.createElement("nav");
  nav.id = "mobile-mn-nav";
  nav.className = "mobile-fd-nav mobile-mn-nav";
  nav.setAttribute("aria-label", "Magic Numbers sections");
  nav.innerHTML = topBlocks
    .map(
      (b, i) =>
        `<button type="button" class="mobile-fd-pill" data-scroll-block="${i}">${navShortTitle(b.name)}</button>`,
    )
    .join("");

  nav.addEventListener("click", (e) => {
    const pill = e.target.closest("[data-scroll-block]");
    if (!pill) return;
    const idx = Number(pill.dataset.scrollBlock);
    expandSection(idx, { scroll: true });
    nav.querySelectorAll(".mobile-fd-pill").forEach((p) => p.classList.remove("is-active"));
    pill.classList.add("is-active");
  });

  nav.querySelector(".mobile-fd-pill")?.classList.add("is-active");
  panel.insertBefore(nav, container);
}

/** @deprecated use setDomain */
function setWorkspace(workspace) {
  setDomain(workspace === "valuation" ? "valuation" : workspace === "fundamentals" ? "fundamentals" : "one-pager");
}

function bindMainNav() {
  document.querySelector("#main-nav a[data-domain='one-pager']")?.addEventListener("click", (e) => {
    e.preventDefault();
    setDomain("one-pager");
  });

  document.querySelectorAll(".nav-expand-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const domain = btn.dataset.expandFor;
      if (domain) toggleNavSub(domain);
    });
  });

  document.querySelectorAll(".nav-domain-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const domain = btn.dataset.domain;
      setDomain(domain);
      setNavSubExpanded(domain, true);
      if (domain === "fundamentals") applyFundamentalsDefaults();
    });
  });

  window.addEventListener("hashchange", () => {
    const { domain, valMethod, fundSection, chartSection } = getUrlParams();
    if (domain !== currentDomain) setDomain(domain, { updateUrl: false });
    if (domain === "valuation" && valMethod !== currentValuationMethod) setValuationMethod(valMethod);
    if (domain === "fundamentals" && fundSection != null && !Number.isNaN(fundSection)) {
      collapseAllBlocksExcept(fundSection);
      syncFundamentalsNavActive({ block: fundSection });
    }
    if (domain === "fundamentals" && chartSection != null && !Number.isNaN(chartSection)) {
      collapseAllChartSectionsExcept(chartSection);
      syncFundamentalsNavActive({ chart: chartSection });
    }
  });
}

async function loadThesis(ticker) {
  const sym = ticker.toUpperCase();
  const res = await fetch(`/api/thesis/${sym}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to load thesis data");
  }
  return res.json();
}

function sourceForTicker(ticker) {
  return ticker.toUpperCase() === "MSFT" ? "preload" : "edgar";
}

function getBlockDisplay(block) {
  if (block.display?.bar_mode) return block.display;
  const name = block.name;
  if (name.includes("generate cash")) return { bar_mode: "column", show_unit: true, collapsible: true };
  if (name.startsWith("2 Growth")) return { bar_mode: "row", show_unit: false, collapsible: true };
  if (name.startsWith("3 Profitability")) return { bar_mode: "row", show_unit: false, collapsible: true };
  if (name.includes("key ratios")) return { bar_mode: "row", show_unit: false, collapsible: true };
  if (name === "6 Balance sheet") return { bar_mode: "column", show_unit: true, collapsible: true };
  if (name.includes("% of assets")) return { bar_mode: "column", show_unit: false, collapsible: true };
  return { bar_mode: "row", show_unit: false, collapsible: true };
}

function enrichBlock(block) {
  const inferred = getBlockDisplay(block);
  return {
    ...block,
    display: { ...inferred, ...(block.display || {}) },
  };
}

function fmtThousands(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function fmtPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtRatio(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(2);
}

function fmtCell(value, format) {
  if (format === "percent") return fmtPercent(value);
  if (format === "ratio") return fmtRatio(value);
  return fmtThousands(value, 0);
}

function computeScales(metrics, years, barMode) {
  const scales = {};
  const maxAbs = (vals) => (vals.length ? Math.max(...vals.map(Math.abs)) : 1e-12);

  if (barMode === "column") {
    years.forEach((y, yi) => {
      const vals = metrics.map((m) => m.values[y]).filter((v) => v != null);
      scales[`col_${yi}`] = maxAbs(vals);
    });
  } else if (barMode === "row") {
    metrics.forEach((m) => {
      const vals = years.map((y) => m.values[y]).filter((v) => v != null);
      scales[`row_${m.label}`] = maxAbs(vals);
    });
  }
  return scales;
}

function cellScale(scales, barMode, metric, yearIdx) {
  if (barMode === "column") return scales[`col_${yearIdx}`];
  if (barMode === "row") return scales[`row_${metric.label}`];
  return null;
}

function valueTextClass(value, blockName) {
  if (value === null || value === undefined || Number.isNaN(value)) return "val-muted";
  if (blockName.startsWith("2 Growth") || blockName.includes("Growth")) {
    if (value < 0) return "val-neg";
    if (value > 0) return "val-pos";
    return "";
  }
  if (value < 0) return "val-neg";
  return "";
}

function barColor(metric, value, blockName) {
  if (metric.bar_group && GROUP_COLORS[metric.bar_group]) {
    return GROUP_COLORS[metric.bar_group];
  }
  if (blockName.startsWith("2 Growth") && value != null) {
    return value < 0 ? GROUP_COLORS.growth_neg : GROUP_COLORS.growth;
  }
  if (value != null && value < 0) return GROUP_COLORS.growth_neg;
  return GROUP_COLORS.default;
}

function barColorCss(color, value, blockName) {
  const alpha = blockName.startsWith("2 Growth") ? 0.55 : 0.42;
  if (typeof color !== "string" || !color.startsWith("#")) return color;
  const h = color.slice(1);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderBarCell(value, scale, color, format, hasBar, blockName) {
  const valClass = valueTextClass(value, blockName);
  const formatted = fmtCell(value, format);

  if (!hasBar || value === null || value === undefined) {
    return `<td class="bar-cell bar-cell--plain"><span class="bar-text ${valClass}">${formatted}</span></td>`;
  }
  const safeScale = scale && scale > 0 ? scale : 1;
  const width = Math.max(6, Math.min(100, (Math.abs(value) / safeScale) * 100));
  const neg = value < 0 ? " bar-cell--neg" : "";
  const barCss = barColorCss(color, value, blockName);
  return `
    <td class="bar-cell${neg}">
      <div class="bar-meter" style="--bar-pct:${width.toFixed(1)}%;--bar-color:${barCss}">
        <span class="bar-text ${valClass}">${formatted}</span>
        <span class="bar-indicator" aria-hidden="true"></span>
      </div>
    </td>`;
}

function cornerHeader(block, currency, units) {
  const display = block.display;
  const showUnit = display.show_unit;
  const unitHint = showUnit
    ? `${currency} · ${units}`
    : block.name.includes("Growth") || block.name.includes("Profitability")
      ? "%"
      : block.name.includes("ratios")
        ? "Ratio / %"
        : block.name.includes("% of assets")
          ? "%"
          : "";

  return `
    <th class="corner-cell">
      <span class="corner-unit">${unitHint}</span>
      <span class="corner-label">Metric</span>
    </th>`;
}

function renderTable(block, metrics, currency, units) {
  const years = block.years;
  const display = block.display;
  const barMode = display.bar_mode;
  const scales = computeScales(metrics, years, barMode);
  const hasBar = Boolean(barMode);
  const head = years.map((y) => `<th>${y.replace("FY ", "")}</th>`).join("");

  const rows = metrics
    .map((m) => {
      const labelClass = m.bar_group ? `label-${m.bar_group}` : "";
      const cells = years
        .map((y, yi) => {
          const v = m.values[y];
          const scale = cellScale(scales, barMode, m, yi);
          const color = barColor(m, v, block.name);
          return renderBarCell(v, scale, color, m.format, hasBar, block.name);
        })
        .join("");
      return `<tr><td class="metric-label ${labelClass}">${renderMetricLabelHtml(block, m)}</td>${cells}</tr>`;
    })
    .join("");

  const wideTable = /balance sheet|% of assets/i.test(block.name || "");
  const tableClass = `magic-table mode-${barMode}${wideTable ? " mn-table-wide" : ""}`;

  return `
    <div class="table-wrap">
      <table class="${tableClass}">
        <colgroup>
          <col class="mn-col-label" />
          ${years.map(() => `<col class="mn-col-year" />`).join("")}
        </colgroup>
        <thead><tr>${cornerHeader(block, currency, units)}${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function filterMetrics(block, labels) {
  const labelSet = new Set(labels);
  return block.metrics.filter((m) => labelSet.has(m.label));
}

function attachBarGroups(metrics, groupId) {
  return metrics.map((m) => ({ ...m, bar_group: groupId }));
}

function renderNestedGroup(group, block, metrics, currency, units, groupIndex) {
  const groupMetrics = attachBarGroups(metrics, group.id);
  const bodyId = `group-body-${groupIndex}-${group.id}`;
  return `
    <div class="bs-subgroup collapsible" data-group="${group.id}">
      <button type="button" class="subgroup-toggle" aria-expanded="false" aria-controls="${bodyId}">
        <span class="chevron">+</span>
        <span class="subgroup-dot ${group.id}"></span>
        <span class="subgroup-title">${group.label}</span>
        <span class="subgroup-count">${metrics.length} lines</span>
      </button>
      <div id="${bodyId}" class="subgroup-body collapsed">
        ${renderTable({ ...block, metrics: groupMetrics }, groupMetrics, currency, units)}
      </div>
    </div>`;
}

function renderBalanceSheetSection(block, pctBlock, sectionIndex, currency, units) {
  const groups = block.display.collapsible_groups || [];
  const pctGroups = pctBlock?.display?.collapsible_groups || [];

  const absoluteGroups = groups.length
    ? groups
        .map((g, gi) =>
          renderNestedGroup(g, block, filterMetrics(block, g.metrics), currency, units, `abs-${gi}`),
        )
        .join("")
    : renderTable(block, block.metrics, currency, units);

  const pctSection = pctBlock
    ? `
      <div class="bs-pct-block">
        <p class="bs-pct-label">As % of Total Assets</p>
        ${
          pctGroups.length
            ? pctGroups
                .map((g, gi) =>
                  renderNestedGroup(
                    g,
                    pctBlock,
                    filterMetrics(pctBlock, g.metrics),
                    currency,
                    units,
                    `pct-${gi}`,
                  ),
                )
                .join("")
            : renderTable(pctBlock, pctBlock.metrics, currency, units)
        }
      </div>`
    : "";

  return `
    <section class="block-section collapsible" id="block-${sectionIndex}" data-section="${sectionIndex}">
      <button type="button" class="section-toggle" aria-expanded="false" aria-controls="section-body-${sectionIndex}">
        <span class="chevron">+</span>
        <span class="section-title">${block.name}</span>
      </button>
      <div id="section-body-${sectionIndex}" class="section-body collapsed">
        <div class="bs-groups">${absoluteGroups}</div>
        ${pctSection}
      </div>
    </section>`;
}

function renderStandardSection(block, sectionIndex, currency, units) {
  return `
    <section class="block-section collapsible" id="block-${sectionIndex}" data-section="${sectionIndex}">
      <button type="button" class="section-toggle" aria-expanded="false" aria-controls="section-body-${sectionIndex}">
        <span class="chevron">+</span>
        <span class="section-title">${block.name}</span>
      </button>
      <div id="section-body-${sectionIndex}" class="section-body collapsed">
        ${renderTable(block, block.metrics, currency, units)}
      </div>
    </section>`;
}

function openCollapsible(toggleBtn, bodyEl, expandChildren = false) {
  toggleBtn.setAttribute("aria-expanded", "true");
  bodyEl.classList.remove("collapsed");
  toggleBtn.classList.add("is-open");
  const chev = toggleBtn.querySelector(".chevron");
  if (chev) chev.textContent = "−";
  if (expandChildren) {
    bodyEl.querySelectorAll(".subgroup-toggle").forEach((btn) => {
      const childId = btn.getAttribute("aria-controls");
      const childBody = childId ? document.getElementById(childId) : btn.nextElementSibling;
      if (childBody) openCollapsible(btn, childBody);
    });
  }
  if (bodyEl.querySelector(".charts-grid-inner")) {
    ensureChartsInBody(bodyEl);
  }
}

function closeCollapsible(toggleBtn, bodyEl) {
  toggleBtn.setAttribute("aria-expanded", "false");
  bodyEl.classList.add("collapsed");
  toggleBtn.classList.remove("is-open");
  const chev = toggleBtn.querySelector(".chevron");
  if (chev) chev.textContent = "+";
}

function toggleCollapsible(toggleBtn, bodyEl) {
  const isOpen = toggleBtn.getAttribute("aria-expanded") === "true";
  if (isOpen) {
    closeCollapsible(toggleBtn, bodyEl);
    return;
  }
  const expandChildren = bodyEl.classList.contains("section-body") && bodyEl.querySelector(".bs-groups");
  openCollapsible(toggleBtn, bodyEl, expandChildren);
}

function bindCollapsibles(root) {
  root.querySelectorAll(".section-toggle, .subgroup-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const controls = btn.getAttribute("aria-controls");
      const body = controls ? document.getElementById(controls) : btn.nextElementSibling;
      if (body) {
        toggleCollapsible(btn, body);
        if (isMobileLayout() && body.closest("#fundamentals-data-panel")) {
          requestAnimationFrame(() => syncMobileMagicLabelColumn());
        }
      }
    });
  });
}

function expandSection(sectionIndex, { scroll = true } = {}) {
  const section = document.getElementById(`block-${sectionIndex}`);
  if (!section) return;
  const toggle = section.querySelector(".section-toggle");
  const body = section.querySelector(".section-body");
  if (toggle && body) {
    const expandChildren = body.classList.contains("section-body") && body.querySelector(".bs-groups");
    openCollapsible(toggle, body, expandChildren);
    syncFundamentalsNavActive({ block: sectionIndex });
    if (scroll) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function expandChartSection(sectionIndex, { scroll = true, solo = false } = {}) {
  document.querySelectorAll(".chart-section").forEach((section, i) => {
    const toggle = section.querySelector(".section-toggle");
    const body = section.querySelector(".section-body");
    if (!toggle || !body) return;
    if (solo && i !== sectionIndex) {
      closeCollapsible(toggle, body);
      return;
    }
    if (i === sectionIndex) {
      openCollapsible(toggle, body, false);
      ensureChartsInBody(body);
      if (scroll) section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  syncFundamentalsNavActive({ chart: sectionIndex });
}

function collapseAllChartSectionsExcept(sectionIndex) {
  document.querySelectorAll(".chart-section").forEach((section, i) => {
    const toggle = section.querySelector(".section-toggle");
    const body = section.querySelector(".section-body");
    if (!toggle || !body) return;
    if (i === sectionIndex) {
      openCollapsible(toggle, body, false);
      ensureChartsInBody(body);
    } else {
      closeCollapsible(toggle, body);
    }
  });
}

function collapseAllBlocksExcept(sectionIndex) {
  document.querySelectorAll("#blocks-container .block-section").forEach((section, i) => {
    const toggle = section.querySelector(".section-toggle");
    const body = section.querySelector(".section-body");
    if (!toggle || !body) return;
    if (i === sectionIndex) {
      const expandChildren = body.querySelector(".bs-groups");
      openCollapsible(toggle, body, !!expandChildren);
    } else {
      closeCollapsible(toggle, body);
    }
  });
}

function setNavSubGroupExpanded(groupKey, expanded) {
  const group = document.querySelector(`.nav-sub-group[data-sub-group="${groupKey}"]`);
  if (!group) return;
  const btn = group.querySelector(".nav-sub-expand-btn");
  const body = group.querySelector(".nav-sub-group-body");
  if (btn) {
    btn.textContent = expanded ? "−" : "+";
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    btn.classList.toggle("is-expanded", expanded);
  }
  if (body) body.hidden = !expanded;
}

function toggleNavSubGroup(groupKey) {
  const group = document.querySelector(`.nav-sub-group[data-sub-group="${groupKey}"]`);
  const btn = group?.querySelector(".nav-sub-expand-btn");
  const isExpanded = btn?.getAttribute("aria-expanded") === "true";
  setNavSubGroupExpanded(groupKey, !isExpanded);
}

function syncFundamentalsNavActive({ chart, block } = {}) {
  const nav = document.getElementById("fundamentals-subnav");
  if (!nav) return;
  nav.querySelectorAll("[data-chart-section]").forEach((a) => {
    a.classList.toggle("active", chart != null && Number(a.dataset.chartSection) === chart);
  });
  nav.querySelectorAll("[data-section]").forEach((a) => {
    a.classList.toggle("active", block != null && Number(a.dataset.section) === block);
  });
}

function applyFundamentalsDefaults() {
  setNavSubExpanded("fundamentals", true);
  setNavSubGroupExpanded("graphs", true);
  setNavSubGroupExpanded("magic", true);
  collapseAllChartSectionsExcept(0);
  collapseAllBlocksExcept(0);
  syncFundamentalsNavActive({ chart: 0, block: 0 });
  requestAnimationFrame(() => {
    document.getElementById("chart-block-0")?.scrollIntoView({ behavior: "instant", block: "start" });
  });
}

function navShortTitle(title) {
  return String(title || "")
    .replace(/^\d+\s*/, "")
    .slice(0, 46);
}

function renderNav(blocks, data) {
  const nav = document.getElementById("fundamentals-subnav");
  if (!nav) return;
  const sections = normalizeChartSections(data);
  const topBlocks = blocks.filter(
    (b) => !b.display?.parent_section && !b.name.includes("% of assets"),
  );

  const graphsLinks = sections
    .map(
      (s, i) => `
    <a href="#chart-${i}" class="nav-sub-link nav-sub-link-nested" data-chart-section="${i}">
      <span class="nav-num">G${i + 1}</span>
      <span class="nav-sub-label">${navShortTitle(s.title)}</span>
    </a>`,
    )
    .join("");

  const magicLinks = topBlocks
    .map(
      (b, i) => `
    <a href="#block-${i}" class="nav-sub-link nav-sub-link-nested" data-section="${i}">
      <span class="nav-num">${i + 1}</span>
      <span class="nav-sub-label">${navShortTitle(b.name)}</span>
    </a>`,
    )
    .join("");

  nav.innerHTML = `
    <div class="nav-sub-group" data-sub-group="graphs">
      <div class="nav-sub-group-head">
        <button type="button" class="nav-sub-expand-btn is-expanded" data-sub-expand="graphs" aria-expanded="true" aria-label="Hide graph sections">−</button>
        <span class="nav-sub-group-title"><span class="nav-num nav-num-sub">GP</span> Graphs</span>
      </div>
      <div class="nav-sub-group-body" id="graphs-subnav">${graphsLinks}</div>
    </div>
    <div class="nav-sub-group" data-sub-group="magic">
      <div class="nav-sub-group-head">
        <button type="button" class="nav-sub-expand-btn is-expanded" data-sub-expand="magic" aria-expanded="true" aria-label="Hide magic numbers sections">−</button>
        <span class="nav-sub-group-title"><span class="nav-num nav-num-sub">MN</span> Magic Numbers</span>
      </div>
      <div class="nav-sub-group-body" id="magic-subnav">${magicLinks}</div>
    </div>`;

  nav.querySelectorAll(".nav-sub-expand-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNavSubGroup(btn.dataset.subExpand);
    });
  });

  nav.querySelectorAll("[data-chart-section]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setDomain("fundamentals");
      setNavSubExpanded("fundamentals", true);
      setNavSubGroupExpanded("graphs", true);
      const idx = Number(link.dataset.chartSection);
      collapseAllChartSectionsExcept(idx);
      syncFundamentalsNavActive({ chart: idx });
      const params = new URLSearchParams(window.location.search);
      const qs = params.toString();
      window.history.replaceState({}, "", `${qs ? `?${qs}` : "/"}#chart-${idx}`);
    });
  });

  nav.querySelectorAll("[data-section]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setDomain("fundamentals");
      setNavSubExpanded("fundamentals", true);
      setNavSubGroupExpanded("magic", true);
      const idx = Number(link.dataset.section);
      collapseAllBlocksExcept(idx);
      syncFundamentalsNavActive({ block: idx });
      const params = new URLSearchParams(window.location.search);
      const qs = params.toString();
      window.history.replaceState({}, "", `${qs ? `?${qs}` : "/"}#block-${idx}`);
      document.getElementById(`block-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderBlocks(blocks, currency, units) {
  const enriched = blocks.map(enrichBlock);
  const pctBlock = enriched.find(
    (b) => b.display?.parent_section === 6 || b.name.includes("% of assets"),
  );
  const topBlocks = enriched.filter(
    (b) => !b.display?.parent_section && !b.name.includes("% of assets"),
  );

  const container = document.getElementById("blocks-container");
  container.innerHTML = topBlocks
    .map((block, i) => {
      if (block.name === "6 Balance sheet") {
        return renderBalanceSheetSection(block, pctBlock, i, currency, units);
      }
      return renderStandardSection(block, i, currency, units);
    })
    .join("");

  bindCollapsibles(container);
}

function renderMarketBar(mb) {
  const el = document.getElementById("bb-market-strip");
  if (!el || !mb) return;

  if (mb.price == null) {
    el.textContent = "Market P — / —";
    return;
  }

  const bid = mb.price.toFixed(2);
  const ask = (mb.ask ?? mb.price + 0.01).toFixed(2);
  const dir = mb.direction || "";
  const dirClass = dir === "↑" ? "dir-up" : dir === "↓" ? "dir-down" : "";

  const parts = [
    `Market P <span class="${dirClass}">${dir}${bid}/${ask}</span>`,
  ];
  if (mb.pe != null) parts.push(`P/E ${mb.pe.toFixed(2)}`);
  if (mb.pb != null) parts.push(`P/BV ${mb.pb.toFixed(2)}`);
  if (mb.prev != null) parts.push(`Prev ${mb.prev.toFixed(2)}`);

  el.innerHTML = parts.join("  ");
}

function renderHeader(data) {
  const opId = data.one_pager?.identity;
  document.getElementById("company-name").textContent =
    opId?.name || data.company || data.ticker;
  const yrs = data.blocks?.[0]?.years || [];
  const yrRange =
    yrs.length >= 1
      ? `${yrs.length} FY · ${yrs[0].replace("FY ", "")}–${yrs[yrs.length - 1].replace("FY ", "")}`
      : "";
  const src =
    data.source === "fmp"
      ? ` · FMP`
      : data.source && data.source !== "preload"
        ? ` · ${data.source}`
        : "";
  document.getElementById("company-meta").textContent =
    `${data.ticker} · ${data.currency} · ${data.units}${yrRange ? ` · ${yrRange}` : ""}${src}`;

  const badge = document.getElementById("bb-badge");
  const fx = document.getElementById("bb-fx");
  const security = document.getElementById("bb-redbar-security");
  const tickerLabel = data.ticker || "—";
  if (badge) badge.textContent = tickerLabel;
  if (fx) fx.textContent = data.market_bar?.fx_label || (data.currency === "USD" ? "US $" : data.currency);
  if (security) security.textContent = data.company || data.ticker;

  renderMarketBar(data.market_bar);

  document.title =
    currentDomain === "valuation"
      ? `THESIS · VALUATION · ${tickerLabel}`
      : currentDomain === "fundamentals"
        ? `THESIS · FUNDAMENTALS · ${tickerLabel}`
        : `THESIS · ONE-PAGER · ${tickerLabel}`;
}

function renderStars(count, max = 5) {
  const n = Math.max(0, Math.min(max, Number(count) || 0));
  return Array.from({ length: max }, (_, i) => {
    const filled = i < n;
    return `<span class="op-star ${filled ? "op-star-filled" : "op-star-empty"}" aria-hidden="true">${
      filled ? "★" : "☆"
    }</span>`;
  }).join("");
}

function fmtOpMetric(metric) {
  const v = metric?.value;
  if (v == null || Number.isNaN(v)) return "—";
  if (metric.format === "percent") return `${(v * 100).toFixed(1)}%`;
  if (metric.format === "ratio") return Number(v).toFixed(2);
  return fmtPrice(v);
}

function fmtOpMcap(label, raw) {
  if (label) return label;
  if (raw == null) return "—";
  if (raw >= 1e12) return `$${(raw / 1e12).toFixed(2)}T`;
  if (raw >= 1e9) return `$${(raw / 1e9).toFixed(1)}B`;
  if (raw >= 1e6) return `$${(raw / 1e6).toFixed(0)}M`;
  return `$${raw.toLocaleString()}`;
}

async function fetchOnePagerFallback(ticker) {
  const sym = String(ticker || "MSFT").toLowerCase();
  try {
    const res = await fetch(`/static/one_pager/${sym}_one_pager.json`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function renderOnePager(data) {
  const container = document.getElementById("one-pager-container");
  if (!container) return;

  const paint = (payload) => {
    if (!container.isConnected) return;
    const op = payload?.one_pager;
    if (!op) {
      container.innerHTML = `<p class="val-comment-dim">One-pager unavailable. Restart start.bat or run build_one_pager_cache.py.</p>`;
      return;
    }
    const merged = { ...payload, market_bar: payload.market_bar || data.market_bar };
    container.innerHTML = buildOnePagerHtml(merged);
  };

  if (data.one_pager) {
    paint(data);
    return;
  }

  container.innerHTML = `<p class="val-comment-dim">Loading one-pager…</p>`;
  fetchOnePagerFallback(data.ticker).then((fb) => {
    if (fb?.one_pager) paint({ ...data, one_pager: fb.one_pager, market_bar: fb.market_bar || data.market_bar });
    else paint(data);
  });
}

function buildMobileOnePagerHubHtml(data) {
  const op = data.one_pager;
  const id = op?.identity || {};
  const market = data.market_bar?.price;
  const rawDesc = id.description || "";
  const mobileDescMax = 210;
  const shortDesc = rawDesc
    ? rawDesc.length > mobileDescMax
      ? `${rawDesc.slice(0, mobileDescMax - 1).trim()}…`
      : rawDesc
    : "Investment thesis overview.";
  const priceStr =
    market != null
      ? fmtPrice(market)
      : id.price != null
        ? fmtPrice(id.price)
        : "";

  const metaChips = [
    id.sector,
    id.industry,
    id.country,
    id.market_cap_label || fmtOpMcap(null, id.market_cap),
  ].filter(Boolean);
  const metaHtml = metaChips.length
    ? `<div class="op-mobile-meta">${metaChips.map((c) => `<span class="op-mobile-chip">${c}</span>`).join("")}</div>`
    : "";

  const segments = (id.segments || []).slice(0, 5);
  const segmentsHtml = segments.length
    ? `<ul class="op-segments op-mobile-segments">${segments
        .map(
          (s) =>
            `<li><span class="op-seg-name">${s.name}</span><span class="op-seg-pct">${(s.pct * 100).toFixed(0)}%</span></li>`,
        )
        .join("")}</ul>`
    : "";
  const divisionsHtml = segmentsHtml
    ? `<section class="op-mobile-divisions" aria-labelledby="op-mobile-div-title">
        <h3 class="op-mobile-section-title" id="op-mobile-div-title">Revenue division</h3>
        ${segmentsHtml}
      </section>`
    : "";

  const metricsHtml = (op.snapshot_metrics || [])
    .map(
      (m) => `
      <div class="op-metric op-mobile-metric">
        <span class="op-metric-k">${m.label}</span>
        <span class="op-metric-v">${fmtOpMetric(m)}</span>
      </div>`,
    )
    .join("");

  const scorecardsHtml = (op.scorecards || [])
    .map(
      (sc) => `
      <div class="op-scorecard op-mobile-scorecard" title="${sc.methodology || ""}">
        <span class="op-scorecard-label">${sc.label}</span>
        <div class="op-stars op-mobile-stars" aria-label="${sc.stars} of ${sc.max_stars || 5} stars">${renderStars(sc.stars, sc.max_stars || 5)}</div>
      </div>`,
    )
    .join("");

  const val = op.valuation_snapshot || {};
  const valMethods = val.methods || [];
  const valCardsHtml = valMethods
    .map((m) => {
      const upside =
        market != null && market > 0 && m.price != null ? m.price / market - 1 : null;
      const upCls = upside == null ? "" : upside >= 0 ? "val-upside" : "val-downside";
      const upStr =
        upside != null ? `${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(0)}%` : "";
      return `
      <div class="op-mobile-val-card">
        <span class="op-mobile-val-k">${m.label}</span>
        <span class="op-mobile-val-v">${m.price != null ? fmtPrice1(m.price) : "—"}</span>
        ${upStr ? `<span class="op-mobile-val-up ${upCls}">${upStr}</span>` : ""}
      </div>`;
    })
    .join("");

  return `
    <div class="op-mobile-hub">
      <header class="op-mobile-hero">
        <div class="op-mobile-title-row">
          <h2 class="op-mobile-title">${id.name || data.ticker}</h2>
          <span class="op-mobile-ticker">${id.ticker || data.ticker}</span>
        </div>
        ${priceStr ? `<p class="op-mobile-price">${priceStr}</p>` : ""}
        ${metaHtml}
      </header>

      <section class="op-mobile-valuation" aria-labelledby="op-mobile-val-title">
        <h3 class="op-mobile-section-title" id="op-mobile-val-title">Valuation snapshot</h3>
        <div class="op-mobile-val-row">${valCardsHtml}</div>
      </section>

      <p class="op-mobile-desc">${shortDesc}</p>
      ${divisionsHtml}

      <div class="op-mobile-body">
        <section class="op-mobile-panel op-mobile-metrics" aria-labelledby="op-mobile-metrics-title">
          <h3 class="op-mobile-section-title" id="op-mobile-metrics-title">Investment snapshot</h3>
          <div class="op-mobile-metrics-list">${metricsHtml}</div>
        </section>
        <section class="op-mobile-panel op-mobile-scores" aria-labelledby="op-mobile-scores-title">
          <h3 class="op-mobile-section-title" id="op-mobile-scores-title">Quality scorecards</h3>
          <div class="op-mobile-scorecards">${scorecardsHtml}</div>
        </section>
      </div>

      <div class="op-mobile-actions">
        <button type="button" class="op-mobile-btn op-mobile-btn-fd op-mobile-trade-btn op-mobile-trade-buy" data-mobile-go="fundamentals">
          <span class="op-mobile-trade-label">FUNDAMENTALS</span>
          <span class="op-mobile-trade-sub">Graphs · Magic Numbers</span>
        </button>
        <button type="button" class="op-mobile-btn op-mobile-btn-vl op-mobile-trade-btn op-mobile-trade-sell" data-mobile-go="valuation">
          <span class="op-mobile-trade-label">VALUATIONS</span>
          <span class="op-mobile-trade-sub">DCF · Multiples · Consensus</span>
        </button>
      </div>
    </div>`;
}

function buildOnePagerHtml(data) {
  const op = data.one_pager;

  const id = op.identity || {};
  const market = data.market_bar?.price;
  const priceStr =
    market != null
      ? `${id.price_direction || ""} ${fmtPrice(market)}`.trim()
      : id.price != null
        ? fmtPrice(id.price)
        : "—";

  const metaChips = [
    id.sector,
    id.industry,
    id.country,
    id.market_cap_label || fmtOpMcap(null, id.market_cap),
  ].filter(Boolean);

  const segments = (id.segments || []).slice(0, 5);
  const segmentsHtml = segments.length
    ? `<ul class="op-segments">${segments
        .map(
          (s) =>
            `<li><span class="op-seg-name">${s.name}</span><span class="op-seg-pct">${(s.pct * 100).toFixed(0)}%</span></li>`,
        )
        .join("")}</ul>`
    : "";

  const desc = id.description
    ? `<p class="op-description">${id.description.length > 420 ? `${id.description.slice(0, 417)}…` : id.description}</p>`
    : `<p class="op-description op-description-dim">Company description unavailable — run backend/scripts/build_profile_cache.py</p>`;

  const metricsHtml = (op.snapshot_metrics || [])
    .map(
      (m) => `
      <div class="op-metric">
        <span class="op-metric-k">${m.label}</span>
        <span class="op-metric-sub">${m.sublabel || ""}</span>
        <span class="op-metric-v">${fmtOpMetric(m)}</span>
      </div>`,
    )
    .join("");

  const scorecardsHtml = (op.scorecards || [])
    .map(
      (sc) => `
      <div class="op-scorecard" title="${sc.methodology || ""}">
        <div class="op-scorecard-head">
          <span class="op-scorecard-label">${sc.label}</span>
          <span class="op-scorecard-count">${sc.stars}/${sc.max_stars || 5}</span>
        </div>
        <div class="op-stars" aria-label="${sc.stars} of ${sc.max_stars || 5} stars">${renderStars(sc.stars, sc.max_stars || 5)}</div>
      </div>`,
    )
    .join("");

  const val = op.valuation_snapshot || {};
  const valMethods = val.methods || [];
  const valCardsHtml = valMethods
    .map((m) => {
      const upside =
        market != null && market > 0 && m.price != null ? m.price / market - 1 : null;
      const upCls = upside == null ? "" : upside >= 0 ? "val-upside" : "val-downside";
      const upStr =
        upside != null ? `${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(1)}%` : "";
      return `
      <div class="op-val-card">
        <span class="op-val-k">${m.label}</span>
        <span class="op-val-v">${m.price != null ? fmtPrice1(m.price) : "—"}</span>
        ${upStr ? `<span class="op-val-up ${upCls}">${upStr}</span>` : ""}
      </div>`;
    })
    .join("");

  const blendUp =
    market != null && market > 0 && val.blend_price != null
      ? val.blend_price / market - 1
      : null;
  const blendCls = blendUp == null ? "" : blendUp >= 0 ? "val-upside" : "val-downside";

  return `
    ${buildMobileOnePagerHubHtml(data)}
    <div class="op-sheet op-desktop-sheet">
      <header class="op-hero">
        <div class="op-hero-left">
          <div class="op-hero-title-row">
            <h2 class="op-company-name">${id.name || data.ticker}</h2>
            <span class="op-ticker-badge">${id.ticker || data.ticker}</span>
          </div>
          <div class="op-hero-meta">${metaChips.map((c) => `<span class="op-chip">${c}</span>`).join("")}</div>
        </div>
        <div class="op-hero-price">
          <span class="op-price-k">Last</span>
          <span class="op-price-v">${priceStr}</span>
        </div>
      </header>

      <div class="op-about">
        ${desc}
        ${segmentsHtml}
      </div>

      <div class="op-body">
        <section class="op-panel op-panel-metrics" aria-labelledby="op-metrics-title">
          <h3 class="op-panel-title" id="op-metrics-title">Investment snapshot</h3>
          <div class="op-metrics-grid">${metricsHtml}</div>
        </section>
        <section class="op-panel op-panel-scores" aria-labelledby="op-scores-title">
          <h3 class="op-panel-title" id="op-scores-title">Quality scorecards</h3>
          <div class="op-scorecards">${scorecardsHtml}</div>
        </section>
      </div>

      <section class="op-valuation" aria-labelledby="op-val-title">
        <div class="op-val-head">
          <h3 class="op-panel-title" id="op-val-title">Valuation snapshot</h3>
          <div class="op-val-blend">
            <span class="op-val-blend-k">Blend avg</span>
            <span class="op-val-blend-v">${val.blend_price != null ? fmtPrice1(val.blend_price) : "—"}</span>
            ${
              blendUp != null
                ? `<span class="op-val-blend-up ${blendCls}">${blendUp >= 0 ? "+" : ""}${(blendUp * 100).toFixed(1)}% vs mkt</span>`
                : ""
            }
          </div>
        </div>
        <div class="op-val-grid">${valCardsHtml}</div>
        <p class="op-val-note">DCF · P/E &amp; P/BV at historical median · analyst consensus median · equal-weight blend</p>
      </section>
    </div>`;
}

function tickClock() {
  const el = document.getElementById("bb-clock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

let currentThesisData = null;
let heavySectionsTicker = null;
let heavySectionsDone = false;
let heavyRenderPromise = null;

function scheduleHeavySectionsRender(data) {
  const run = () => ensureHeavySectionsRendered(data);
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 80);
  }
}

function ensureHeavySectionsRendered(data) {
  if (!data) return Promise.resolve();
  const sym = String(data.ticker || "").toUpperCase();
  if (heavySectionsDone && heavySectionsTicker === sym) return Promise.resolve();
  if (heavyRenderPromise) return heavyRenderPromise;
  heavyRenderPromise = ensureChartJs()
    .then(() => {
      renderCharts(data);
      renderBlocks(data.blocks, data.currency, data.units);
      renderValuation(data);
      if (typeof renderValuationDraft === "function") renderValuationDraft(data);
      renderMultiplesValuation(data);
      renderConsensusValuation(data);
      if (currentDomain === "valuation") setValuationMethod(currentValuationMethod);
      setupMobileFundamentalsNav(data);
      setupMobileMagicNav(data.blocks);
      setupMobileValuationNav();
      setupMobileChartCarousels();
      syncMobileMagicLabelColumn();
      heavySectionsDone = true;
      heavySectionsTicker = sym;
    })
    .catch((err) => console.error("Heavy sections render failed:", err))
    .finally(() => {
      heavyRenderPromise = null;
    });
  return heavyRenderPromise;
}
let valuationFlowChart = null;
let valuationState = null;
let multiplesPeChart = null;
let multiplesPeEpsChart = null;
let multiplesPbvChart = null;
let multiplesPbvBvChart = null;
let multiplesState = null;

function normalizeValuation(data) {
  const v = data?.valuation;
  if (!v || typeof v !== "object") return null;
  if ("dcf" in v || "pe" in v || "pbv" in v || "consensus" in v) return v;
  if (v.method === "dcf") return { dcf: v };
  if (v.method === "pe") return { pe: v };
  if (v.method === "pbv") return { pbv: v };
  return v;
}

function multiplesBundleMissingMessage() {
  return (
    "Multiples data missing — wrong or stale server. " +
    "Close every server window, run start.bat from value-investing-analyzer (port 8002), " +
    "then open http://127.0.0.1:8002/?ticker=AAPL#valuation-multiples and hard-refresh (Ctrl+F5)."
  );
}

function getValuationDcf(data) {
  const v = normalizeValuation(data);
  if (!v) return null;
  return v.dcf ?? v;
}

function getValuationPe(data) {
  const v = normalizeValuation(data);
  if (!v) return null;
  if (v.pe != null && typeof v.pe === "object") return v.pe;
  if (v.method === "dcf" || (v.dcf && !v.pe)) {
    return { error: multiplesBundleMissingMessage() };
  }
  return null;
}

function getValuationPbv(data) {
  const v = normalizeValuation(data);
  if (!v) return null;
  if (v.pbv != null && typeof v.pbv === "object") return v.pbv;
  if (v.method === "dcf" || (v.dcf && !v.pbv)) {
    return { error: multiplesBundleMissingMessage() };
  }
  return null;
}

function getValuationConsensus(data) {
  const v = normalizeValuation(data);
  if (!v) return null;
  if (v.consensus) return v.consensus;
  if (v.pe || v.pbv) {
    return {
      error:
        "Analyst consensus missing — stale server. Close all server windows, run start.bat again, then hard-refresh (Ctrl+F5).",
    };
  }
  return null;
}

const VAL_FLOW = {
  revenue: BB.amber,
  ni: BB.gold,
  fcff: BB.green,
};

const VAL_FLOW_LABEL_COLORS = [VAL_FLOW.revenue, VAL_FLOW.ni, VAL_FLOW.fcff];

const VAL_FLOW_FONT = {
  barLabel: 12,
  axis: 11,
  legend: 11,
  terminal: 13,
  terminalSub: 10,
};

/** Gap between adjacent bars = barWidth / VAL_FLOW_BAR_GAP_DIVISOR (e.g. 3 → one-third of bar width). */
const VAL_FLOW_BAR_GAP_DIVISOR = 3;

function flowGroupedBarPercentage(gapDivisor = VAL_FLOW_BAR_GAP_DIVISOR) {
  return 1 / (1 + 1 / gapDivisor);
}

/** Flow chart labels: billions, max ~3 digits, no decimals. */
function fmtFlowBillions(mln) {
  if (mln === null || mln === undefined || Number.isNaN(mln)) return "—";
  const b = mln / 1000;
  const abs = Math.abs(b);
  if (abs < 0.5) return "0";
  return String(Math.round(b));
}

/** Billions with thousands separator (e.g. terminal value 3400 → 3,400). */
function fmtFlowBillionsComma(mln) {
  const core = fmtFlowBillions(mln);
  if (core === "—") return core;
  return Number(core).toLocaleString("en-US");
}

function fmtDiscMultiplier(factor) {
  if (factor === null || factor === undefined || !Number.isFinite(factor) || factor <= 0) return "—";
  return (1 / factor).toFixed(2);
}

function flowCategoryCenterX(chart, index) {
  const xScale = chart.scales?.x;
  if (xScale?.getPixelForValue) {
    return xScale.getPixelForValue(index);
  }
  let sum = 0;
  let count = 0;
  chart.data.datasets.forEach((_, dsIndex) => {
    const bar = chart.getDatasetMeta(dsIndex).data[index];
    if (bar && Number.isFinite(bar.x)) {
      sum += bar.x;
      count += 1;
    }
  });
  return count ? sum / count : 0;
}

function syncValuationFlowFooter(chart) {
  const footer = document.getElementById("val-pv-footer");
  const labelsEl = document.getElementById("val-pv-labels");
  const strip = document.getElementById("val-pv-strip");
  if (!footer || !strip || !chart?.chartArea) return;

  const meta = chart.getDatasetMeta(0);
  const cols = strip.querySelectorAll(".val-pv-col");
  if (!cols.length || cols.length !== meta.data.length) return;

  const { chartArea } = chart;

  if (labelsEl) {
    labelsEl.style.width = `${chartArea.left}px`;
  }
  strip.style.left = `${chartArea.left}px`;
  strip.style.width = `${chartArea.width}px`;

  cols.forEach((col, i) => {
    const label = chart.data.labels[i];
    if (label === "" || col.classList.contains("val-pv-gap")) {
      col.style.display = "none";
      return;
    }
    const centerX = flowCategoryCenterX(chart, i);
    col.style.display = "flex";
    col.style.flexDirection = "column";
    col.style.alignItems = "center";
    col.style.position = "absolute";
    col.style.left = `${centerX - chartArea.left}px`;
    col.style.transform = "translateX(-50%)";
    col.style.top = "0";
  });
}

const valFlowBarLabelsPlugin = {
  id: "valFlowBarLabels",
  afterDatasetsDraw(chart) {
    const { ctx, data, chartArea } = chart;
    ctx.save();
    ctx.font = `700 ${VAL_FLOW_FONT.barLabel}px Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    data.datasets.forEach((dataset, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      meta.data.forEach((bar, i) => {
        const v = dataset.data[i];
        if (v == null || Number.isNaN(v)) return;
        ctx.fillStyle = VAL_FLOW_LABEL_COLORS[dsIndex] || BB.grayLight;
        ctx.fillText(fmtFlowBillions(v), bar.x, bar.y - 5);
      });
    });

    const tvMln = chart.$terminalValueMln;
    const tvIdx = data.labels.length - 1;
    if (tvMln != null && tvIdx >= 0 && data.labels[tvIdx] === "Term. value") {
      const yScale = chart.scales?.y;
      const x = flowCategoryCenterX(chart, tvIdx);
      const tvBillions = tvMln / 1000;
      const y =
        yScale?.getPixelForValue && Number.isFinite(tvBillions)
          ? yScale.getPixelForValue(tvBillions)
          : chartArea.top + 28;
      ctx.fillStyle = VAL_FLOW.fcff;
      ctx.font = `700 ${VAL_FLOW_FONT.terminal}px Consolas, monospace`;
      ctx.fillText(`${fmtFlowBillionsComma(tvMln)}B`, x, Math.max(chartArea.top + 14, y - 5));
    }

    ctx.restore();
  },
};

function fmtPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Number(value).toFixed(2)}`;
}

function fmtPrice1(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Number(value).toFixed(1)}`;
}

function fmtPriceWhole(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Math.round(Number(value))}`;
}

function fmtEps(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Number(value).toFixed(2)}`;
}

function peMultipleToneStyle(selectedPe, medianPe) {
  if (selectedPe == null || medianPe == null || medianPe <= 0) return {};
  const diff = (selectedPe - medianPe) / medianPe;
  if (Math.abs(diff) < 0.02) {
    return { color: "var(--bb-amber)" };
  }
  if (diff < 0) {
    const sat = Math.min(95, 55 + Math.abs(diff) * 120);
    return { color: `hsl(0, ${sat}%, 58%)` };
  }
  const sat = Math.min(95, 50 + diff * 100);
  return { color: `hsl(128, ${sat}%, 48%)` };
}

function fmtPctPoints(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

const VAL_PERCENTILE_TICKS = [25, 50, 75];
const VAL_PERCENTILE_SLIDER_MIN = 0;
const VAL_PERCENTILE_SLIDER_MAX = 100;
const VAL_PERCENTILE_VISUAL_MAX = 100;

const VAL_CONTROL_FORMAT = {
  revenue_growth: "percent",
  net_margin: "percent",
  cfo_to_ni: "ratio",
  capex_to_cfo: "percent",
};

function formatControlInputRaw(format, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (format === "ratio") return Number(value).toFixed(1);
  if (format === "percent") return (value * 100).toFixed(1);
  return String(value);
}

function parseControlInput(format, text) {
  const cleaned = String(text).trim().replace(/x$/i, "").replace(/%$/, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  if (format === "percent") return n / 100;
  return n;
}

function percentileInterpSorted(xs, p) {
  const frac = p / 100;
  const k = (xs.length - 1) * frac;
  const f = Math.floor(k);
  const c = Math.min(f + 1, xs.length - 1);
  if (f === c) return xs[f];
  return xs[f] + (xs[c] - xs[f]) * (k - f);
}

function percentileValue(values, p) {
  const xs = (values || []).filter((v) => v != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];

  if (p >= 0 && p <= 100) return percentileInterpSorted(xs, p);

  const v0 = percentileInterpSorted(xs, 0);
  const v25 = percentileInterpSorted(xs, 25);
  const v75 = percentileInterpSorted(xs, 75);
  const v100 = percentileInterpSorted(xs, 100);

  if (p > 100) {
    const slope = (v100 - v75) / 25;
    if (Math.abs(slope) < 1e-12) return v100;
    return v100 + slope * (p - 100);
  }

  const slopeLow = (v25 - v0) / 25;
  if (Math.abs(slopeLow) < 1e-12) return v0;
  return v0 + slopeLow * p;
}

function valueToPercentile(values, target) {
  if (target == null || Number.isNaN(target)) return 50;
  const loVal = percentileValue(values, 0);
  const hiVal = percentileValue(values, 100);
  if (loVal == null || hiVal == null) return 50;

  if (target >= loVal && target <= hiVal) {
    let lo = 0;
    let hi = 100;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      const v = percentileValue(values, mid);
      if (v == null) break;
      if (v < target) lo = mid;
      else hi = mid;
    }
    return Math.round((lo + hi) / 2);
  }

  if (target > hiVal) {
    const v75 = percentileValue(values, 75);
    const slope = (hiVal - v75) / 25;
    if (Math.abs(slope) < 1e-12) return 100;
    return Math.round(100 + (target - hiVal) / slope);
  }

  const v25 = percentileValue(values, 25);
  const slopeLow = (v25 - loVal) / 25;
  if (Math.abs(slopeLow) < 1e-12) return 0;
  return Math.round((target - loVal) / slopeLow);
}

function sliderPercentilePosition(percentile) {
  return Math.max(0, Math.min(VAL_PERCENTILE_VISUAL_MAX, percentile));
}

function clampSliderPercentile(p) {
  return Math.max(VAL_PERCENTILE_SLIDER_MIN, Math.min(VAL_PERCENTILE_SLIDER_MAX, Math.round(p)));
}

function sliderTrackWrap(sense, inputAttrs) {
  const senseClass = sense === "down" ? "val-slider-sense-down" : "val-slider-sense-up";
  return `
            <div class="val-slider-track-wrap">
              <div class="val-slider-gradient ${senseClass}" aria-hidden="true"></div>
              <input type="range" class="val-slider val-slider-compact val-slider-overlay" ${inputAttrs} />
            </div>`;
}

function updateSliderTickHighlight(slider, percentile) {
  slider?.closest(".val-slider-col")?.querySelectorAll(".val-slider-tick").forEach((tick) => {
    const t = Number(tick.dataset.pct);
    tick.classList.toggle("is-active", Math.abs(percentile - t) <= 4);
  });
  const readout = slider?.closest(".val-slider-col")?.querySelector(".val-slider-readout");
  if (readout) {
    const pct = Math.round(percentile);
    readout.textContent = pct > VAL_PERCENTILE_VISUAL_MAX ? `${pct}+` : String(pct);
    readout.style.left = `${sliderPercentilePosition(percentile)}%`;
  }
}

function percentileSliderTicks() {
  return VAL_PERCENTILE_TICKS.map((p) => {
    const pos = sliderPercentilePosition(p);
    return `<span class="val-slider-tick" data-pct="${p}" style="left:${pos}%">${p}</span>`;
  }).join("");
}
function assumptionInputWrap(id, format, defaultPct, sense = "up") {
  const suffix = format === "ratio" ? "x" : "%";
  const inputAttrs = `id="ctrl-slider-${id}" data-percentile="${id}"
                min="${VAL_PERCENTILE_SLIDER_MIN}" max="${VAL_PERCENTILE_SLIDER_MAX}" step="1" value="${defaultPct ?? 50}"
                aria-label="${id} historical percentile"`;
  return `
        <div class="val-assumption-input-row">
          <div class="val-assumption-input-wrap">
            <input type="text" id="ctrl-input-${id}" class="val-assumption-input" data-assumption="${id}"
              data-format="${format}" inputmode="decimal" aria-label="${id} value" />
            <span class="val-assumption-suffix">${suffix}</span>
          </div>
          <div class="val-slider-col">
            ${sliderTrackWrap(sense, inputAttrs)}
            <div class="val-slider-ticks" aria-hidden="true">${percentileSliderTicks()}</div>
            <span class="val-slider-readout" id="ctrl-readout-${id}" title="Historical percentile">50</span>
          </div>
        </div>`;
}

function fmtControlValue(format, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (format === "ratio") return `${Number(value).toFixed(1)}x`;
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  return String(value);
}

function fmtAssumption(format, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (format === "ratio") return fmtRatio(value);
  if (format === "percent_points") return `${(value * 100).toFixed(2)}%`;
  return fmtPctPoints(value);
}

function projectFlows(engine, assumptions) {
  const years = [];
  const revenue = [];
  const netIncome = [];
  const fcff = [];
  let rev =
    engine.first_forecast_rev_mln != null
      ? engine.first_forecast_rev_mln
      : engine.last_revenue_mln * (1 + assumptions.revenue_growth);

  for (let i = 1; i <= engine.forecast_years; i++) {
    years.push(`FY ${engine.base_year + i}`);
    const ni = rev * assumptions.net_margin;
    const cfo = ni * assumptions.cfo_to_ni;
    const cap = -cfo * assumptions.capex_to_cfo;
    const f = cfo + cap;
    revenue.push(rev);
    netIncome.push(ni);
    fcff.push(f);
    rev *= 1 + assumptions.revenue_growth;
  }
  return { years, revenue_mln: revenue, net_income_mln: netIncome, fcff_mln: fcff };
}

function computeDcfResult(forecastFcff, engine, wacc, terminalG) {
  if (!forecastFcff?.length || wacc <= terminalG || engine.shares_mln <= 0) return null;
  const n = forecastFcff.length;
  let pvFcffSum = 0;
  const discountRows = forecastFcff.map((fcff, i) => {
    const yearN = i + 1;
    const factor = (1 + wacc) ** yearN;
    const pv = fcff / factor;
    pvFcffSum += pv;
    return { year_n: yearN, fcff_mln: fcff, discount_factor: factor, pv_fcff_mln: pv };
  });
  const lastFcff = forecastFcff[n - 1];
  const terminalValue = (lastFcff * (1 + terminalG)) / (wacc - terminalG);
  const pvTerminal = terminalValue / (1 + wacc) ** n;
  const enterpriseValue = pvFcffSum + pvTerminal;
  const equityValue = enterpriseValue + engine.cash_mln + engine.debt_mln;
  return {
    discount_rows: discountRows,
    terminal_value_mln: terminalValue,
    pv_terminal_mln: pvTerminal,
    pv_fcff_sum_mln: pvFcffSum,
    enterprise_value_mln: enterpriseValue,
    equity_value_mln: equityValue,
    price_per_share: equityValue / engine.shares_mln,
  };
}

function runValuationModel(engine, state) {
  const terminalG = engine.terminal_g;
  const assumptions = {
    revenue_growth: percentileValue(engine.percentile_history.revenue_growth, state.revenue_growth_p),
    net_margin: percentileValue(engine.percentile_history.net_margin, state.net_margin_p),
    cfo_to_ni: percentileValue(engine.percentile_history.cfo_to_ni, state.cfo_to_ni_p),
    capex_to_cfo: percentileValue(engine.percentile_history.capex_to_cfo, state.capex_to_cfo_p),
    revenue_growth_p: state.revenue_growth_p,
    net_margin_p: state.net_margin_p,
    cfo_to_ni_p: state.cfo_to_ni_p,
    capex_to_cfo_p: state.capex_to_cfo_p,
    wacc: state.wacc,
    terminal_g: terminalG,
  };
  if (
    [assumptions.revenue_growth, assumptions.net_margin, assumptions.cfo_to_ni, assumptions.capex_to_cfo].some(
      (v) => v == null,
    )
  ) {
    return null;
  }
  const forecast = projectFlows(engine, assumptions);
  const result = computeDcfResult(forecast.fcff_mln, engine, state.wacc, terminalG);
  if (!result) return null;
  return {
    assumptions,
    actual: {
      years: engine.actual_years,
      revenue_mln: engine.actual_revenue_mln,
      net_income_mln: engine.actual_net_income_mln,
      fcff_mln: engine.actual_fcff_mln,
      count: engine.actual_years.length,
    },
    forecast,
    result,
  };
}

/** Gap columns between actual history and forecast (keep minimal). */
const VAL_FLOW_GAP_COLS = 1;

function barColors(baseColor, count, actualCount) {
  return Array.from({ length: count }, (_, i) => {
    if (i < actualCount) return baseColor;
    if (i >= actualCount && i < actualCount + VAL_FLOW_GAP_COLS) return "transparent";
    const m = baseColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return baseColor;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0.55)`;
  });
}

function flowSeries(actualArr, forecastArr) {
  return [...actualArr, ...Array(VAL_FLOW_GAP_COLS).fill(null), ...forecastArr, null];
}

function buildValuationFlowChartData(model) {
  const actual = model.actual;
  const forecast = model.forecast;
  const actualCount = actual.count;
  const labels = [
    ...actual.years.map((y) => y.replace("FY ", "")),
    ...Array(VAL_FLOW_GAP_COLS).fill(""),
    ...forecast.years.map((y) => `${y.replace("FY ", "")}*`),
    "Term. value",
  ];
  const total = labels.length;

  return {
    labels,
    actualCount,
    datasets: [
      {
        label: "Revenue",
        data: flowSeries(actual.revenue_mln, forecast.revenue_mln),
        backgroundColor: barColors(VAL_FLOW.revenue, total, actualCount),
        borderColor: barColors(VAL_FLOW.revenue, total, actualCount),
        borderWidth: 0,
      },
      {
        label: "Net income",
        data: flowSeries(actual.net_income_mln, forecast.net_income_mln),
        backgroundColor: barColors(VAL_FLOW.ni, total, actualCount),
        borderColor: barColors(VAL_FLOW.ni, total, actualCount),
        borderWidth: 0,
      },
      {
        label: "FCFF",
        data: flowSeries(actual.fcff_mln, forecast.fcff_mln),
        backgroundColor: barColors(VAL_FLOW.fcff, total, actualCount),
        borderColor: barColors(VAL_FLOW.fcff, total, actualCount),
        borderWidth: 0,
      },
    ],
  };
}

function buildValuationFlowChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 150,
    animation: { duration: 220 },
    layout: { padding: { top: 18, left: 20, right: 28, bottom: 24 } },
    plugins: {
      legend: {
        position: "top",
        align: "center",
        labels: {
          color: BB.grayLight,
          boxWidth: 10,
          boxHeight: 10,
          padding: 12,
          font: { size: VAL_FLOW_FONT.legend, family: "Consolas, monospace" },
        },
      },
      tooltip: {
        backgroundColor: "#111",
        borderColor: BB.grid,
        borderWidth: 1,
        titleColor: BB.amber,
        bodyColor: BB.white,
        callbacks: {
          title: (items) => {
            const raw = items[0]?.label || "";
            if (raw === "Term. value") return "Terminal value (after forecast)";
            return raw.endsWith("*") ? `${raw.slice(0, -1)} (projected)` : `${raw} (actual)`;
          },
          label: (c) => {
            if (c.raw == null) return null;
            return `${c.dataset.label}: ${fmtFlowBillions(c.raw)} B`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: BB.grayLight,
          font: { size: VAL_FLOW_FONT.axis },
          maxRotation: 0,
          callback(value) {
            const label = this.getLabelForValue(value);
            return label || "";
          },
        },
        grid: { display: false },
        border: { display: true, color: BB.grid, width: 1 },
      },
      y: {
        grace: "16%",
        ticks: {
          color: BB.grayLight,
          font: { size: VAL_FLOW_FONT.axis },
          callback: (v) => fmtFlowBillions(v),
        },
        grid: { display: false },
        border: { display: true, color: BB.grid, width: 1 },
      },
    },
    datasets: {
      bar: {
        barPercentage: flowGroupedBarPercentage(3),
        categoryPercentage: 0.52,
        maxBarThickness: 14,
      },
    },
  };
}

function updateValuationFlowChart(model) {
  const canvas = document.getElementById("val-flow-chart");
  if (!canvas || !model) return;

  const { labels, datasets, actualCount } = buildValuationFlowChartData(model);

  if (valuationFlowChart) {
    valuationFlowChart.data.labels = labels;
    valuationFlowChart.data.datasets = datasets;
    valuationFlowChart.$terminalValueMln = model.result?.terminal_value_mln;
    valuationFlowChart.update("active");
    requestAnimationFrame(() => syncValuationFlowFooter(valuationFlowChart));
    return;
  }

  valuationFlowChart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: buildValuationFlowChartOptions(),
    plugins: [valFlowBarLabelsPlugin],
  });
  valuationFlowChart.$terminalValueMln = model.result?.terminal_value_mln;

  if (!window.__valFlowResizeBound) {
    window.__valFlowResizeBound = true;
    let valFlowResizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(valFlowResizeTimer);
      valFlowResizeTimer = setTimeout(() => {
        if (valuationFlowChart) syncValuationFlowFooter(valuationFlowChart);
      }, 150);
    });
  }

  requestAnimationFrame(() => {
    if (valuationFlowChart) syncValuationFlowFooter(valuationFlowChart);
  });
}

function pvStripValue(value, rowKey, empty = false) {
  const cls = empty ? "val-pv-empty" : "";
  return `<span class="val-pv-v val-pv-${rowKey} ${cls}">${value}</span>`;
}

function buildPvStripColumns(model) {
  const actual = model.actual;
  const rows = model.result.discount_rows;
  const wacc = model.assumptions.wacc;
  const tvDiscFactor = (1 + wacc) ** rows.length;

  const colHtml = (fcff, disc, pv) => `
    <div class="val-pv-col">
      ${pvStripValue(fcff, "fcff", fcff === "—")}
      ${pvStripValue(disc, "disc", disc === "—")}
      ${pvStripValue(pv, "pv", pv === "—")}
    </div>`;

  const actualCols = actual.fcff_mln.map((fcff) => colHtml(fmtFlowBillions(fcff), "—", "—")).join("");

  const gapCol = Array.from(
    { length: VAL_FLOW_GAP_COLS },
    () => `<div class="val-pv-col val-pv-gap" aria-hidden="true"></div>`,
  ).join("");

  const forecastCols = rows
    .map((r) =>
      colHtml(
        fmtFlowBillions(r.fcff_mln),
        fmtDiscMultiplier(r.discount_factor),
        fmtFlowBillions(r.pv_fcff_mln),
      ),
    )
    .join("");

  const tvCol = colHtml(
    `${fmtFlowBillionsComma(model.result.terminal_value_mln)}B`,
    fmtDiscMultiplier(tvDiscFactor),
    fmtFlowBillions(model.result.pv_terminal_mln),
  );

  return { html: actualCols + gapCol + forecastCols + tvCol };
}

function updateValuationPvStrip(model) {
  const strip = document.getElementById("val-pv-strip");
  if (!strip || !model) return;

  const { html } = buildPvStripColumns(model);
  strip.innerHTML = html;
  strip.style.gridTemplateColumns = "";
  if (valuationFlowChart) {
    syncValuationFlowFooter(valuationFlowChart);
  }
}

function updateValuationSummary(data, model) {
  const marketEl = document.getElementById("val-summary-market");
  const dcfEl = document.getElementById("val-summary-dcf");
  const deltaEl = document.getElementById("val-summary-delta");
  if (!dcfEl || !model) return;

  const price = model.result.price_per_share;
  dcfEl.textContent = fmtPrice(price);

  const market = data.market_bar?.price;
  if (marketEl) {
    marketEl.textContent = market != null ? fmtPrice(market) : "—";
  }
  if (deltaEl) {
    if (market != null && market > 0) {
      const ret = price / market - 1;
      deltaEl.textContent = `${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%`;
      deltaEl.className = `val-outcome-v ${ret >= 0 ? "val-upside" : "val-downside"}`;
    } else {
      deltaEl.textContent = "—";
      deltaEl.className = "val-outcome-v val-muted";
    }
  }
}

const VAL_ASSUMPTION_SLIDER_SENSE = {
  revenue_growth: "up",
  net_margin: "up",
  cfo_to_ni: "up",
  capex_to_cfo: "down",
};

const VAL_ASSUMPTION_META = {
  revenue_growth: {
    label: "Revenue growth",
    hint: (fy) => `Applied each projected year (×${fy})`,
  },
  net_margin: {
    label: "Net margin",
    hint: () => "On projected revenue",
  },
  cfo_to_ni: {
    label: "CFO / Net income",
    hint: () => "Cash conversion ratio",
  },
  capex_to_cfo: {
    label: "CapEx / CFO",
    hint: () => "Reinvestment rate",
  },
  wacc: {
    label: "WACC",
    hint: () => "Discount rate (direct input)",
  },
};

function updateValuationCommentary(data, model) {
  const el = document.getElementById("val-commentary");
  if (!el || !model) return;

  const eng = getValuationDcf(data)?.engine;
  const a = model.assumptions;
  const r = model.result;
  const market = data.market_bar?.price;
  const fy = eng?.forecast_years ?? 7;
  const tg = ((eng?.terminal_g ?? 0.035) * 100).toFixed(1);

  let resultText;
  if (market != null && market > 0) {
    const ret = r.price_per_share / market - 1;
    const pct = Math.abs(ret * 100).toFixed(1);
    if (ret >= 0) {
      resultText = `At ${fmtPrice(market)} today, the model implies <strong>${pct}% upside</strong> to an intrinsic value of ${fmtPrice(r.price_per_share)}.`;
    } else {
      resultText = `The market price (${fmtPrice(market)}) sits <strong>${pct}% above</strong> the DCF estimate of ${fmtPrice(r.price_per_share)}.`;
    }
  } else {
    resultText = `Intrinsic value per share is ${fmtPrice(r.price_per_share)}. No market quote is loaded for this ticker, so expected return cannot be computed.`;
  }

  el.innerHTML = `
    <p class="val-comment-lead">
      Method 1 builds a ${fy}-year free-cash-flow forecast, discounts it at ${(a.wacc * 100).toFixed(2)}% WACC,
      and adds a terminal value (perpetuity at ${tg}% growth).
    </p>
    <p>
      The four assumption sliders pick a point on this company's <strong>historical distribution</strong>
      (P0 conservative → P50 median → P100 aggressive). Values above P100 or below P0 are extrapolated
      from the historical tail so you can model outcomes outside past experience.
      Revenue growth of
      <strong>${fmtControlValue("percent", a.revenue_growth)}</strong> compounds through the projection;
      net margin, CFO conversion, and CapEx intensity follow the selected percentiles.
    </p>
    <p>${resultText}</p>
    <p class="val-comment-dim">
      Enterprise value is the sum of discounted FCFF plus terminal value; equity per share adjusts for cash,
      debt, and shares outstanding (see bridge below).
    </p>`;
}

function updateValuationControls(model) {
  const a = model.assumptions;
  const map = [
    ["revenue_growth", "percent", a.revenue_growth, a.revenue_growth_p],
    ["net_margin", "percent", a.net_margin, a.net_margin_p],
    ["cfo_to_ni", "ratio", a.cfo_to_ni, a.cfo_to_ni_p],
    ["capex_to_cfo", "percent", a.capex_to_cfo, a.capex_to_cfo_p],
  ];
  map.forEach(([id, fmt, val, p]) => {
    const input = document.getElementById(`ctrl-input-${id}`);
    const slider = document.getElementById(`ctrl-slider-${id}`);
    if (input && input !== document.activeElement) {
      input.value = formatControlInputRaw(fmt, val);
    }
    if (slider) {
      const pct = Math.round(p ?? 50);
      slider.value = String(clampSliderPercentile(pct));
      updateSliderTickHighlight(slider, pct);
    }
  });
  const waccInput = document.getElementById("ctrl-input-wacc");
  const waccSlider = document.getElementById("ctrl-wacc");
  if (waccInput && waccInput !== document.activeElement) {
    waccInput.value = (a.wacc * 100).toFixed(1);
  }
  if (waccSlider) waccSlider.value = String((a.wacc * 100).toFixed(1));
}

function updateValuationFormula(model, units) {
  const r = model.result;
  const eng = getValuationDcf(currentThesisData)?.engine;
  if (!eng) return;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set("form-pv-fcff", fmtThousands(r.pv_fcff_sum_mln, 0));
  set("form-pv-tv", fmtThousands(r.pv_terminal_mln, 0));
  set("form-ev", fmtThousands(r.enterprise_value_mln, 0));
  set("form-cash", fmtThousands(eng.cash_mln, 0));
  set("form-debt", fmtThousands(eng.debt_mln, 0));
  set("form-equity", fmtThousands(r.equity_value_mln, 0));
  set("form-shares", fmtThousands(eng.shares_mln, 2));
  set("form-price", fmtPrice(r.price_per_share));
  set("form-units", units || "MLN");
}

function applyValuationModel(data) {
  const engine = getValuationDcf(data)?.engine;
  if (!engine || !valuationState) return;
  const model = runValuationModel(engine, valuationState);
  if (!model) return;

  updateValuationSummary(data, model);
  updateValuationControls(model);
  updateValuationCommentary(data, model);
  updateValuationFlowChart(model);
  updateValuationPvStrip(model);
  updateValuationFormula(model, data.units);
}

function fmtMillionsBillions(mln) {
  if (mln === null || mln === undefined || Number.isNaN(mln)) return "—";
  return fmtFlowBillions(mln);
}

function resolveEpsTtm(eng, result) {
  if (eng?.eps_ttm != null && eng.eps_ttm > 0) return eng.eps_ttm;
  if (result?.eps_ttm != null && result.eps_ttm > 0) return result.eps_ttm;
  const pts = eng?.monthly_pe_points;
  if (pts?.length) {
    const eps = pts[pts.length - 1]?.eps_ttm;
    if (eps != null && eps > 0) return eps;
  }
  return null;
}

function enrichPeEngine(eng, payload) {
  if (!eng) return eng;
  const hist = payload?.controls?.[0]?.history;
  const bands = eng.pe_bands || {};
  const hasBands = bands.p20 != null && bands.p50 != null && bands.p80 != null;
  return {
    ...eng,
    eps_ttm: resolveEpsTtm(eng, payload?.result),
    pe_bands: hasBands
      ? bands
      : hist?.length
        ? {
            p20: percentileValue(hist, 20),
            p50: percentileValue(hist, 50),
            p80: percentileValue(hist, 80),
          }
        : bands,
  };
}

function resolveBvpsTtm(eng, result) {
  if (eng?.bvps_ttm != null && eng.bvps_ttm > 0) return eng.bvps_ttm;
  if (result?.bvps_ttm != null && result.bvps_ttm > 0) return result.bvps_ttm;
  const pts = eng?.monthly_pbv_points;
  if (pts?.length) {
    const bvps = pts[pts.length - 1]?.book_value_per_share;
    if (bvps != null && bvps > 0) return bvps;
  }
  const shares = eng?.shares_mln;
  const eq = eng?.bv_history_mln;
  if (shares && eq?.length) {
    const last = [...eq].reverse().find((v) => v != null);
    if (last != null) return last / shares;
  }
  return null;
}

function enrichPbvEngine(eng, payload) {
  if (!eng) return eng;
  const hist = payload?.controls?.[0]?.history;
  const bands = eng.pbv_bands || {};
  const hasBands = bands.p20 != null && bands.p50 != null && bands.p80 != null;
  return {
    ...eng,
    bvps_ttm: resolveBvpsTtm(eng, payload?.result),
    pbv_bands: hasBands
      ? bands
      : hist?.length
        ? {
            p20: percentileValue(hist, 20),
            p50: percentileValue(hist, 50),
            p80: percentileValue(hist, 80),
          }
        : bands,
  };
}

function pbvModelFromPayload(payload, state) {
  const model = runPbvModel(payload, state);
  if (model) return model;
  const hist = payload?.controls?.[0]?.history;
  const bvpsTtm = resolveBvpsTtm(payload.engine, payload.result);
  const pbVal = hist?.length
    ? percentileValue(hist, state?.pbv_p ?? 50)
    : payload.assumptions?.pbv_multiple ?? payload.result?.selected_pbv;
  if (bvpsTtm == null || pbVal == null) return null;
  const fcBvps = resolveBvpsForecast(payload.engine).slice(0, MULT_METRIC_FC);
  return {
    assumptions: {
      pbv_multiple: pbVal,
      pbv_multiple_p: state?.pbv_p ?? payload.assumptions?.pbv_multiple_p ?? 50,
    },
    result: {
      price_per_share: pbVal * bvpsTtm,
      selected_pbv: pbVal,
      bvps_ttm: bvpsTtm,
      forecast_prices: fcBvps.length ? fcBvps.map((b) => pbVal * b) : [pbVal * bvpsTtm],
    },
  };
}

function peModelFromPayload(payload, state) {
  const model = runPeModel(payload, state);
  if (model) return model;
  const hist = payload?.controls?.[0]?.history;
  const epsTtm = resolveEpsTtm(payload.engine, payload.result);
  const peVal = hist?.length
    ? percentileValue(hist, state?.pe_p ?? 50)
    : payload.assumptions?.pe_multiple ?? payload.result?.selected_pe;
  if (epsTtm == null || peVal == null) return null;
  const fcEps = resolveEpsForecast(payload.engine).slice(0, PE_EPS_FC);
  return {
    assumptions: {
      pe_multiple: peVal,
      pe_multiple_p: state?.pe_p ?? payload.assumptions?.pe_multiple_p ?? 50,
    },
    result: {
      price_per_share: peVal * epsTtm,
      selected_pe: peVal,
      eps_ttm: epsTtm,
      forecast_prices: fcEps.length ? fcEps.map((e) => peVal * e) : [peVal * epsTtm],
    },
  };
}

function renderPeChartsInitial(data) {
  const pe = getValuationPe(data);
  if (!pe?.engine) return;
  const eng = enrichPeEngine(pe.engine, pe);
  if (document.getElementById("multiples-pe-chart")) {
    multiplesPeChart = renderPeRatioChart("multiples-pe-chart", eng, null);
  }
  if (document.getElementById("multiples-pe-eps-chart")) {
    const hist = pe.controls?.[0]?.history;
    const selectedPe =
      hist?.length && multiplesState
        ? percentileValue(hist, multiplesState.pe_p)
        : pe.assumptions?.pe_multiple;
    multiplesPeEpsChart = createPeEpsChart("multiples-pe-eps-chart", eng, selectedPe);
  }
}

function renderPbvChartsInitial(data) {
  const pbv = getValuationPbv(data);
  if (!pbv?.engine) return;
  const eng = enrichPbvEngine(pbv.engine, pbv);
  if (document.getElementById("multiples-pbv-chart")) {
    multiplesPbvChart = renderPbvRatioChart("multiples-pbv-chart", eng, null);
  }
  if (document.getElementById("multiples-pbv-bv-chart")) {
    const hist = pbv.controls?.[0]?.history;
    const selectedPb =
      hist?.length && multiplesState
        ? percentileValue(hist, multiplesState.pbv_p)
        : pbv.assumptions?.pbv_multiple;
    multiplesPbvBvChart = createPbvBvChart("multiples-pbv-bv-chart", eng, selectedPb);
  }
}

function ensurePbvChartsVisible() {
  if (!currentThesisData) return;
  const panel = document.getElementById("valuation-panel-multiples");
  if (!panel || panel.classList.contains("hidden")) return;
  const pbv = getValuationPbv(currentThesisData);
  if (!pbv?.engine) return;
  if (!multiplesPbvChart || !multiplesPbvBvChart) {
    renderPbvChartsInitial(currentThesisData);
    const model = pbvModelFromPayload(pbv, multiplesState);
    if (model) {
      updatePbvBvForecastPrices(
        model.result?.selected_pbv ?? model.assumptions?.pbv_multiple,
        model.assumptions?.pbv_multiple_p ?? multiplesState?.pbv_p,
      );
    }
  }
  requestAnimationFrame(() => {
    multiplesPbvChart?.resize();
    multiplesPbvBvChart?.resize();
  });
}

function updatePbvBvForecastPrices(selectedPb, percentile) {
  if (!multiplesPbvBvChart) return;
  multiplesPbvBvChart.$selectedMultiple = selectedPb;
  multiplesPbvBvChart.$priceAccent = pePercentileAccent(percentile ?? multiplesState?.pbv_p ?? 50);
  multiplesPbvBvChart.$labelFlashUntil = Date.now() + 300;
  multiplesPbvBvChart.update("none");
}

function ensurePeChartsVisible() {
  if (!currentThesisData) return;
  const panel = document.getElementById("valuation-panel-multiples");
  if (!panel || panel.classList.contains("hidden")) return;
  const pe = getValuationPe(currentThesisData);
  if (!pe?.engine) return;
  if (!multiplesPeChart || !multiplesPeEpsChart) {
    renderPeChartsInitial(currentThesisData);
    const model = peModelFromPayload(pe, multiplesState);
    if (model) {
      updatePeEpsForecastPrices(
        model.result?.selected_pe ?? model.assumptions?.pe_multiple,
        model.assumptions?.pe_multiple_p ?? multiplesState?.pe_p,
      );
    }
  }
  requestAnimationFrame(() => {
    multiplesPeChart?.resize();
    multiplesPeEpsChart?.resize();
  });
}

function pePercentileAccent(percentile) {
  const pct = Math.round(percentile ?? 50);
  if (pct < 48) {
    return `hsl(0, ${Math.min(92, 58 + (50 - pct) * 0.85)}%, 56%)`;
  }
  if (pct > 52) {
    return `hsl(128, ${Math.min(88, 52 + (pct - 50) * 0.85)}%, 46%)`;
  }
  return BB.amber;
}

function updatePeEpsForecastPrices(selectedPe, percentile) {
  if (!multiplesPeEpsChart) return;
  multiplesPeEpsChart.$selectedMultiple = selectedPe;
  multiplesPeEpsChart.$selectedPe = selectedPe;
  multiplesPeEpsChart.$priceAccent = pePercentileAccent(percentile ?? multiplesState?.pe_p ?? 50);
  multiplesPeEpsChart.$labelFlashUntil = Date.now() + 300;
  multiplesPeEpsChart.update("none");
}

function runPeModel(payload, state) {
  const ctrl = payload.controls?.[0];
  const eng = payload.engine;
  if (!ctrl?.history?.length || !eng) return null;
  const selectedPe = percentileValue(ctrl.history, state.pe_p);
  const epsTtm = resolveEpsTtm(eng, payload.result);
  if (selectedPe == null || epsTtm == null || epsTtm <= 0) return null;
  const price = selectedPe * epsTtm;
  const fcEps = resolveEpsForecast(eng).slice(0, PE_EPS_FC);
  const forecastPrices = fcEps.length ? fcEps.map((eps) => selectedPe * eps) : [price];
  return {
    assumptions: { pe_multiple: selectedPe, pe_multiple_p: state.pe_p },
    result: {
      price_per_share: price,
      selected_pe: selectedPe,
      eps_ttm: epsTtm,
      forecast_prices: forecastPrices,
    },
  };
}

function runPbvModel(payload, state) {
  const ctrl = payload.controls?.[0];
  const eng = payload.engine;
  if (!ctrl?.history?.length || !eng) return null;
  const selectedPb = percentileValue(ctrl.history, state.pbv_p);
  const bvpsTtm = resolveBvpsTtm(eng, payload.result);
  if (selectedPb == null || bvpsTtm == null || bvpsTtm <= 0) return null;
  const price = selectedPb * bvpsTtm;
  const fcBvps = resolveBvpsForecast(eng).slice(0, MULT_METRIC_FC);
  const forecastPrices = fcBvps.length ? fcBvps.map((bvps) => selectedPb * bvps) : [price];
  return {
    assumptions: { pbv_multiple: selectedPb, pbv_multiple_p: state.pbv_p },
    result: {
      price_per_share: price,
      selected_pbv: selectedPb,
      bvps_ttm: bvpsTtm,
      forecast_prices: forecastPrices,
    },
  };
}

const PE_CHART_MAX_X_TICKS = 14;
const MULT_METRIC_HIST = 10;
const MULT_METRIC_FC = 5;
const PE_EPS_HIST = MULT_METRIC_HIST;
const PE_EPS_FC = MULT_METRIC_FC;

function resolveEpsHistory(eng) {
  if (eng.eps_history?.length) {
    return {
      years: eng.eps_history_years || [],
      eps: eng.eps_history,
    };
  }
  const shares = eng.shares_mln;
  const ni = eng.earnings_history_mln || [];
  const years = eng.earnings_history_years || [];
  const eps = ni.map((v) => (v != null && shares ? v / shares : null));
  return { years, eps };
}

function resolveEpsForecast(eng) {
  if (eng.eps_forecast?.length) return eng.eps_forecast;
  const shares = eng.shares_mln;
  const ni = eng.forecast_earnings_mln || [];
  return ni.map((v) => (v != null && shares ? v / shares : null));
}

function resolveEpsForecastYears(eng) {
  if (eng.eps_forecast_years?.length) return eng.eps_forecast_years;
  return (eng.forecast_years_labels || []).slice(0, PE_EPS_FC);
}

function resolveBvpsHistory(eng) {
  if (eng.bvps_history?.length) {
    return {
      years: eng.bvps_history_years || [],
      bvps: eng.bvps_history,
    };
  }
  const shares = eng.shares_mln;
  const bv = eng.bv_history_mln || [];
  const years = eng.bv_history_years || [];
  const bvps = bv.map((v) => (v != null && shares ? v / shares : null));
  return { years, bvps };
}

function resolveBvpsForecast(eng) {
  if (eng.bvps_forecast?.length) return eng.bvps_forecast;
  const shares = eng.shares_mln;
  const bv = eng.forecast_bv_mln || [];
  return bv.map((v) => (v != null && shares ? v / shares : null));
}

function resolveBvpsForecastYears(eng) {
  if (eng.bvps_forecast_years?.length) return eng.bvps_forecast_years;
  return (eng.forecast_years_labels || []).slice(0, MULT_METRIC_FC);
}

function fmtBvps(value) {
  return fmtEps(value);
}

function peForecastTextBox(ctx, text, cx, cy, font, lineH, padX = 5, padY = 3) {
  ctx.font = font;
  const w = ctx.measureText(text).width + padX * 2;
  const h = lineH + padY * 2;
  return {
    cx,
    cy,
    left: cx - w / 2,
    right: cx + w / 2,
    top: cy - h / 2,
    bottom: cy + h / 2,
  };
}

function peForecastBoxesOverlap(a, b, gap = 4) {
  return (
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap
  );
}

function layoutMultForecastLabels(chart, labels, meta) {
  const { ctx, chartArea } = chart;
  const mult = chart.$selectedMultiple;
  const priceFont = "700 11px Consolas, monospace";
  const metricFont = "600 9px Consolas, monospace";
  const priceLineH = 14;
  const metricLineH = 11;
  const tiersAbove = [24, 40, 56, 72];
  const xOffsets = [0, 18, -18, 34, -34, 50, -50];
  const fmtMetric = chart.$fmtMetric || fmtEps;

  const items = labels
    .map(({ index, value }, orderIdx) => {
      const pt = meta.data[index];
      if (!pt || value == null) return null;
      const price = mult != null ? value * mult : null;
      const priceText = price != null ? fmtPriceWhole(price) : "";
      const metricText = fmtMetric(value);
      return {
        pt,
        value,
        price,
        priceText,
        metricText,
        orderIdx,
        xPrice: null,
        yPrice: null,
        xMetric: pt.x,
        yMetric: pt.y + 20,
        showLeader: false,
      };
    })
    .filter(Boolean);

  if (!items.length) return items;

  ctx.save();

  const metricSorted = [...items].sort((a, b) => a.pt.x - b.pt.x);
  const placedMetric = [];
  for (const item of metricSorted) {
    const metricOffsets = [0, 14, -14, 26, -26];
    let placed = false;
    for (const xOff of metricOffsets) {
      const cx = item.pt.x + xOff;
      const cy = Math.min(item.pt.y + 20, chartArea.bottom - 8);
      const box = peForecastTextBox(ctx, item.metricText, cx, cy, metricFont, metricLineH);
      if (box.left < chartArea.left || box.right > chartArea.right) continue;
      if (placedMetric.some((b) => peForecastBoxesOverlap(box, b))) continue;
      item.xMetric = cx;
      item.yMetric = cy;
      placedMetric.push(box);
      placed = true;
      break;
    }
    if (!placed) {
      item.xMetric = item.pt.x;
      item.yMetric = Math.min(item.pt.y + 20, chartArea.bottom - 8);
      placedMetric.push(
        peForecastTextBox(ctx, item.metricText, item.xMetric, item.yMetric, metricFont, metricLineH),
      );
    }
  }

  const priceSorted = [...items].sort((a, b) => a.pt.x - b.pt.x);
  const placedPrices = [];

  for (const item of priceSorted) {
    if (!item.priceText) continue;

    const tierStart = item.orderIdx % tiersAbove.length;
    const tierOrder = tiersAbove.map((_, i) => (tierStart + i) % tiersAbove.length);

    let placed = false;
    for (const tierIdx of tierOrder) {
      const above = tiersAbove[tierIdx];
      for (const xOff of xOffsets) {
        const cx = item.pt.x + xOff;
        const cy = item.pt.y - above;
        if (cy - priceLineH / 2 < chartArea.top + 6) continue;

        const box = peForecastTextBox(ctx, item.priceText, cx, cy, priceFont, priceLineH);
        if (box.left < chartArea.left + 2 || box.right > chartArea.right - 2) continue;
        if (placedPrices.some((b) => peForecastBoxesOverlap(box, b))) continue;
        if (placedMetric.some((b) => peForecastBoxesOverlap(box, b))) continue;

        item.xPrice = cx;
        item.yPrice = cy;
        item.showLeader = Math.abs(xOff) > 3 || tierIdx > 0;
        placedPrices.push(box);
        placed = true;
        break;
      }
      if (placed) break;
    }

    if (!placed) {
      const stackY = chartArea.top + 10 + item.orderIdx * (priceLineH + 5);
      item.xPrice = item.pt.x;
      item.yPrice = stackY;
      item.showLeader = true;
      placedPrices.push(
        peForecastTextBox(ctx, item.priceText, item.xPrice, item.yPrice, priceFont, priceLineH),
      );
    }
  }

  ctx.restore();
  return items;
}

const multForecastLabelsPlugin = {
  id: "multForecastLabels",
  afterDatasetsDraw(chart) {
    const labels = chart.$forecastMeta;
    if (!labels?.length) return;
    const dsIndex = chart.data.datasets.findIndex((d) => d.label === "Projected");
    if (dsIndex < 0) return;
    const meta = chart.getDatasetMeta(dsIndex);
    const { ctx } = chart;
    const accent = chart.$priceAccent || BB.amber;
    const flashing = chart.$labelFlashUntil && Date.now() < chart.$labelFlashUntil;
    const priceSize = flashing ? 12 : 11;
    const priceFont = `700 ${priceSize}px Consolas, monospace`;
    const fmtMetric = chart.$fmtMetric || fmtEps;
    const laidOut = layoutMultForecastLabels(chart, labels, meta);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    laidOut.forEach((item) => {
      const { pt, value, price, priceText, xPrice, yPrice, xMetric, yMetric, showLeader } = item;
      if (price != null && priceText && xPrice != null && yPrice != null) {
        if (showLeader) {
          ctx.beginPath();
          ctx.strokeStyle = accent;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.moveTo(pt.x, pt.y - 5);
          ctx.lineTo(xPrice, yPrice + priceSize * 0.55);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.font = priceFont;
        ctx.fillStyle = accent;
        ctx.globalAlpha = flashing ? 1 : 0.94;
        ctx.fillText(priceText, xPrice, yPrice);
      }
      ctx.globalAlpha = 1;
      ctx.font = "600 9px Consolas, monospace";
      ctx.fillStyle = "rgba(255, 153, 0, 0.72)";
      ctx.fillText(fmtMetric(value), xMetric, yMetric);
    });
    ctx.restore();
  },
};

function buildPeEpsChartData(eng) {
  const hist = resolveEpsHistory(eng);
  const histYears = hist.years.slice(-PE_EPS_HIST).map((y) => String(y).replace("FY ", ""));
  const histEps = hist.eps.slice(-PE_EPS_HIST);
  const fcYears = resolveEpsForecastYears(eng)
    .slice(0, PE_EPS_FC)
    .map((y) => `${String(y).replace("FY ", "")}*`);
  const fcEps = resolveEpsForecast(eng).slice(0, PE_EPS_FC);
  const h = histEps.length;
  const bridge = h ? histEps[h - 1] : null;
  const labels = [...histYears, ...fcYears];

  const forecastMeta = fcEps.map((value, i) => ({
    index: h + i,
    value,
  }));

  return {
    labels,
    meta: forecastMeta,
    datasets: [
      {
        label: "Actual EPS",
        data: [...histEps, ...Array(PE_EPS_FC).fill(null)],
        borderColor: BB.amber,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: BB.amber,
        tension: 0.12,
        spanGaps: false,
      },
      {
        label: "Projected",
        data: [...Array(Math.max(0, h - 1)).fill(null), bridge, ...fcEps],
        borderColor: "rgba(255, 153, 0, 0.55)",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 4,
        pointBackgroundColor: "rgba(255, 153, 0, 0.65)",
        tension: 0.12,
        spanGaps: false,
      },
    ],
  };
}

function peEpsChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 58, bottom: 28 } },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: {
          color: BB.grayLight,
          boxWidth: 10,
          font: { size: 10, family: "Consolas, monospace" },
        },
      },
      tooltip: {
        backgroundColor: "#111",
        borderColor: BB.grid,
        borderWidth: 1,
        titleColor: BB.amber,
        bodyColor: BB.white,
        callbacks: {
          label: (c) => {
            if (c.raw == null) return null;
            return `${c.dataset.label}: ${fmtEps(c.raw)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: BB.grayLight, font: { size: 9 }, maxRotation: 0 },
        grid: { display: false },
        border: { display: true, color: BB.grid },
      },
      y: {
        grace: "14%",
        title: {
          display: true,
          text: "EPS ($/share)",
          color: BB.gray,
          font: { size: 10 },
        },
        ticks: {
          color: BB.grayLight,
          font: { size: 10 },
          callback: (v) => `$${Number(v).toFixed(2)}`,
        },
        grid: { color: "rgba(255,255,255,0.04)", drawTicks: false },
        border: { display: true, color: BB.grid },
      },
    },
  };
}

function createPeEpsChart(canvasId, eng, selectedPe) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !eng) return null;
  const built = buildPeEpsChartData(eng);
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: built.labels, datasets: built.datasets },
    options: peEpsChartOptions(),
    plugins: [multForecastLabelsPlugin],
  });
  chart.$forecastMeta = built.meta;
  chart.$selectedMultiple = selectedPe ?? null;
  chart.$selectedPe = selectedPe ?? null;
  chart.$priceAccent = pePercentileAccent(multiplesState?.pe_p ?? 50);
  chart.$fmtMetric = fmtEps;
  return chart;
}

function buildPeRatioChartData(eng) {
  const points = eng.monthly_pe_points || [];
  const bands = eng.pe_bands || {};
  const labels = points.length
    ? points.map((p) => String(p.month).slice(2).replace("-", "/"))
    : (eng.history_years || []).map((y) => String(y).replace("FY ", ""));
  const peData = points.length ? points.map((p) => p.pe) : eng.history_pe || [];
  const n = labels.length;
  const bandLine = (val, label, color) => ({
    label,
    data: Array(n).fill(val ?? null),
    borderColor: color,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderDash: [],
    pointRadius: 0,
    pointHoverRadius: 0,
    pointHitRadius: 0,
    tension: 0,
    order: 1,
  });

  const manyPoints = peData.length > 36;

  return {
    labels,
    datasets: [
      {
        label: "P/E",
        data: peData,
        borderColor: "rgba(255, 153, 0, 0.85)",
        backgroundColor: "rgba(255, 153, 0, 0.03)",
        borderWidth: 1.25,
        pointRadius: manyPoints ? 0 : 1.5,
        pointHoverRadius: 3,
        pointBackgroundColor: BB.amber,
        fill: true,
        tension: 0.12,
        spanGaps: false,
        order: 0,
      },
      bandLine(bands.p80, "P80", "rgba(105, 219, 124, 0.38)"),
      bandLine(bands.p50, "Median", "rgba(255, 255, 255, 0.38)"),
      bandLine(bands.p20, "P20", "rgba(255, 107, 107, 0.38)"),
    ],
  };
}

function peRatioChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: {
          color: BB.grayLight,
          boxWidth: 14,
          boxHeight: 2,
          usePointStyle: false,
          font: { size: 10, family: "Consolas, monospace" },
        },
      },
      tooltip: {
        backgroundColor: "#111",
        borderColor: BB.grid,
        borderWidth: 1,
        titleColor: BB.amber,
        bodyColor: BB.white,
        filter: (item) => item.dataset.label === "P/E",
        callbacks: {
          label: (c) => (c.raw == null ? null : `P/E: ${fmtRatio(c.raw)}×`),
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: BB.grayLight,
          font: { size: 9 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: PE_CHART_MAX_X_TICKS,
        },
        grid: { display: false },
        border: { display: true, color: BB.grid },
      },
      y: {
        grace: "8%",
        title: {
          display: true,
          text: "P/E multiple",
          color: BB.gray,
          font: { size: 10 },
        },
        ticks: {
          color: BB.grayLight,
          font: { size: 10 },
          callback: (v) => `${Number(v).toFixed(0)}×`,
        },
        grid: { color: "rgba(255,255,255,0.04)", drawTicks: false },
        border: { display: true, color: BB.grid },
      },
    },
  };
}

function renderPeRatioChart(canvasId, eng, existingChart) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !eng) return null;
  const chartData = buildPeRatioChartData(eng);
  if (existingChart) {
    existingChart.data = chartData;
    existingChart.options = peRatioChartOptions();
    existingChart.update("active");
    return existingChart;
  }
  return new Chart(canvas, {
    type: "line",
    data: chartData,
    options: peRatioChartOptions(),
  });
}

function buildPbvRatioChartData(eng) {
  const points = eng.monthly_pbv_points || [];
  const bands = eng.pbv_bands || {};
  const labels = points.length
    ? points.map((p) => String(p.month).slice(2).replace("-", "/"))
    : (eng.history_years || []).map((y) => String(y).replace("FY ", ""));
  const pbvData = points.length ? points.map((p) => p.pbv) : eng.history_pbv || [];
  const n = labels.length;
  const bandLine = (val, label, color) => ({
    label,
    data: Array(n).fill(val ?? null),
    borderColor: color,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderDash: [],
    pointRadius: 0,
    pointHoverRadius: 0,
    pointHitRadius: 0,
    tension: 0,
    order: 1,
  });
  const manyPoints = pbvData.length > 36;
  return {
    labels,
    datasets: [
      {
        label: "P/BV",
        data: pbvData,
        borderColor: "rgba(255, 153, 0, 0.85)",
        backgroundColor: "rgba(255, 153, 0, 0.03)",
        borderWidth: 1.25,
        pointRadius: manyPoints ? 0 : 1.5,
        pointHoverRadius: 3,
        pointBackgroundColor: BB.amber,
        fill: true,
        tension: 0.12,
        spanGaps: false,
        order: 0,
      },
      bandLine(bands.p80, "P80", "rgba(105, 219, 124, 0.38)"),
      bandLine(bands.p50, "Median", "rgba(255, 255, 255, 0.38)"),
      bandLine(bands.p20, "P20", "rgba(255, 107, 107, 0.38)"),
    ],
  };
}

function pbvRatioChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: {
          color: BB.grayLight,
          boxWidth: 14,
          boxHeight: 2,
          usePointStyle: false,
          font: { size: 10, family: "Consolas, monospace" },
        },
      },
      tooltip: {
        backgroundColor: "#111",
        borderColor: BB.grid,
        borderWidth: 1,
        titleColor: BB.amber,
        bodyColor: BB.white,
        filter: (item) => item.dataset.label === "P/BV",
        callbacks: {
          label: (c) => (c.raw == null ? null : `P/BV: ${fmtRatio(c.raw)}×`),
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: BB.grayLight,
          font: { size: 9 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: PE_CHART_MAX_X_TICKS,
        },
        grid: { display: false },
        border: { display: true, color: BB.grid },
      },
      y: {
        grace: "8%",
        title: {
          display: true,
          text: "P/BV multiple",
          color: BB.gray,
          font: { size: 10 },
        },
        ticks: {
          color: BB.grayLight,
          font: { size: 10 },
          callback: (v) => `${Number(v).toFixed(1)}×`,
        },
        grid: { color: "rgba(255,255,255,0.04)", drawTicks: false },
        border: { display: true, color: BB.grid },
      },
    },
  };
}

function renderPbvRatioChart(canvasId, eng, existingChart) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !eng) return null;
  const chartData = buildPbvRatioChartData(eng);
  if (existingChart) {
    existingChart.data = chartData;
    existingChart.options = pbvRatioChartOptions();
    existingChart.update("active");
    return existingChart;
  }
  return new Chart(canvas, {
    type: "line",
    data: chartData,
    options: pbvRatioChartOptions(),
  });
}

function buildPbvBvChartData(eng) {
  const hist = resolveBvpsHistory(eng);
  const histYears = hist.years.slice(-MULT_METRIC_HIST).map((y) => String(y).replace("FY ", ""));
  const histBvps = hist.bvps.slice(-MULT_METRIC_HIST);
  const fcYears = resolveBvpsForecastYears(eng)
    .slice(0, MULT_METRIC_FC)
    .map((y) => `${String(y).replace("FY ", "")}*`);
  const fcBvps = resolveBvpsForecast(eng).slice(0, MULT_METRIC_FC);
  const h = histBvps.length;
  const bridge = h ? histBvps[h - 1] : null;
  const labels = [...histYears, ...fcYears];
  const forecastMeta = fcBvps.map((value, i) => ({
    index: h + i,
    value,
  }));
  return {
    labels,
    meta: forecastMeta,
    datasets: [
      {
        label: "Actual BV/share",
        data: [...histBvps, ...Array(MULT_METRIC_FC).fill(null)],
        borderColor: BB.amber,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: BB.amber,
        tension: 0.12,
        spanGaps: false,
      },
      {
        label: "Projected",
        data: [...Array(Math.max(0, h - 1)).fill(null), bridge, ...fcBvps],
        borderColor: "rgba(255, 153, 0, 0.55)",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 4,
        pointBackgroundColor: "rgba(255, 153, 0, 0.65)",
        tension: 0.12,
        spanGaps: false,
      },
    ],
  };
}

function pbvBvChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 58, bottom: 28 } },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: {
          color: BB.grayLight,
          boxWidth: 10,
          font: { size: 10, family: "Consolas, monospace" },
        },
      },
      tooltip: {
        backgroundColor: "#111",
        borderColor: BB.grid,
        borderWidth: 1,
        titleColor: BB.amber,
        bodyColor: BB.white,
        callbacks: {
          label: (c) => {
            if (c.raw == null) return null;
            return `${c.dataset.label}: ${fmtBvps(c.raw)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: BB.grayLight, font: { size: 9 }, maxRotation: 0 },
        grid: { display: false },
        border: { display: true, color: BB.grid },
      },
      y: {
        grace: "14%",
        title: {
          display: true,
          text: "Book value ($/share)",
          color: BB.gray,
          font: { size: 10 },
        },
        ticks: {
          color: BB.grayLight,
          font: { size: 10 },
          callback: (v) => `$${Number(v).toFixed(2)}`,
        },
        grid: { color: "rgba(255,255,255,0.04)", drawTicks: false },
        border: { display: true, color: BB.grid },
      },
    },
  };
}

function createPbvBvChart(canvasId, eng, selectedPb) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !eng) return null;
  const built = buildPbvBvChartData(eng);
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: built.labels, datasets: built.datasets },
    options: pbvBvChartOptions(),
    plugins: [multForecastLabelsPlugin],
  });
  chart.$forecastMeta = built.meta;
  chart.$selectedMultiple = selectedPb ?? null;
  chart.$priceAccent = pePercentileAccent(multiplesState?.pbv_p ?? 50);
  chart.$fmtMetric = fmtBvps;
  return chart;
}

function updatePbvSliderVisuals(slider, percentile) {
  if (!slider) return;
  const col = slider.closest(".val-pbv-slider-col") || slider.closest(".val-slider-col");
  const readout = col?.querySelector(".val-slider-readout");
  const accent = pePercentileAccent(percentile);
  col?.style.setProperty("--pbv-slider-thumb", accent);
  if (readout) readout.style.color = accent;
}

function updatePbvFormula(data, model, eng) {
  const bvEl = document.getElementById("val-pbv-bvps-ttm");
  const priceEl = document.getElementById("val-pbv-est-price");
  const multInput = document.getElementById("ctrl-input-pbv_multiple");
  const marketEl = document.getElementById("val-pbv-summary-market");
  const deltaEl = document.getElementById("val-pbv-summary-delta");
  const slider = document.getElementById("ctrl-slider-pbv_multiple");
  const readout = document.getElementById("ctrl-readout-pbv_multiple");

  if (!model) return;
  const a = model.assumptions;
  const r = model.result;

  if (bvEl) bvEl.textContent = fmtBvps(r.bvps_ttm ?? eng?.bvps_ttm);
  if (priceEl) priceEl.textContent = fmtPrice1(r.price_per_share);

  if (multInput) {
    if (multInput !== document.activeElement) {
      multInput.value = formatControlInputRaw("ratio", a.pbv_multiple);
    }
    multInput.style.color = pePercentileAccent(a.pbv_multiple_p ?? 50);
  }

  const pct = Math.round(a.pbv_multiple_p ?? 50);
  if (slider) {
    slider.value = String(clampSliderPercentile(pct));
    updateSliderTickHighlight(slider, pct);
    updatePbvSliderVisuals(slider, pct);
  }
  if (readout) readout.textContent = String(pct);

  const market = data.market_bar?.price;
  if (marketEl) marketEl.textContent = fmtPrice(market);
  if (deltaEl && market != null && market > 0 && r.price_per_share != null) {
    const ret = r.price_per_share / market - 1;
    deltaEl.textContent = `${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%`;
    deltaEl.className = `val-pe-foot-v ${ret >= 0 ? "val-upside" : "val-downside"}`;
  } else if (deltaEl) {
    deltaEl.textContent = "—";
    deltaEl.className = "val-pe-foot-v";
  }
}

function updatePeSliderVisuals(slider, percentile) {
  if (!slider) return;
  const col = slider.closest(".val-pe-slider-col") || slider.closest(".val-slider-col");
  const readout = col?.querySelector(".val-slider-readout");
  const accent = pePercentileAccent(percentile);
  col?.style.setProperty("--pe-slider-thumb", accent);
  if (readout) readout.style.color = accent;
}

function updatePeFormula(data, model, eng) {
  const epsEl = document.getElementById("val-pe-eps-ttm");
  const priceEl = document.getElementById("val-pe-est-price");
  const multInput = document.getElementById("ctrl-input-pe_multiple");
  const marketEl = document.getElementById("val-pe-summary-market");
  const deltaEl = document.getElementById("val-pe-summary-delta");
  const slider = document.getElementById("ctrl-slider-pe_multiple");
  const readout = document.getElementById("ctrl-readout-pe_multiple");

  if (!model) return;
  const a = model.assumptions;
  const r = model.result;

  if (epsEl) epsEl.textContent = fmtEps(r.eps_ttm ?? eng?.eps_ttm);
  if (priceEl) priceEl.textContent = fmtPrice1(r.price_per_share);

  if (multInput) {
    if (multInput !== document.activeElement) {
      multInput.value = formatControlInputRaw("ratio", a.pe_multiple);
    }
    multInput.style.color = pePercentileAccent(a.pe_multiple_p ?? 50);
  }

  const pct = Math.round(a.pe_multiple_p ?? 50);
  if (slider) {
    slider.value = String(clampSliderPercentile(pct));
    updateSliderTickHighlight(slider, pct);
    updatePeSliderVisuals(slider, pct);
  }
  if (readout) readout.textContent = String(pct);

  const market = data.market_bar?.price;
  if (marketEl) marketEl.textContent = fmtPrice(market);
  if (deltaEl && market != null && market > 0 && r.price_per_share != null) {
    const ret = r.price_per_share / market - 1;
    deltaEl.textContent = `${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%`;
    deltaEl.className = `val-pe-foot-v ${ret >= 0 ? "val-upside" : "val-downside"}`;
  } else if (deltaEl) {
    deltaEl.textContent = "—";
    deltaEl.className = "val-pe-foot-v";
  }
}

const MULT_LINE_GAP = 1;

function buildMultiplesSeriesChartData(eng, histYearsKey, histValsKey, forecastKey) {
  const histYears = (eng[histYearsKey] || []).map((y) => String(y).replace("FY ", ""));
  const histVals = eng[histValsKey] || [];
  const fYears = (eng.forecast_years_labels || []).map((y) => `${String(y).replace("FY ", "")}*`);
  const fVals = eng[forecastKey] || [];

  const labels = [
    ...histYears,
    ...Array(MULT_LINE_GAP).fill(""),
    ...fYears,
  ];
  const toB = (v) => (v == null ? null : v / 1000);

  return {
    labels,
    datasets: [
      {
        label: "Actual",
        data: [
          ...histVals.map(toB),
          ...Array(MULT_LINE_GAP + fYears.length).fill(null),
        ],
        borderColor: BB.amber,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: BB.amber,
        tension: 0.15,
        spanGaps: false,
      },
      {
        label: "Projected",
        data: [
          ...Array(histYears.length + MULT_LINE_GAP).fill(null),
          ...fVals.map(toB),
        ],
        borderColor: "rgba(255, 153, 0, 0.55)",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 3,
        pointBackgroundColor: "rgba(255, 153, 0, 0.55)",
        tension: 0.15,
        spanGaps: false,
      },
    ],
  };
}

function multiplesLineChartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "center",
        labels: {
          color: BB.grayLight,
          boxWidth: 10,
          font: { size: VAL_FLOW_FONT.legend, family: "Consolas, monospace" },
        },
      },
      tooltip: {
        backgroundColor: "#111",
        borderColor: BB.grid,
        borderWidth: 1,
        titleColor: BB.amber,
        bodyColor: BB.white,
        callbacks: {
          label: (c) => {
            if (c.raw == null) return null;
            return `${c.dataset.label}: ${fmtFlowBillions(c.raw * 1000)} B`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: BB.grayLight, font: { size: VAL_FLOW_FONT.axis }, maxRotation: 0 },
        grid: { display: false },
        border: { display: true, color: BB.grid },
      },
      y: {
        grace: "12%",
        title: {
          display: true,
          text: yLabel,
          color: BB.gray,
          font: { size: 10 },
        },
        ticks: {
          color: BB.grayLight,
          font: { size: VAL_FLOW_FONT.axis },
          callback: (v) => fmtFlowBillions(v * 1000),
        },
        grid: { display: false },
        border: { display: true, color: BB.grid },
      },
    },
  };
}

function updateMultiplesSummary(prefix, data, model) {
  const market = data.market_bar?.price;
  const r = model?.result;
  const mktEl = document.getElementById(`val-${prefix}-summary-market`);
  const dcfEl = document.getElementById(`val-${prefix}-summary-est`);
  const deltaEl = document.getElementById(`val-${prefix}-summary-delta`);
  if (mktEl) mktEl.textContent = fmtPrice(market);
  if (dcfEl) dcfEl.textContent = r?.price_per_share != null ? fmtPrice(r.price_per_share) : "—";
  if (deltaEl && market != null && market > 0 && r?.price_per_share != null) {
    const ret = r.price_per_share / market - 1;
    deltaEl.textContent = `${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%`;
    deltaEl.className = `val-outcome-v ${ret >= 0 ? "val-upside" : "val-downside"}`;
  } else if (deltaEl) {
    deltaEl.textContent = "—";
    deltaEl.className = "val-outcome-v";
  }
}

function updateMultiplesCommentary(prefix, methodLabel, multipleLabel, data, model, eng) {
  const el = document.getElementById(`val-${prefix}-commentary`);
  if (!el || !model) return;
  const a = model.assumptions;
  const r = model.result;
  const market = data.market_bar?.price;
  const multVal = a.pe_multiple ?? a.pbv_multiple;
  const meta = eng?.multiples_meta;
  const metaLine = meta?.source_note
    ? `<p class="val-comment-dim">${meta.source_note}${
        meta.validation?.vendor_checks
          ? ` FMP cross-check: ${meta.validation.vendor_within_tolerance}/${meta.validation.vendor_checks} quarters within ${meta.validation.tolerance_pct}%.`
          : ""
      }</p>`
    : "";

  let resultText = `Estimated price uses ${multipleLabel} of <strong>${fmtRatio(multVal)}</strong> on the next-year forecast.`;
  if (market != null && market > 0) {
    const ret = r.price_per_share / market - 1;
    const pct = Math.abs(ret * 100).toFixed(1);
    resultText =
      ret >= 0
        ? `At ${fmtPrice(market)} today, ${methodLabel} implies <strong>${pct}% upside</strong> to ${fmtPrice(r.price_per_share)}.`
        : `Market price ${fmtPrice(market)} is <strong>${pct}% above</strong> the ${methodLabel} estimate of ${fmtPrice(r.price_per_share)}.`;
  }
  el.innerHTML = `
    <p class="val-comment-lead">${methodLabel} uses a monthly historical ${multipleLabel} distribution (month-end price ÷ trailing diluted EPS for P/E).</p>
    <p>Move the percentile bar to pick where the ${multipleLabel} sits vs history (P0 conservative → P100 aggressive). ${resultText}</p>
    ${metaLine}
    <p class="val-comment-dim">Solid line = reported history · dashed = projected (${eng?.forecast_years ?? 7} years, billions).</p>`;
}

function updateMultiplesControls(prefix, model, controlId) {
  const a = model.assumptions;
  const pKey = controlId === "pe_multiple" ? "pe_multiple_p" : "pbv_multiple_p";
  const valKey = controlId === "pe_multiple" ? "pe_multiple" : "pbv_multiple";
  const fmt = "ratio";
  const input = document.getElementById(`ctrl-input-${controlId}`);
  const slider = document.getElementById(`ctrl-slider-${controlId}`);
  if (input && input !== document.activeElement) {
    input.value = formatControlInputRaw(fmt, a[valKey]);
  }
  if (slider) {
    const pct = Math.round(a[pKey] ?? 50);
    slider.value = String(clampSliderPercentile(pct));
    updateSliderTickHighlight(slider, pct);
  }
}

function applyMultiplesModel(data, method) {
  const payload = method === "pe" ? getValuationPe(data) : getValuationPbv(data);
  if (!payload?.engine || !multiplesState) return;
  const model =
    method === "pe"
      ? peModelFromPayload(payload, multiplesState)
      : pbvModelFromPayload(payload, multiplesState);
  if (!model) return;
  if (method === "pe") {
    const eng = enrichPeEngine(payload.engine, payload);
    updatePeFormula(data, model, eng);
    updatePeEpsForecastPrices(
      model.result?.selected_pe ?? model.assumptions?.pe_multiple,
      model.assumptions?.pe_multiple_p ?? multiplesState?.pe_p,
    );
    return;
  }
  const eng = enrichPbvEngine(payload.engine, payload);
  updatePbvFormula(data, model, eng);
  updatePbvBvForecastPrices(
    model.result?.selected_pbv ?? model.assumptions?.pbv_multiple,
    model.assumptions?.pbv_multiple_p ?? multiplesState?.pbv_p,
  );
}

function bindMultiplesControls(data) {
  const pe = getValuationPe(data);
  const pbv = getValuationPbv(data);
  if (!pe?.engine && !pbv?.engine) return;

  document.querySelectorAll(".val-multiples-block .val-slider[data-percentile]").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.percentile;
      const key = id === "pe_multiple" ? "pe_p" : "pbv_p";
      multiplesState[key] = Number(input.value);
      updateSliderTickHighlight(input, Number(input.value));
      if (id === "pe_multiple") updatePeSliderVisuals(input, Number(input.value));
      if (id === "pbv_multiple") updatePbvSliderVisuals(input, Number(input.value));
      applyMultiplesModel(data, id === "pe_multiple" ? "pe" : "pbv");
    });
  });

  document.querySelectorAll(".val-multiples-block .val-assumption-input[data-assumption]").forEach((input) => {
    const applyFromInput = () => {
      const id = input.dataset.assumption;
      const fmt = input.dataset.format || "ratio";
      const parsed = parseControlInput(fmt, input.value);
      if (parsed == null) return;
      const payload = id === "pe_multiple" ? pe : pbv;
      const history = payload?.controls?.[0]?.history;
      if (!history?.length) return;
      const key = id === "pe_multiple" ? "pe_p" : "pbv_p";
      multiplesState[key] = valueToPercentile(history, parsed);
      applyMultiplesModel(data, id === "pe_multiple" ? "pe" : "pbv");
    };
    input.addEventListener("input", applyFromInput);
    input.addEventListener("change", applyFromInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
  });

  document.querySelectorAll(".val-pe-mult-input[data-assumption]").forEach((input) => {
    const applyFromInput = () => {
      const parsed = parseControlInput("ratio", input.value);
      if (parsed == null) return;
      const history = pe?.controls?.[0]?.history;
      if (!history?.length) return;
      multiplesState.pe_p = valueToPercentile(history, parsed);
      applyMultiplesModel(data, "pe");
    };
    input.addEventListener("input", applyFromInput);
    input.addEventListener("change", applyFromInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
  });

  document.querySelectorAll(".val-pbv-mult-input[data-assumption]").forEach((input) => {
    const applyFromInput = () => {
      const parsed = parseControlInput("ratio", input.value);
      if (parsed == null) return;
      const history = pbv?.controls?.[0]?.history;
      if (!history?.length) return;
      multiplesState.pbv_p = valueToPercentile(history, parsed);
      applyMultiplesModel(data, "pbv");
    };
    input.addEventListener("input", applyFromInput);
    input.addEventListener("change", applyFromInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
  });
}

function renderMultiplesChart(canvasId, eng, histYearsKey, histValsKey, forecastKey, yLabel, existingChart) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !eng) return null;
  const chartData = buildMultiplesSeriesChartData(eng, histYearsKey, histValsKey, forecastKey);
  if (existingChart) {
    existingChart.data = chartData;
    existingChart.options = multiplesLineChartOptions(yLabel);
    existingChart.update("active");
    return existingChart;
  }
  return new Chart(canvas, {
    type: "line",
    data: chartData,
    options: multiplesLineChartOptions(yLabel),
  });
}

function peMethodBlock(payload, sense = "up") {
  if (!payload || payload.error) {
    const hint =
      payload?.error?.includes("FMP") || payload?.error?.includes("multiples")
        ? " Run backend/scripts/build_multiples_cache.py with FMP_API_KEY, or set the key on the server."
        : "";
    return `<article class="val-multiples-block val-pe-block"><p class="error-banner">${payload?.error || "Price / Earnings unavailable."}${hint}</p></article>`;
  }
  const ctrl = payload.controls?.[0];
  const inputAttrs = `id="ctrl-slider-pe_multiple" data-percentile="pe_multiple"
    min="${VAL_PERCENTILE_SLIDER_MIN}" max="${VAL_PERCENTILE_SLIDER_MAX}" step="1" value="${ctrl?.default_percentile ?? 50}"
    aria-label="P/E historical percentile"`;
  return `
    <article class="val-multiples-block val-pe-block" id="multiples-pe">
      <div class="val-pane-head val-pane-head-inline">
        <span class="bb-key">PE</span>
        <span class="val-pane-title">Price / Earnings</span>
      </div>
      <div class="val-pe-workbench">
        <div class="val-pe-chart-col val-pe-col-pe">
          <p class="val-pe-chart-title">Historical price-to-earnings</p>
          <div class="val-pe-chart-wrap">
            <canvas id="multiples-pe-chart"></canvas>
          </div>
          <p class="val-pe-chart-note">P20, median, P80</p>
        </div>
        <div class="val-pe-formula-col val-pe-col-formula">
          <div class="val-pe-mult-control">
            <span class="val-pe-mult-control-label">P/E multiple · historical percentile</span>
            <div class="val-slider-col val-pe-slider-col">
              ${sliderTrackWrap(sense, inputAttrs)}
              <div class="val-slider-ticks" aria-hidden="true">${percentileSliderTicks()}</div>
              <span class="val-slider-readout" id="ctrl-readout-pe_multiple" title="Historical percentile">50</span>
            </div>
          </div>
          <div class="val-pe-formula" aria-label="P/E valuation formula">
            <div class="val-pe-formula-row">
              <div class="val-pe-formula-term val-pe-term-eps">
                <span class="val-pe-formula-label">EPS TTM</span>
                <span class="val-pe-formula-num" id="val-pe-eps-ttm">—</span>
              </div>
              <span class="val-pe-formula-op" aria-hidden="true">×</span>
              <div class="val-pe-formula-term val-pe-term-mult">
                <span class="val-pe-formula-label">P/E</span>
                <div class="val-pe-mult-input-wrap">
                  <input type="text" id="ctrl-input-pe_multiple" class="val-pe-formula-num val-pe-mult-input"
                    data-assumption="pe_multiple" data-format="ratio" inputmode="decimal"
                    aria-label="P/E multiple" />
                  <span class="val-pe-mult-suffix">×</span>
                </div>
              </div>
              <span class="val-pe-formula-op" aria-hidden="true">=</span>
              <div class="val-pe-formula-term val-pe-term-price">
                <span class="val-pe-formula-label">Est. price</span>
                <span class="val-pe-formula-num val-pe-price-num" id="val-pe-est-price">—</span>
              </div>
            </div>
          </div>
          <div class="val-pe-foot">
            <span class="val-pe-foot-k">Market</span>
            <span class="val-pe-foot-v" id="val-pe-summary-market">—</span>
            <span class="val-pe-foot-sep">·</span>
            <span class="val-pe-foot-k">Return</span>
            <span class="val-pe-foot-v" id="val-pe-summary-delta">—</span>
          </div>
        </div>
        <div class="val-pe-chart-col val-pe-col-eps">
          <p class="val-pe-chart-title">Estimated price by EPS</p>
          <div class="val-pe-chart-wrap">
            <canvas id="multiples-pe-eps-chart"></canvas>
          </div>
          <p class="val-pe-chart-note">10 yrs actual + 5 yr projected · P/E × EPS</p>
        </div>
      </div>
    </article>`;
}

function pbvMethodBlock(payload, sense = "up") {
  if (!payload || payload.error) {
    const hint =
      payload?.error?.includes("FMP") || payload?.error?.includes("multiples")
        ? " Run backend/scripts/build_multiples_cache.py with FMP_API_KEY, or set the key on the server."
        : "";
    return `<article class="val-multiples-block val-pbv-block"><p class="error-banner">${payload?.error || "Price / Book Value unavailable."}${hint}</p></article>`;
  }
  const ctrl = payload.controls?.[0];
  const inputAttrs = `id="ctrl-slider-pbv_multiple" data-percentile="pbv_multiple"
    min="${VAL_PERCENTILE_SLIDER_MIN}" max="${VAL_PERCENTILE_SLIDER_MAX}" step="1" value="${ctrl?.default_percentile ?? 50}"
    aria-label="P/BV historical percentile"`;
  return `
    <article class="val-multiples-block val-pbv-block" id="multiples-pbv">
      <div class="val-pane-head val-pane-head-inline">
        <span class="bb-key">PBV</span>
        <span class="val-pane-title">Price / Book Value</span>
      </div>
      <div class="val-pe-workbench">
        <div class="val-pe-chart-col val-pe-col-pe">
          <p class="val-pe-chart-title">Historical price-to-book-value</p>
          <div class="val-pe-chart-wrap">
            <canvas id="multiples-pbv-chart"></canvas>
          </div>
          <p class="val-pe-chart-note">P20, median, P80</p>
        </div>
        <div class="val-pe-formula-col val-pe-col-formula">
          <div class="val-pe-mult-control">
            <span class="val-pe-mult-control-label">P/BV multiple · historical percentile</span>
            <div class="val-slider-col val-pbv-slider-col">
              ${sliderTrackWrap(sense, inputAttrs)}
              <div class="val-slider-ticks" aria-hidden="true">${percentileSliderTicks()}</div>
              <span class="val-slider-readout" id="ctrl-readout-pbv_multiple" title="Historical percentile">50</span>
            </div>
          </div>
          <div class="val-pe-formula" aria-label="P/BV valuation formula">
            <div class="val-pe-formula-row">
              <div class="val-pe-formula-term val-pe-term-eps">
                <span class="val-pe-formula-label">BV / share</span>
                <span class="val-pe-formula-num" id="val-pbv-bvps-ttm">—</span>
              </div>
              <span class="val-pe-formula-op" aria-hidden="true">×</span>
              <div class="val-pe-formula-term val-pe-term-mult">
                <span class="val-pe-formula-label">P/BV</span>
                <div class="val-pe-mult-input-wrap">
                  <input type="text" id="ctrl-input-pbv_multiple" class="val-pe-formula-num val-pe-mult-input val-pbv-mult-input"
                    data-assumption="pbv_multiple" data-format="ratio" inputmode="decimal"
                    aria-label="P/BV multiple" />
                  <span class="val-pe-mult-suffix">×</span>
                </div>
              </div>
              <span class="val-pe-formula-op" aria-hidden="true">=</span>
              <div class="val-pe-formula-term val-pe-term-price">
                <span class="val-pe-formula-label">Est. price</span>
                <span class="val-pe-formula-num val-pe-price-num" id="val-pbv-est-price">—</span>
              </div>
            </div>
          </div>
          <div class="val-pe-foot">
            <span class="val-pe-foot-k">Market</span>
            <span class="val-pe-foot-v" id="val-pbv-summary-market">—</span>
            <span class="val-pe-foot-sep">·</span>
            <span class="val-pe-foot-k">Return</span>
            <span class="val-pe-foot-v" id="val-pbv-summary-delta">—</span>
          </div>
        </div>
        <div class="val-pe-chart-col val-pe-col-eps">
          <p class="val-pe-chart-title">Estimated price by book value</p>
          <div class="val-pe-chart-wrap">
            <canvas id="multiples-pbv-bv-chart"></canvas>
          </div>
          <p class="val-pe-chart-note">10 yrs actual + 5 yr projected · P/BV × book value</p>
        </div>
      </div>
    </article>`;
}

function multiplesMethodBlock(prefix, title, controlId, payload, sense = "up") {
  if (!payload || payload.error) {
    const hint =
      payload?.error?.includes("FMP") || payload?.error?.includes("multiples")
        ? " Run backend/scripts/build_multiples_cache.py with FMP_API_KEY, or set the key on the server."
        : "";
    return `<article class="val-multiples-block"><p class="error-banner">${payload?.error || `${title} unavailable.`}${hint}</p></article>`;
  }
  const ctrl = payload.controls?.[0];
  const inputAttrs = `id="ctrl-slider-${controlId}" data-percentile="${controlId}"
    min="${VAL_PERCENTILE_SLIDER_MIN}" max="${VAL_PERCENTILE_SLIDER_MAX}" step="1" value="${ctrl?.default_percentile ?? 50}"
    aria-label="${controlId} historical percentile"`;
  return `
    <article class="val-multiples-block" id="multiples-${prefix}">
      <div class="val-pane-head val-pane-head-inline">
        <span class="bb-key">${prefix.toUpperCase()}</span>
        <span class="val-pane-title">${title}</span>
      </div>
      <div class="val-dashboard val-dashboard-compact">
        <aside class="val-outcome-pane">
          <div class="val-outcome-body">
            <div class="val-outcome-line">
              <span class="val-outcome-k">Today's market price</span>
              <span class="val-outcome-v" id="val-${prefix}-summary-market">—</span>
            </div>
            <div class="val-outcome-line val-outcome-line-hero">
              <span class="val-outcome-k">Estimated price</span>
              <span class="val-outcome-v val-outcome-dcf" id="val-${prefix}-summary-est">—</span>
            </div>
            <div class="val-outcome-line">
              <span class="val-outcome-k">Expected return</span>
              <span class="val-outcome-v" id="val-${prefix}-summary-delta">—</span>
            </div>
          </div>
        </aside>
        <div class="val-inputs-pane">
          <div class="val-assumption-list">
            <div class="val-assumption-block">
              <div class="val-assumption-block-head">
                <span class="val-assumption-block-title">Historical percentile</span>
              </div>
              <div class="val-assumption-row">
                <label class="val-assumption-name" for="ctrl-input-${controlId}">
                  ${ctrl?.label || title}
                  <span class="val-assumption-hint">Multiple vs company history</span>
                </label>
                <div class="val-assumption-control">
                  <div class="val-assumption-input-row">
                    <div class="val-assumption-input-wrap">
                      <input type="text" id="ctrl-input-${controlId}" class="val-assumption-input" data-assumption="${controlId}"
                        data-format="ratio" inputmode="decimal" aria-label="${controlId} value" />
                      <span class="val-assumption-suffix">x</span>
                    </div>
                    <div class="val-slider-col">
                      ${sliderTrackWrap(sense, inputAttrs)}
                      <div class="val-slider-ticks" aria-hidden="true">${percentileSliderTicks()}</div>
                      <span class="val-slider-readout" id="ctrl-readout-${controlId}" title="Historical percentile">50</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <aside class="val-commentary-pane">
          <div class="val-commentary" id="val-${prefix}-commentary"></div>
        </aside>
      </div>
      <div class="val-multiples-chart-wrap">
        <canvas id="multiples-${prefix}-chart"></canvas>
      </div>
    </article>`;
}

const CONSENSUS_PRICE_ROWS = [
  { key: "high", label: "High" },
  { key: "median", label: "Median", hero: true },
  { key: "mean", label: "Mean" },
  { key: "low", label: "Low" },
];

const CONSENSUS_RATING_ROWS = [
  { key: "strong_buy", label: "Strong buy", barClass: "val-rating-bar-strong-buy" },
  { key: "buy", label: "Buy", barClass: "val-rating-bar-buy" },
  { key: "hold", label: "Hold", barClass: "val-rating-bar-hold" },
  { key: "sell", label: "Sell", barClass: "val-rating-bar-sell" },
  { key: "strong_sell", label: "Strong sell", barClass: "val-rating-bar-strong-sell" },
];

function buildConsensusPayloadFromRaw(raw) {
  if (!raw || raw.error) {
    return { method: "consensus", error: raw?.error || "Analyst consensus unavailable." };
  }
  const anchors = {
    low: raw.low,
    median: raw.median,
    mean: raw.mean,
    high: raw.high,
  };
  const disclaimer =
    "Analyst price targets reflect where covering sell-side analysts expect the share price to trade over approximately the next 12 months. They are not an intrinsic or fair-value estimate for today.";
  return {
    method: "consensus",
    scenario: "interactive",
    controls: [],
    engine: {
      ...raw,
      anchors,
      disclaimer,
    },
    assumptions: {},
    result: {
      price_per_share: raw.median,
      reference_price: raw.median,
      anchors,
    },
  };
}

async function fetchConsensusFallback(ticker) {
  const sym = String(ticker || "MSFT").toLowerCase();
  const urls = [`/static/consensus/${sym}_consensus.json`, `/api/consensus/${sym.toUpperCase()}`];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const body = await res.json();
      const raw = body.analyst_consensus || body;
      const built = buildConsensusPayloadFromRaw(raw);
      if (!built.error) return built;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function resolveConsensusPayload(data) {
  const fromApi = getValuationConsensus(data);
  if (fromApi?.engine) return fromApi;
  if (fromApi?.error && !fromApi.error.includes("stale server")) return fromApi;
  const fallback = await fetchConsensusFallback(data?.ticker);
  if (fallback) return fallback;
  return (
    fromApi || {
      error:
        "Analyst consensus unavailable. Restart the server (start.bat) or run backend/scripts/build_consensus_cache.py.",
    }
  );
}

function updateConsensusPanel(data, eng) {
  const market = data.market_bar?.price;
  const anchors = eng?.anchors || {
    low: eng?.low,
    median: eng?.median,
    mean: eng?.mean,
    high: eng?.high,
  };

  const sourceEl = document.getElementById("val-consensus-source");
  const metaEl = document.getElementById("val-consensus-meta");
  const medianHero = document.getElementById("val-consensus-median-hero");
  const marketEl = document.getElementById("val-consensus-summary-market");
  const deltaEl = document.getElementById("val-consensus-summary-delta");
  const labelEl = document.getElementById("val-consensus-rating-label");

  if (sourceEl && eng?.source) {
    sourceEl.textContent = eng.source === "fmp" ? "FMP" : "Yahoo Finance";
  }
  if (metaEl) {
    const parts = [];
    if (eng?.as_of) parts.push(`As of ${eng.as_of}`);
    if (eng?.analyst_count != null) parts.push(`${eng.analyst_count} price targets (12 mo.)`);
    if (eng?.ratings?.total) parts.push(`${eng.ratings.total} ratings`);
    metaEl.textContent = parts.join(" · ") || "—";
  }
  if (medianHero && anchors?.median != null) medianHero.textContent = fmtPrice1(anchors.median);
  if (marketEl) marketEl.textContent = fmtPrice(market);
  if (deltaEl && market != null && market > 0 && anchors?.median != null) {
    const ret = anchors.median / market - 1;
    deltaEl.textContent = `${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%`;
    deltaEl.className = `val-pe-foot-v ${ret >= 0 ? "val-upside" : "val-downside"}`;
  } else if (deltaEl) {
    deltaEl.textContent = "—";
    deltaEl.className = "val-pe-foot-v";
  }

  CONSENSUS_PRICE_ROWS.forEach(({ key, label }) => {
    const row = document.getElementById(`val-consensus-price-row-${key}`);
    const valEl = document.getElementById(`val-consensus-price-${key}`);
    const vsEl = document.getElementById(`val-consensus-price-vs-${key}`);
    const value = anchors?.[key];
    if (valEl) valEl.textContent = value != null ? fmtPrice1(value) : "—";
    if (vsEl && market != null && market > 0 && value != null) {
      const ret = value / market - 1;
      vsEl.textContent = `${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%`;
      vsEl.className = `val-consensus-vs ${ret >= 0 ? "val-upside" : "val-downside"}`;
    } else if (vsEl) {
      vsEl.textContent = "—";
      vsEl.className = "val-consensus-vs";
    }
    if (row) row.dataset.label = label;
  });

  const ratings = eng?.ratings;
  if (labelEl) {
    labelEl.textContent = ratings?.consensus_label ? `Consensus: ${ratings.consensus_label}` : "";
  }
  const ratingTotal = ratings?.total || 0;

  CONSENSUS_RATING_ROWS.forEach(({ key, barClass }) => {
    const count = ratings?.[key] ?? 0;
    const countEl = document.getElementById(`val-consensus-rating-count-${key}`);
    const barEl = document.getElementById(`val-consensus-rating-bar-${key}`);
    const rowEl = document.getElementById(`val-consensus-rating-row-${key}`);
    if (countEl) countEl.textContent = String(count);
    if (barEl) {
      const pct = ratingTotal > 0 ? (count / ratingTotal) * 100 : 0;
      barEl.style.width = `${Math.round(pct)}%`;
      barEl.className = `val-consensus-rating-bar-fill ${barClass}`;
    }
    if (rowEl) rowEl.classList.toggle("val-consensus-rating-row-empty", !ratings || count === 0);
  });

  const ratingsEmpty = document.getElementById("val-consensus-ratings-empty");
  if (ratingsEmpty) ratingsEmpty.hidden = Boolean(ratings?.total);
}

function applyConsensusModel(data) {
  const payload = data?.valuation?.consensus || getValuationConsensus(data);
  if (!payload?.engine) return;
  updateConsensusPanel(data, payload.engine);
}

function consensusMethodBlock(payload) {
  if (!payload || payload.error) {
    return `<article class="val-multiples-block val-consensus-block"><p class="error-banner">${payload?.error || "Analyst consensus unavailable."}</p></article>`;
  }
  const eng = payload.engine;
  const disclaimer =
    eng?.disclaimer ||
    "Analyst price targets reflect expected share prices over approximately the next 12 months, not intrinsic value today.";

  const priceRowsHtml = CONSENSUS_PRICE_ROWS.map(
    ({ key, label, hero }) => `
    <div class="val-consensus-table-row ${hero ? "val-consensus-table-row-hero" : ""}" id="val-consensus-price-row-${key}">
      <span class="val-consensus-table-k">${label}</span>
      <span class="val-consensus-table-v" id="val-consensus-price-${key}">—</span>
      <span class="val-consensus-vs" id="val-consensus-price-vs-${key}">—</span>
    </div>`,
  ).join("");

  const ratingRowsHtml = CONSENSUS_RATING_ROWS.map(
    ({ key, label }) => `
    <div class="val-consensus-table-row val-consensus-rating-row" id="val-consensus-rating-row-${key}">
      <span class="val-consensus-table-k">${label}</span>
      <div class="val-consensus-rating-bar" aria-hidden="true">
        <div class="val-consensus-rating-bar-fill" id="val-consensus-rating-bar-${key}"></div>
      </div>
      <span class="val-consensus-rating-count" id="val-consensus-rating-count-${key}">0</span>
    </div>`,
  ).join("");

  return `
    <article class="val-multiples-block val-consensus-block" id="multiples-consensus">
      <div class="val-pane-head val-pane-head-inline">
        <span class="bb-key">CON</span>
        <span class="val-pane-title">Analyst consensus</span>
        <span class="val-consensus-head-meta" id="val-consensus-source">—</span>
      </div>
      <div class="val-consensus-headline">
        <div class="val-consensus-headline-main">
          <span class="val-consensus-headline-k">Median target (12M)</span>
          <span class="val-consensus-median-hero" id="val-consensus-median-hero">—</span>
        </div>
        <div class="val-consensus-headline-sub">
          <span class="val-pe-foot-k">Market</span>
          <span class="val-pe-foot-v" id="val-consensus-summary-market">—</span>
          <span class="val-pe-foot-sep">·</span>
          <span class="val-pe-foot-k">vs median</span>
          <span class="val-pe-foot-v" id="val-consensus-summary-delta">—</span>
        </div>
        <p class="val-consensus-meta" id="val-consensus-meta">—</p>
      </div>
      <div class="val-consensus-dual">
        <section class="val-consensus-panel" aria-labelledby="val-consensus-prices-title">
          <h3 class="val-consensus-panel-title" id="val-consensus-prices-title">Price targets</h3>
          <p class="val-consensus-panel-note">12-month forward · aggregated</p>
          <div class="val-consensus-table val-consensus-table-prices">
            <div class="val-consensus-table-head">
              <span>Level</span><span>Target</span><span>vs market</span>
            </div>
            ${priceRowsHtml}
          </div>
        </section>
        <section class="val-consensus-panel" aria-labelledby="val-consensus-ratings-title">
          <h3 class="val-consensus-panel-title" id="val-consensus-ratings-title">Analyst ratings</h3>
          <p class="val-consensus-panel-note" id="val-consensus-rating-label"></p>
          <div class="val-consensus-table val-consensus-table-ratings">
            <div class="val-consensus-table-head val-consensus-table-head-ratings">
              <span>Rating</span><span class="val-consensus-head-bar">Distribution</span><span>#</span>
            </div>
            ${ratingRowsHtml}
          </div>
          <p class="val-consensus-ratings-empty" id="val-consensus-ratings-empty" hidden>
            Rating breakdown unavailable for this ticker (requires FMP or Yahoo analyst ratings).
          </p>
        </section>
      </div>
      <p class="val-consensus-disclaimer">${disclaimer}</p>
    </article>`;
}

function renderConsensusValuation(data) {
  const container = document.getElementById("valuation-consensus-container");
  if (!container) return;
  container.innerHTML = `<p class="val-comment-dim">Loading analyst consensus…</p>`;
  resolveConsensusPayload(data).then((consensus) => {
    if (!container.isConnected) return;
    container.innerHTML = consensusMethodBlock(consensus);
    if (consensus?.engine) {
      applyConsensusModel({ ...data, valuation: { ...data.valuation, consensus } });
    }
  });
}

function renderMultiplesValuation(data) {
  const container = document.getElementById("valuation-multiples-container");
  if (!container) return;

  if (multiplesPeChart) {
    multiplesPeChart.destroy();
    multiplesPeChart = null;
  }
  if (multiplesPeEpsChart) {
    multiplesPeEpsChart.destroy();
    multiplesPeEpsChart = null;
  }
  if (multiplesPbvChart) {
    multiplesPbvChart.destroy();
    multiplesPbvChart = null;
  }
  if (multiplesPbvBvChart) {
    multiplesPbvBvChart.destroy();
    multiplesPbvBvChart = null;
  }

  const pe = getValuationPe(data);
  const pbv = getValuationPbv(data);

  multiplesState = {
    pe_p: pe?.assumptions?.pe_multiple_p ?? 50,
    pbv_p: pbv?.assumptions?.pbv_multiple_p ?? 50,
  };

  container.innerHTML = peMethodBlock(pe, "up") + pbvMethodBlock(pbv, "up");

  if (pe?.engine) {
    applyMultiplesModel(data, "pe");
  }
  if (pbv?.engine) {
    applyMultiplesModel(data, "pbv");
  }

  bindMultiplesControls(data);

  if (!document.getElementById("valuation-panel-multiples")?.classList.contains("hidden")) {
    requestAnimationFrame(() => {
      ensurePeChartsVisible();
      ensurePbvChartsVisible();
    });
  }
}

function setValuationMethod(method) {
  currentValuationMethod =
    method === "multiples"
      ? "multiples"
      : method === "consensus"
        ? "consensus"
        : method === "dcf-draft"
          ? "dcf-draft"
          : "dcf1";
  document.querySelectorAll("#valuation-subnav [data-val-method]").forEach((link) => {
    link.classList.toggle("active", link.dataset.valMethod === currentValuationMethod);
  });
  document.getElementById("valuation-panel-dcf")?.classList.toggle("hidden", currentValuationMethod !== "dcf1");
  document.getElementById("valuation-panel-dcf-draft")?.classList.toggle("hidden", currentValuationMethod !== "dcf-draft");
  document.getElementById("valuation-panel-multiples")?.classList.toggle("hidden", currentValuationMethod !== "multiples");
  document.getElementById("valuation-panel-consensus")?.classList.toggle("hidden", currentValuationMethod !== "consensus");

  const engineEl = document.getElementById("bb-engine-status");
  if (engineEl && currentDomain === "valuation") {
    engineEl.textContent =
      currentValuationMethod === "multiples"
        ? "Engine: Multiples · P/E & P/BV"
        : currentValuationMethod === "consensus"
          ? "Engine: Analyst consensus"
          : currentValuationMethod === "dcf-draft"
            ? "Engine: DCF · Draft"
            : "Engine: DCF · Method 1";
  }

  if (currentDomain === "valuation") updateDomainUrl("valuation");

  if (currentValuationMethod === "dcf1" && valuationFlowChart) {
    requestAnimationFrame(() => syncValuationFlowFooter(valuationFlowChart));
  }
  if (currentValuationMethod === "dcf-draft" && typeof onValuationDraftPanelShown === "function") {
    onValuationDraftPanelShown();
  }
  if (currentValuationMethod === "multiples") {
    ensurePeChartsVisible();
    ensurePbvChartsVisible();
  }
  if (currentValuationMethod === "consensus" && currentThesisData) {
    applyConsensusModel(currentThesisData);
  }
  syncMobileValuationNav();
}

function bindValuationNav() {
  document.querySelectorAll("#valuation-subnav [data-val-method]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setDomain("valuation");
      setNavSubExpanded("valuation", true);
      setValuationMethod(link.dataset.valMethod);
    });
  });
}

function bindValuationControls(data) {
  const engine = getValuationDcf(data)?.engine;
  if (!engine) return;

  document.querySelectorAll("#valuation-container .val-slider[data-percentile]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = `${input.dataset.percentile}_p`;
      valuationState[key] = Number(input.value);
      updateSliderTickHighlight(input, Number(input.value));
      applyValuationModel(data);
    });
  });

  document.querySelectorAll("#valuation-container .val-assumption-input[data-assumption]").forEach((input) => {
    const applyFromInput = () => {
      const id = input.dataset.assumption;
      const fmt = input.dataset.format || VAL_CONTROL_FORMAT[id];
      if (id === "wacc") {
        const pct = parseControlInput("percent", input.value);
        if (pct == null) return;
        valuationState.wacc = pct;
        applyValuationModel(data);
        return;
      }
      const parsed = parseControlInput(fmt, input.value);
      if (parsed == null) return;
      const history = engine.percentile_history?.[id];
      if (!history?.length) return;
      valuationState[`${id}_p`] = valueToPercentile(history, parsed);
      applyValuationModel(data);
    };
    input.addEventListener("input", applyFromInput);
    input.addEventListener("change", applyFromInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
  });

  const waccSlider = document.getElementById("ctrl-wacc");
  if (waccSlider) {
    waccSlider.addEventListener("input", () => {
      valuationState.wacc = Number(waccSlider.value) / 100;
      applyValuationModel(data);
    });
  }
}

function renderValuation(data) {
  const container = document.getElementById("valuation-container");
  if (!container) return;

  if (valuationFlowChart) {
    valuationFlowChart.destroy();
    valuationFlowChart = null;
  }

  const v = getValuationDcf(data);
  if (!v || v.error) {
    container.innerHTML = `<p class="error-banner">${v?.error || "Valuation unavailable."}</p>`;
    return;
  }

  const engine = v.engine;
  if (!engine) {
    container.innerHTML = `<p class="error-banner">Valuation engine data missing.</p>`;
    return;
  }

  valuationState = {
    revenue_growth_p: 50,
    net_margin_p: 50,
    cfo_to_ni_p: 50,
    capex_to_cfo_p: 50,
    wacc: 0.09,
  };

  const forecastYears = engine.forecast_years ?? 7;
  const controlsById = Object.fromEntries((v.controls || []).map((c) => [c.id, c]));
  const percentileIds = ["revenue_growth", "net_margin", "cfo_to_ni", "capex_to_cfo"];

  const assumptionRows = percentileIds
    .map((id) => {
      const c = controlsById[id];
      if (!c?.history) return "";
      const meta = VAL_ASSUMPTION_META[id];
      return `
    <div class="val-assumption-row">
      <label class="val-assumption-name" for="ctrl-input-${id}">
        ${meta.label}
        <span class="val-assumption-hint">${meta.hint(forecastYears)}</span>
      </label>
      <div class="val-assumption-control">
        ${assumptionInputWrap(id, VAL_CONTROL_FORMAT[id], c.default_percentile ?? 50, VAL_ASSUMPTION_SLIDER_SENSE[id])}
      </div>
    </div>`;
    })
    .join("");

  const waccMeta = VAL_ASSUMPTION_META.wacc;
  const waccRow = `
    <div class="val-assumption-row">
      <label class="val-assumption-name" for="ctrl-input-wacc">
        ${waccMeta.label}
        <span class="val-assumption-hint">${waccMeta.hint()}</span>
      </label>
      <div class="val-assumption-control">
        <div class="val-assumption-input-row">
          <div class="val-assumption-input-wrap">
            <input type="text" id="ctrl-input-wacc" class="val-assumption-input" data-assumption="wacc"
              data-format="percent" inputmode="decimal" aria-label="WACC percent" value="9.0" />
            <span class="val-assumption-suffix">%</span>
          </div>
          <div class="val-slider-col val-slider-col-wacc">
            ${sliderTrackWrap(
              "down",
              `id="ctrl-wacc" min="5" max="18" step="0.1" value="9" aria-label="WACC percent"`,
            )}
          </div>
        </div>
      </div>
    </div>`;


  container.innerHTML = `
    <section class="val-dashboard">
      <div class="val-dashboard-grid">
        <aside class="val-outcome-pane">
          <div class="val-pane-head">
            <span class="bb-key">$</span>
            <span class="val-pane-title">Valuation</span>
          </div>
          <div class="val-outcome-body">
            <div class="val-outcome-line">
              <span class="val-outcome-k">Today's market price</span>
              <span class="val-outcome-v" id="val-summary-market">—</span>
            </div>
            <div class="val-outcome-line val-outcome-line-hero">
              <span class="val-outcome-k">Estimated price</span>
              <span class="val-outcome-v val-outcome-dcf" id="val-summary-dcf">—</span>
            </div>
            <div class="val-outcome-line">
              <span class="val-outcome-k">Expected return</span>
              <span class="val-outcome-v" id="val-summary-delta">—</span>
            </div>
          </div>
        </aside>

        <div class="val-inputs-pane">
          <div class="val-pane-head">
            <span class="bb-key">IN</span>
            <span class="val-pane-title">Model assumptions</span>
          </div>
          <div class="val-assumption-list">
            <div class="val-assumption-block">
              <div class="val-assumption-block-head">
                <span class="val-assumption-block-title">Historical percentile</span>
              </div>
              ${assumptionRows}
            </div>
            <div class="val-assumption-block val-assumption-block-wacc">
              <div class="val-assumption-block-head">
                <span class="val-assumption-block-title">Discount rate</span>
              </div>
              ${waccRow}
            </div>
          </div>
        </div>

        <aside class="val-commentary-pane">
          <div class="val-pane-head">
            <span class="bb-key">TXT</span>
            <span class="val-pane-title">What this means</span>
          </div>
          <div class="val-commentary" id="val-commentary"></div>
        </aside>
      </div>
    </section>

    <section class="val-section val-section-flows-price">
      <div class="val-flows-price-grid">
        <div class="val-flow-panel">
          <div class="val-pane-head val-pane-head-inline">
            <span class="bb-key">FCF</span>
            <span class="val-pane-title">Flows · actual vs projected</span>
          </div>
          <p class="val-section-hint">Values in <strong>billions</strong> · reported &nbsp;·&nbsp; projected (*)</p>
          <div class="val-flow-stack" id="val-flow-stack">
            <div class="val-chart-wrap">
              <div class="val-chart-canvas-box">
                <canvas id="val-flow-chart"></canvas>
              </div>
              <div class="val-pv-footer" id="val-pv-footer">
                <div class="val-pv-labels" id="val-pv-labels">
                  <span class="val-pv-lbl val-pv-lbl-fcff">Free cash flow</span>
                  <span class="val-pv-lbl val-pv-lbl-disc">Discount</span>
                  <span class="val-pv-lbl val-pv-lbl-pv">Present value</span>
                </div>
                <div class="val-pv-strip" id="val-pv-strip"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="val-formula-panel">
          <div class="val-pane-head val-pane-head-inline">
            <span class="bb-key">=$</span>
            <span class="val-pane-title">Price per share</span>
          </div>
          <div class="val-formula-wrap">
            <div class="val-formula" id="val-formula">
              <div class="val-formula-row">
                <span class="val-formula-label">Σ PV(FCFF)</span>
                <span class="val-formula-val" id="form-pv-fcff">—</span>
              </div>
              <div class="val-formula-row">
                <span class="val-formula-label">PV(Terminal value)</span>
                <span class="val-formula-val" id="form-pv-tv">—</span>
              </div>
              <div class="val-formula-row val-formula-divider">
                <span class="val-formula-label">Enterprise value</span>
                <span class="val-formula-val" id="form-ev">—</span>
              </div>
              <div class="val-formula-row">
                <span class="val-formula-label">+ Cash & ST investments</span>
                <span class="val-formula-val" id="form-cash">—</span>
              </div>
              <div class="val-formula-row">
                <span class="val-formula-label">+ Debt (ST + LT)</span>
                <span class="val-formula-val" id="form-debt">—</span>
              </div>
              <div class="val-formula-row val-formula-divider">
                <span class="val-formula-label">Equity value</span>
                <span class="val-formula-val" id="form-equity">—</span>
              </div>
              <div class="val-formula-row">
                <span class="val-formula-label">÷ Shares outstanding (M)</span>
                <span class="val-formula-val" id="form-shares">—</span>
              </div>
              <div class="val-formula-row val-formula-result">
                <span class="val-formula-label">Intrinsic price / share</span>
                <span class="val-formula-val val-cyan" id="form-price">—</span>
              </div>
              <span class="val-formula-unit" id="form-units" hidden>${data.units}</span>
            </div>
          </div>
        </div>
      </div>
    </section>`;

  bindValuationControls(data);
  applyValuationModel(data);
}

function formatChartValue(format, v, decimals = 0) {
  if (v === null || v === undefined) return "—";
  if (format === "percent") return `${(v * 100).toFixed(2)}%`;
  if (format === "percent_points") return `${v.toFixed(2)}%`;
  if (format === "multiple") return `${Number(v).toFixed(1)}x`;
  if (format === "ratio") return Number(v).toFixed(2);
  if (format === "billions") return fmtChartBillions(v);
  return fmtThousands(v, decimals);
}

function yTick(format, v) {
  if (format === "percent") return `${(v * 100).toFixed(0)}%`;
  if (format === "percent_points") return `${v.toFixed(1)}%`;
  if (format === "multiple") return `${Number(v).toFixed(1)}x`;
  if (format === "ratio") return Number(v).toFixed(1);
  if (format === "billions") {
    const b = fmtFlowBillions(v);
    return b === "—" ? b : `${b}B`;
  }
  return fmtThousands(v, 0);
}

function fmtLinePointLabel(format, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (format === "percent") return `${(v * 100).toFixed(1)}%`;
  if (format === "multiple") return `${Number(v).toFixed(1)}x`;
  if (format === "billions") return fmtChartBillions(v);
  return null;
}

/** Section 4 bar charts that truncate extreme outliers instead of compressing the Y-axis. */
const BROKEN_AXIS_CHART_IDS = new Set(["c2-dividend-fcff", "c3-acquisitions-fcff"]);

/** When one bar dwarfs the rest, cap the axis and mark truncated bars (finance-style break). */
function computeBrokenBarAxis(values, { avgMultiplier = 3 } = {}) {
  const entries = values
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v != null && Number.isFinite(v) && Math.abs(v) > 0);
  if (entries.length < 2) return null;

  const magnitudes = entries.map(({ v }) => Math.abs(v));
  const avg = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  const sorted = [...magnitudes].sort((a, b) => a - b);
  const secondMax = sorted[sorted.length - 2];
  const threshold = Math.max(avg * avgMultiplier, secondMax * 2);

  const brokenIndices = new Set();
  entries.forEach(({ v, i }) => {
    if (Math.abs(v) > threshold) brokenIndices.add(i);
  });
  if (!brokenIndices.size) return null;

  const normalMax = Math.max(
    ...entries.filter(({ i }) => !brokenIndices.has(i)).map(({ v }) => Math.abs(v)),
    0,
  );
  if (!normalMax) return null;

  const yMax = normalMax * 1.12;
  const cap = (v, i) => {
    if (v == null || !brokenIndices.has(i)) return v;
    return v < 0 ? -yMax : yMax;
  };

  return {
    yMax,
    brokenIndices,
    originalData: [...values],
    displayData: values.map((v, i) => cap(v, i)),
  };
}

function shouldUseBrokenAxis(chartDef) {
  if (chartDef.broken_axis === false) return false;
  if (chartDef.stacked || chartDef.grouped || chartDef.dual_axis) return false;
  if (chartDef.type !== "bar" || chartDef.series?.length !== 1) return false;
  return chartDef.broken_axis === true || BROKEN_AXIS_CHART_IDS.has(chartDef.id);
}

function drawBarBreakMarks(ctx, barX, barTopY, color) {
  const slashW = 6;
  const slashH = 5;
  const gap = 3;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  [-1, 1].forEach((sign) => {
    const cx = barX + sign * gap;
    ctx.beginPath();
    ctx.moveTo(cx - slashW * 0.35, barTopY + slashH);
    ctx.lineTo(cx + slashW * 0.35, barTopY);
    ctx.stroke();
  });
  ctx.restore();
}

function drawBrokenBarCap(ctx, chart, bar, color) {
  const topY = bar.y;
  const halfW = (bar.width || 10) / 2;
  ctx.save();
  ctx.strokeStyle = BB.bg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bar.x - halfW - 1, topY + 0.5);
  ctx.lineTo(bar.x + halfW + 1, topY + 0.5);
  ctx.stroke();
  ctx.restore();
  drawBarBreakMarks(ctx, bar.x, topY, color);
}

function drawYAxisBreakMark(ctx, chart, yScale, yMax) {
  const yPx = yScale.getPixelForValue(yMax);
  const { left, top } = chart.chartArea;
  const tickX = left - 2;
  ctx.save();
  ctx.strokeStyle = BB.grayLight;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tickX - 4, yPx + 5);
  ctx.lineTo(tickX, yPx);
  ctx.moveTo(tickX, yPx);
  ctx.lineTo(tickX - 4, yPx - 5);
  ctx.stroke();
  ctx.restore();
}

/** Bar/callout labels: billions, max ~3 digits (values stored in MLN). */
function fmtChartBillions(mln) {
  const core = fmtFlowBillions(mln);
  return core === "—" ? core : `${core}B`;
}

const FUND_LABEL_FONT = "600 9px Consolas, monospace";

function measureFundLabel(ctx, text) {
  ctx.font = FUND_LABEL_FONT;
  const w = ctx.measureText(text).width;
  return { w, h: 11 };
}

function drawBarLabelLeader(ctx, from, to, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.58;
  ctx.lineWidth = 0.9;
  ctx.setLineDash([2.5, 2]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function clampLabelCenterX(labelX, textWidth, chartArea, pad = 3) {
  const half = textWidth / 2 + pad;
  return Math.min(Math.max(labelX, chartArea.left + half), chartArea.right - half);
}

/** Last 3 bars: antepenultimate & penultimate left; last above bar. */
function layoutLastThreeBarLabels(ctx, items, chartArea, preset = "default") {
  const offsets =
    preset === "compact"
      ? { far: [28, 13], near: [18, 11], above: 12 }
      : { far: [52, 18], near: [34, 12], above: 9 };

  const sorted = [...items].sort((a, b) => a.barX - b.barX);
  const n = sorted.length;
  const placed = [];

  const placeAbove = (item) => {
    const { w } = measureFundLabel(ctx, item.text);
    const labelX = clampLabelCenterX(item.barX, w, chartArea);
    const labelY = Math.max(chartArea.top + 11, item.barY - offsets.above);
    return {
      text: item.text,
      labelX,
      labelY,
      align: "center",
      leaderFrom: { x: labelX, y: labelY + 2 },
      leaderTo: { x: item.barX, y: item.barY - 2 },
    };
  };

  const placeLeft = (item, offsetLeft, lift) => {
    const { w } = measureFundLabel(ctx, item.text);
    let labelX = item.barX - offsetLeft;
    labelX = clampLabelCenterX(labelX, w, chartArea);
    const labelY = Math.max(chartArea.top + 11, item.barY - lift);
    return {
      text: item.text,
      labelX,
      labelY,
      align: "center",
      leaderFrom: { x: labelX + w / 2, y: labelY + 2 },
      leaderTo: { x: item.barX, y: item.barY - 2 },
    };
  };

  if (n === 1) {
    placed.push(placeAbove(sorted[0]));
  } else if (n === 2) {
    placed.push(placeLeft(sorted[0], offsets.near[0], offsets.near[1]));
    placed.push(placeAbove(sorted[1]));
  } else {
    placed.push(placeLeft(sorted[0], offsets.far[0], offsets.far[1]));
    placed.push(placeLeft(sorted[1], offsets.near[0], offsets.near[1]));
    placed.push(placeAbove(sorted[2]));
  }

  return placed;
}

/** Net margin: every other point from the end (last labelled, penultimate skipped). */
function netMarginLabelIndices(total) {
  const indices = [];
  for (let i = total - 1; i >= 0; i -= 2) indices.push(i);
  return indices;
}

const F1_REVENUE_LEGEND = "REVENUE (L)";
const F1_NET_INCOME_LEGEND = "NET INCOME (R)";
const F4_TOTAL_EQUITY_LEGEND = "TOTAL EQUITY (L)";
const F4_BV_GROWTH_LEGEND = "BOOK VALUE growth (R)";

function resolveDatasetIndex(datasets, matcher) {
  if (typeof matcher === "function") return datasets.findIndex(matcher);
  return datasets.findIndex(
    (d) => d.label === matcher || d.label?.startsWith(matcher) || d.label?.includes(matcher),
  );
}

function fundamentalsSeriesColor(chartDef, series, index) {
  if (chartDef.id === "f1-revenues-net-income") {
    if (series.y_axis === "y1" || /NET INCOME/i.test(series.name || "")) return BB.cyan;
    return CHART_SERIES[0];
  }
  if (chartDef.id === "f4-equity-growth") {
    if (series.y_axis === "y1" || /BOOK VALUE/i.test(series.name || "")) return BB.cyan;
    return CHART_SERIES[0];
  }
  if (chartDef.id === "g1-growth-revenue" || chartDef.id === "g1-growth-rev-ni-eps") {
    return BB.cyan;
  }
  if (chartDef.id === "g3-flows-of-value" || chartDef.id === "g3-growth-cfo-fcff") {
    if (series.name === "CFO/NI") return BB.cyan;
    return CHART_SERIES[1];
  }
  if (chartDef.id === "g4-capex-cfo" || chartDef.id === "g4-flows-of-value") {
    if (series.name === "CAPEX/CFO") return BB.red;
  }
  if (chartDef.id === "e1-assets") {
    if (/TOTAL EQUITY/i.test(series.name || "")) return BB.green;
    if (/LIABILITIES/i.test(series.name || "")) return BB.gold;
  }
  if (chartDef.id === "e3-lt-st-debt" || chartDef.id === "e4-lt-st-debt") {
    if (/LT DEBT/i.test(series.name || "")) return BB.gold;
    if (/ST DEBT/i.test(series.name || "")) return BB.orangeDark;
  }
  if (chartDef.id === "c1-shares-outstanding") return BB.cyan;
  return CHART_SERIES[index % CHART_SERIES.length];
}

function chartShowsLegend(chartDef) {
  if (chartDef.series.length > 1) return true;
  return [
    "g1-growth-revenue",
    "g2-growth-net-income",
    "g4-capex-cfo",
    "e4-debt-ni",
    "c1-shares-outstanding",
    "c2-dividend-fcff",
    "c3-acquisitions-fcff",
    "c4-repayment-debt-fcff",
  ].includes(chartDef.id);
}

function paintLastThreeBarLabels(chart, { chartId, datasetMatcher, color, layoutPreset = "default" }) {
  if (chart.canvas?.dataset?.chartId !== chartId) return;

  const dsIndex = resolveDatasetIndex(chart.data.datasets, datasetMatcher);
  if (dsIndex < 0) return;

  const meta = chart.getDatasetMeta(dsIndex);
  const dataset = chart.data.datasets[dsIndex];
  const { ctx, chartArea } = chart;
  const n = chart.data.labels.length;
  const indices = [n - 3, n - 2, n - 1].filter((i) => i >= 0);
  if (!indices.length) return;

  const anchors = indices
    .map((i) => {
      const bar = meta.data[i];
      const v = dataset.data[i];
      if (v == null || v === undefined || !bar) return null;
      return {
        barX: bar.x,
        barY: bar.y,
        text: fmtChartBillions(v),
      };
    })
    .filter(Boolean);

  if (!anchors.length) return;

  ctx.save();
  ctx.font = FUND_LABEL_FONT;
  ctx.textBaseline = "bottom";

  layoutLastThreeBarLabels(ctx, anchors, chartArea, layoutPreset).forEach((item) => {
    drawBarLabelLeader(ctx, item.leaderFrom, item.leaderTo, color);
    ctx.textAlign = item.align || "center";
    ctx.fillStyle = color;
    ctx.fillText(item.text, item.labelX, item.labelY);
  });

  ctx.restore();
}

const revenueBarLabelsPlugin = {
  id: "revenueBarLabels",
  afterDatasetsDraw(chart) {
    paintLastThreeBarLabels(chart, {
      chartId: "f1-revenues-net-income",
      datasetMatcher: (d) => d.label?.startsWith("REVENUE"),
      color: CHART_SERIES[0],
    });
  },
};

const fcffBarLabelsPlugin = {
  id: "fcffBarLabels",
  afterDatasetsDraw(chart) {
    paintLastThreeBarLabels(chart, {
      chartId: "f3-ni-cfo-fcff",
      datasetMatcher: (d) => d.label === "FCFF",
      color: BB.cyan,
    });
  },
};

const totalEquityBarLabelsPlugin = {
  id: "totalEquityBarLabels",
  afterDatasetsDraw(chart) {
    paintLastThreeBarLabels(chart, {
      chartId: "f4-equity-growth",
      datasetMatcher: (d) => d.label?.startsWith("TOTAL EQUITY"),
      color: CHART_SERIES[0],
      layoutPreset: "compact",
    });
  },
};

const netMarginLineLabelsPlugin = {
  id: "netMarginLineLabels",
  afterDatasetsDraw(chart) {
    if (chart.canvas?.dataset?.chartId !== "f2-profitability") return;

    const dsIndex = chart.data.datasets.findIndex((d) => d.label === "NET margin");
    if (dsIndex < 0) return;

    const meta = chart.getDatasetMeta(dsIndex);
    if (meta.hidden) return;

    const dataset = chart.data.datasets[dsIndex];
    const { ctx } = chart;
    const labelIndices = netMarginLabelIndices(dataset.data.length);

    ctx.save();
    ctx.font = FUND_LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = BB.cyan;

    labelIndices.forEach((i) => {
      const v = dataset.data[i];
      const pt = meta.data[i];
      if (v == null || v === undefined || !pt || pt.skip) return;
      const labelX = pt.x;
      const labelY = pt.y - 6;
      ctx.fillText(`${(v * 100).toFixed(1)}%`, labelX, labelY);
    });

    ctx.restore();
  },
};

function growthLineLabelConfigs(chartId, datasets) {
  if (chartId === "g1-growth-revenue" || chartId === "g1-growth-rev-ni-eps") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /growth REVENUE/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "percent" }] : [];
  }
  if (chartId === "g2-growth-net-income" || chartId === "g2-net-income") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /growth NET INCOME/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "percent" }] : [];
  }
  if (chartId === "g3-flows-of-value" || chartId === "g3-growth-cfo-fcff") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => d.label === "CFO/NI");
    return dsIndex >= 0 ? [{ dsIndex, format: "multiple" }] : [];
  }
  if (chartId === "g4-capex-cfo") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => d.label === "CAPEX/CFO");
    return dsIndex >= 0 ? [{ dsIndex, format: "percent" }] : [];
  }
  if (chartId === "g4-flows-of-value") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => d.label === "CAPEX/CFO");
    return dsIndex >= 0 ? [{ dsIndex, format: "percent" }] : [];
  }
  if (chartId === "e2-pct-of-assets") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /TOTAL DEBT \/ ASSETS/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "percent" }] : [];
  }
  if (chartId === "e4-debt-ni" || chartId === "e3-debt-ni") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /TOTAL DEBT.*NET INCOME/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "multiple" }] : [];
  }
  if (chartId === "c1-shares-outstanding") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /SHARES OUTSTANDING/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "billions" }] : [];
  }
  return [];
}

function alternatingBarLabelConfigs(chartId, datasets) {
  if (chartId === "c2-dividend-fcff" || chartId === "c4-dividends") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /DIVIDEND PAID.*FCFF/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "multiple" }] : [];
  }
  if (chartId === "c3-acquisitions-fcff") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /ACQUISITIONS.*FCFF/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "percent" }] : [];
  }
  if (chartId === "c4-repayment-debt-fcff") {
    const dsIndex = resolveDatasetIndex(datasets, (d) => /REPAYMENT DEBT.*FCFF/i.test(d.label || ""));
    return dsIndex >= 0 ? [{ dsIndex, format: "percent" }] : [];
  }
  return [];
}

const growthSectionLineLabelsPlugin = {
  id: "growthSectionLineLabels",
  afterDatasetsDraw(chart) {
    const chartId = chart.canvas?.dataset?.chartId;
    const configs = growthLineLabelConfigs(chartId, chart.data.datasets);
    if (!configs.length) return;

    const { ctx } = chart;
    ctx.save();
    ctx.font = FUND_LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    configs.forEach(({ dsIndex, format }) => {
      const meta = chart.getDatasetMeta(dsIndex);
      const dataset = chart.data.datasets[dsIndex];
      if (meta.hidden) return;
      ctx.fillStyle = dataset.borderColor || CHART_SERIES[dsIndex % CHART_SERIES.length];

      netMarginLabelIndices(dataset.data.length).forEach((i) => {
        const v = dataset.data[i];
        const pt = meta.data[i];
        if (v == null || v === undefined || !pt || pt.skip) return;
        const text = fmtLinePointLabel(format, v);
        if (!text) return;
        ctx.fillText(text, pt.x, pt.y - 6);
      });
    });

    ctx.restore();
  },
};

const brokenBarAxisPlugin = {
  id: "brokenBarAxis",
  afterDatasetsDraw(chart) {
    const chartId = chart.canvas?.dataset?.chartId;
    if (!BROKEN_AXIS_CHART_IDS.has(chartId)) return;

    const info = chart.$brokenAxis;
    if (!info?.brokenIndices?.size) return;

    const meta = chart.getDatasetMeta(0);
    const dataset = chart.data.datasets[0];
    if (meta.hidden) return;

    const { ctx } = chart;
    const color = dataset.borderColor || BB.amber;
    const yScale = chart.scales.y;

    info.brokenIndices.forEach((i) => {
      const bar = meta.data[i];
      if (!bar) return;
      drawBrokenBarCap(ctx, chart, bar, color);
    });

    if (yScale) drawYAxisBreakMark(ctx, chart, yScale, info.yMax);
  },
};

const alternatingBarLabelsPlugin = {
  id: "alternatingBarLabels",
  afterDatasetsDraw(chart) {
    const chartId = chart.canvas?.dataset?.chartId;
    const configs = alternatingBarLabelConfigs(chartId, chart.data.datasets);
    if (!configs.length) return;

    const broken = chart.$brokenAxis;
    const { ctx } = chart;
    ctx.save();
    ctx.font = FUND_LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    configs.forEach(({ dsIndex, format }) => {
      const meta = chart.getDatasetMeta(dsIndex);
      const dataset = chart.data.datasets[dsIndex];
      if (meta.hidden) return;
      ctx.fillStyle = dataset.borderColor || CHART_SERIES[dsIndex % CHART_SERIES.length];

      netMarginLabelIndices(dataset.data.length).forEach((i) => {
        const raw = broken?.originalData?.[i] ?? dataset.data[i];
        const bar = meta.data[i];
        if (raw == null || raw === undefined || !bar) return;
        const text = fmtLinePointLabel(format, raw);
        if (!text) return;
        const labelY = broken?.brokenIndices?.has(i) ? bar.y - 14 : bar.y - 6;
        ctx.fillText(text, bar.x, labelY);
      });
    });

    ctx.restore();
  },
};

function fundamentalsChartPlugins(chartId) {
  const growthCharts = new Set([
    "g1-growth-revenue",
    "g1-growth-rev-ni-eps",
    "g2-growth-net-income",
    "g2-net-income",
    "g3-flows-of-value",
    "g3-growth-cfo-fcff",
    "g4-capex-cfo",
    "g4-flows-of-value",
    "e2-pct-of-assets",
    "e4-debt-ni",
    "e3-debt-ni",
    "c1-shares-outstanding",
  ]);
  const plugins = [alternatingBarLabelsPlugin];
  if (BROKEN_AXIS_CHART_IDS.has(chartId)) plugins.unshift(brokenBarAxisPlugin);
  if (chartId === "f1-revenues-net-income") plugins.push(revenueBarLabelsPlugin);
  if (chartId === "f2-profitability") plugins.push(netMarginLineLabelsPlugin);
  if (chartId === "f3-ni-cfo-fcff") plugins.push(fcffBarLabelsPlugin);
  if (chartId === "f4-equity-growth") plugins.push(totalEquityBarLabelsPlugin);
  if (growthCharts.has(chartId)) plugins.push(growthSectionLineLabelsPlugin);
  return plugins;
}

function buildChartOptions(chartDef, years) {
  const fmt = chartDef.format || "number";
  const y1Fmt =
    chartDef.series.find((s) => s.y_axis === "y1")?.format || fmt;

  const scales = {
    x: {
      stacked: !!chartDef.stacked,
      ticks: {
        color: BB.amber,
        font: { family: "Consolas, monospace", size: 10 },
        maxRotation: 0,
      },
      grid: { color: BB.grid, lineWidth: 1 },
      border: { color: BB.border || BB.grid },
    },
    y: {
      stacked: !!chartDef.stacked,
      ticks: {
        color: BB.grayLight,
        font: { family: "Consolas, monospace", size: 10 },
        callback: (v) => yTick(fmt, v),
      },
      grid: { color: BB.grid, lineWidth: 1 },
      border: { color: BB.grid },
    },
  };

  if (chartDef.dual_axis) {
    scales.y1 = {
      position: "right",
      ticks: {
        color: BB.axisRight,
        font: { family: "Consolas, monospace", size: 10 },
        callback: (v) => yTick(y1Fmt, v),
      },
      grid: { drawOnChartArea: false },
      border: { color: BB.grid },
    };
  }

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: {
      padding: {
        top:
          chartDef.id === "f1-revenues-net-income" ||
          chartDef.id === "f3-ni-cfo-fcff" ||
          chartDef.id === "f4-equity-growth"
            ? 14
            : chartDef.id === "f2-profitability" ||
                chartDef.id === "g1-growth-revenue" ||
                chartDef.id === "g2-growth-net-income" ||
                chartDef.id === "g3-flows-of-value" ||
                chartDef.id === "g4-capex-cfo" ||
                chartDef.id === "e2-pct-of-assets" ||
                chartDef.id === "e4-debt-ni" ||
                chartDef.id === "c1-shares-outstanding" ||
                chartDef.id === "c2-dividend-fcff" ||
                chartDef.id === "c3-acquisitions-fcff" ||
                chartDef.id === "c4-repayment-debt-fcff"
              ? 8
              : 0,
      },
    },
    plugins: {
      legend: {
        display: chartShowsLegend(chartDef),
        position: "top",
        align: "start",
        labels: {
          color: BB.grayLight,
          boxWidth: 10,
          boxHeight: 1,
          font: { family: "Consolas, monospace", size: 10 },
          padding: 8,
        },
      },
      tooltip: {
        backgroundColor: "#111111",
        borderColor: BB.amber,
        borderWidth: 1,
        titleColor: BB.amber,
        bodyColor: BB.white,
        titleFont: { family: "Consolas, monospace", size: 11 },
        bodyFont: { family: "Consolas, monospace", size: 11 },
        callbacks: {
          label: (c) => {
            const seriesFmt = chartDef.series[c.datasetIndex]?.format || fmt;
            return `${c.dataset.label}: ${formatChartValue(seriesFmt, c.raw)}`;
          },
        },
      },
    },
    scales,
  };
}

/** Canonical graph section order (performance before growth). */
const CHART_SECTION_ORDER = [
  {
    id: "performance",
    title: "1 FINANCIAL PERFORMANCE & PROFITABILITY RATIOS",
  },
  {
    id: "growth",
    title: "2 GROWTH & FLOWS OF VALUE",
  },
  {
    id: "equity_debt",
    title: "3 EQUITY & DEBT RATIOS",
  },
  {
    id: "cash_usage",
    title: "4 WHAT DOES IT DO WITH CASH?",
  },
  {
    id: "balance_sheet",
    title: "5 BALANCE SHEET (EQUITY, ASSETS, LIABILITIES)",
  },
];

function blockMetricSeries(block, label) {
  if (!block?.metrics?.length || !block.years?.length) return null;
  const metric = block.metrics.find((m) => m.label === label || m.key === label);
  if (!metric?.values) return null;
  return block.years.map((y) => metric.values[y] ?? null);
}

/** Chart 1: Revenue (left) + Net Income (right) — patch stale API payloads. */
function patchRevenuesNetIncomeChart(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const cashBlock = data.blocks.find((b) => /generate cash/i.test(b.name || ""));
  const revenue = blockMetricSeries(cashBlock, "TOTALREVENUE");
  const netIncome = blockMetricSeries(cashBlock, "NET INCOME");
  if (!revenue || !netIncome) return sections;

  return sections.map((section) => {
    if (section.id !== "performance") return section;
    return {
      ...section,
      charts: section.charts.map((chart) => {
        if (chart.id !== "f1-revenues-net-income") return chart;
        const hasAxisLegend = chart.series?.some((s) => s.name?.includes("(L)"));
        if (hasAxisLegend && chart.dual_axis) return chart;
        return {
          ...chart,
          type: "bar",
          dual_axis: true,
          series: [
            { name: F1_REVENUE_LEGEND, data: revenue },
            { name: F1_NET_INCOME_LEGEND, data: netIncome, y_axis: "y1" },
          ],
        };
      }),
    };
  });
}

/** Chart 2: Gross, EBIT, and net margins — patch stale API payloads. */
function patchProfitabilityChart(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const profBlock = data.blocks.find((b) => /^\s*3 profitability/i.test(b.name || ""));
  const gross = blockMetricSeries(profBlock, "GROSS marg");
  const ebit = blockMetricSeries(profBlock, "EBIT marg");
  const net = blockMetricSeries(profBlock, "NET margin");
  if (!gross || !ebit || !net) return sections;

  return sections.map((section) => {
    if (section.id !== "performance") return section;
    return {
      ...section,
      charts: section.charts.map((chart) => {
        if (chart.id !== "f2-profitability") return chart;
        const hasGross = chart.series?.some((s) => s.name === "GROSS marg");
        const hasEbt = chart.series?.some((s) => s.name === "EBT marg");
        if (hasGross && !hasEbt) return chart;
        return {
          ...chart,
          type: "line",
          format: "percent",
          series: [
            { name: "GROSS marg", data: gross, format: "percent" },
            { name: "EBIT marg", data: ebit, format: "percent" },
            { name: "NET margin", data: net, format: "percent" },
          ],
        };
      }),
    };
  });
}

function chartDefSignature(chartDef) {
  if (!chartDef) return "";
  return JSON.stringify({
    dual_axis: !!chartDef.dual_axis,
    series: (chartDef.series || []).map((s) => ({
      name: s.name,
      y_axis: s.y_axis || "y",
    })),
  });
}

/** Display titles keyed by chart id (applied after section patches). */
const CHART_TITLES = {
  "f1-revenues-net-income": "Sales",
  "f2-profitability": "Profitability",
  "f3-ni-cfo-fcff": "Cash Generation",
  "f4-equity-growth": "Equity Accumulation",
  "g1-growth-revenue": "Revenue Growth",
  "g3-flows-of-value": "Cash Flow Ratios",
  "g4-capex-cfo": "CapEx Investment",
  "e3-lt-st-debt": "Long- and Short-Term Debt",
  "e4-debt-ni": "Leverage",
};

function applyChartTitles(sections) {
  if (!sections?.length) return sections;
  return sections.map((section) => ({
    ...section,
    charts: (section.charts || []).map((chart) => {
      const title = CHART_TITLES[chart.id];
      return title ? { ...chart, title } : chart;
    }),
  }));
}

function normalizeChartSections(data) {
  const raw = data.chart_sections?.length ? data.chart_sections : null;
  let sections;
  if (raw) {
    const byId = Object.fromEntries(raw.map((s) => [s.id, s]));
    sections = CHART_SECTION_ORDER.map((meta) => byId[meta.id])
      .filter(Boolean)
      .map((s) => {
        const meta = CHART_SECTION_ORDER.find((m) => m.id === s.id);
        return meta ? { ...s, title: meta.title } : s;
      });
  } else if (data.charts?.length) {
    sections = [{ id: "legacy", title: "Graphs", charts: data.charts }];
  } else {
    return [];
  }
  return applyChartTitles(
    patchBalanceSheetCharts(
      patchCashUsageCharts(
      patchEquityDebtLtStChart(
        patchPctOfAssetsChart(
          patchAssetsStackedChart(
            patchGrowthSectionCharts(
              patchEquityGrowthChart(
                patchNiCfoFcffChart(
                  patchProfitabilityChart(patchRevenuesNetIncomeChart(sections, data), data),
                  data,
                ),
                data,
              ),
              data,
            ),
            data,
          ),
          data,
        ),
        data,
      ),
      data,
    ),
    ),
  );
}

/** Section 5: drop chart 5.4 (Current Liabilities) — four charts only. */
function patchBalanceSheetCharts(sections) {
  if (!sections?.length) return sections;
  return sections.map((section) => {
    if (section.id !== "balance_sheet") return section;
    const charts = (section.charts || []).filter((c) => c.id !== "b4-current-liabilities");
    if (charts.length === section.charts?.length) return section;
    return { ...section, charts };
  });
}

function patchCashUsageCharts(sections, data) {
  if (!sections?.length) return sections;

  const cashSection = sections.find((s) => s.id === "cash_usage");
  if (!cashSection) return sections;

  const ratiosBlock = data?.blocks?.find((b) => /balance sheet key ratios/i.test(b.name || ""));
  const divFcff = blockMetricSeries(ratiosBlock, "Dividend Paid / FCFF");
  const acqFcff =
    blockMetricSeries(ratiosBlock, "Acquisitions / FCFF") ||
    blockMetricSeries(ratiosBlock, "Adquisition / Net Income");
  const repayFcff = blockMetricSeries(ratiosBlock, "Repayment Debt/ FCFF");

  const legacyShares = cashSection.charts?.find(
    (c) =>
      /shares/i.test(c.id) ||
      /shares outstanding/i.test(c.series?.[0]?.name || ""),
  )?.series?.[0]?.data;

  const patchedShares = cashSection.charts?.find((c) => c.id === "c1-shares-outstanding")
    ?.series?.[0]?.data;
  const shares = patchedShares || legacyShares;

  const sharesChart = {
    id: "c1-shares-outstanding",
    title: "Buybacks",
    type: "line",
    format: "billions",
    series: [{ name: "SHARES OUTSTANDING", data: shares, format: "billions" }],
  };

  const dividendChart = {
    id: "c2-dividend-fcff",
    title: "Dividend Paid",
    type: "bar",
    format: "multiple",
    broken_axis: true,
    series: [{ name: "DIVIDEND PAID / FCFF (x)", data: divFcff, format: "multiple" }],
  };

  const acquisitionsChart = {
    id: "c3-acquisitions-fcff",
    title: "Acquisitions",
    type: "bar",
    format: "percent",
    broken_axis: true,
    series: [{ name: "ACQUISITIONS / FCFF (%)", data: acqFcff, format: "percent" }],
  };

  const repaymentChart = {
    id: "c4-repayment-debt-fcff",
    title: "Repayment Debt",
    type: "bar",
    format: "percent",
    broken_axis: false,
    series: [{ name: "REPAYMENT DEBT / FCFF (%)", data: repayFcff, format: "percent" }],
  };

  const okShares = shares?.some((v) => v != null);
  const okDiv = divFcff?.some((v) => v != null);
  const okAcq = acqFcff?.some((v) => v != null);
  const okRepay = repayFcff?.some((v) => v != null);
  if (!okShares && !okDiv && !okAcq && !okRepay) return sections;

  const alreadyPatched =
    cashSection.charts?.length === 4 &&
    cashSection.charts[0]?.id === "c1-shares-outstanding" &&
    cashSection.charts[0]?.title === "Buybacks" &&
    cashSection.charts[1]?.id === "c2-dividend-fcff" &&
    cashSection.charts[2]?.id === "c3-acquisitions-fcff" &&
    cashSection.charts[3]?.id === "c4-repayment-debt-fcff";
  if (alreadyPatched && okShares && okDiv && okAcq && okRepay) return sections;

  return sections.map((section) => {
    if (section.id !== "cash_usage") return section;
    return {
      ...section,
      charts: [
        okShares ? sharesChart : cashSection.charts.find((c) => /shares/i.test(c.id)),
        okDiv ? dividendChart : cashSection.charts.find((c) => /dividend/i.test(c.id)),
        okAcq ? acquisitionsChart : cashSection.charts.find((c) => /acquisition/i.test(c.id)),
        okRepay ? repaymentChart : cashSection.charts.find((c) => /repay/i.test(c.id)),
      ].filter(Boolean),
    };
  });
}

function patchEquityDebtLtStChart(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const ratiosBlock = data.blocks.find((b) => /balance sheet key ratios/i.test(b.name || ""));
  const stDebt = blockMetricSeries(ratiosBlock, "ST Debt / Total Debt");
  const ltDebt = blockMetricSeries(ratiosBlock, "LT Debt / Total Debt");
  const debtNi = blockMetricSeries(ratiosBlock, "Total Debt / Net Income");
  if (!stDebt || !ltDebt || !debtNi) return sections;

  const ltStChart = {
    id: "e3-lt-st-debt",
    title: "Long- and Short-Term Debt",
    type: "bar",
    stacked: true,
    format: "percent",
    series: [
      { name: "ST DEBT / TOTAL DEBT", data: stDebt, format: "percent" },
      { name: "LT DEBT / TOTAL DEBT", data: ltDebt, format: "percent" },
    ],
  };

  const debtNiChart = {
    id: "e4-debt-ni",
    title: "Leverage",
    type: "line",
    format: "multiple",
    series: [{ name: "TOTAL DEBT / NET INCOME (x)", data: debtNi, format: "multiple" }],
  };

  return sections.map((section) => {
    if (section.id !== "equity_debt") return section;
    const byId = Object.fromEntries((section.charts || []).map((c) => [c.id, c]));
    const e1 = byId["e1-assets"];
    const e2 = byId["e2-pct-of-assets"];
    const patchedE1 = e1?.stacked ? e1 : null;
    const patchedE2 = e2?.series?.some((s) => s.name === "CURRENT ASSETS / ASSETS") ? e2 : null;
    return {
      ...section,
      charts: [
        patchedE1 || e1,
        patchedE2 || e2,
        ltStChart,
        debtNiChart,
      ].filter(Boolean),
    };
  });
}

function patchPctOfAssetsChart(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const pctBlock = data.blocks.find((b) => /balance sheet \(% of assets\)/i.test(b.name || ""));
  const currentAssets = blockMetricSeries(pctBlock, "Total Current Assets");
  const debtAssets = blockMetricSeries(pctBlock, "Total Debt/Assets");
  if (!currentAssets || !debtAssets) return sections;

  const pctChart = {
    id: "e2-pct-of-assets",
    title: "% of Assets",
    type: "line",
    format: "percent",
    series: [
      { name: "CURRENT ASSETS / ASSETS", data: currentAssets, format: "percent" },
      { name: "TOTAL DEBT / ASSETS", data: debtAssets, format: "percent" },
    ],
  };

  return sections.map((section) => {
    if (section.id !== "equity_debt") return section;
    return {
      ...section,
      charts: section.charts.map((chart) => {
        if (chart.id !== "e2-pct-of-assets") return chart;
        const ok = chart.series?.some((s) => s.name === "CURRENT ASSETS / ASSETS");
        if (ok) return chart;
        return pctChart;
      }),
    };
  });
}

function patchAssetsStackedChart(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const pctBlock = data.blocks.find((b) => /balance sheet \(% of assets\)/i.test(b.name || ""));
  const equity = blockMetricSeries(pctBlock, "Total Equity");
  if (!equity) return sections;

  const liabilities = equity.map((v) => (v != null ? 1 - v : null));

  const assetsChart = {
    id: "e1-assets",
    title: "Assets",
    type: "bar",
    stacked: true,
    format: "percent",
    series: [
      { name: "TOTAL EQUITY", data: equity, format: "percent" },
      { name: "LIABILITIES", data: liabilities, format: "percent" },
    ],
  };

  return sections.map((section) => {
    if (section.id !== "equity_debt") return section;
    return {
      ...section,
      charts: section.charts.map((chart) => {
        if (chart.id !== "e1-assets") return chart;
        return assetsChart;
      }),
    };
  });
}

function patchGrowthSectionCharts(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const growthBlock = data.blocks.find((b) => /^\s*2 growth/i.test(b.name || ""));
  const ratiosBlock = data.blocks.find((b) => /other key ratios/i.test(b.name || ""));
  const growthRevenue = blockMetricSeries(growthBlock, "growth REVENUE");
  const growthNi = blockMetricSeries(growthBlock, "growth NET INCOME");
  const cfoNi = blockMetricSeries(ratiosBlock, "CFO/NI");
  const fcffNi = blockMetricSeries(ratiosBlock, "FCFF/NI");
  const capexCfo = blockMetricSeries(ratiosBlock, "CAPEX/CFO");
  if (!growthRevenue || !growthNi || !cfoNi || !fcffNi || !capexCfo) return sections;

  const growthCharts = [
    {
      id: "g1-growth-revenue",
      title: "Revenue Growth",
      type: "line",
      format: "percent",
      series: [{ name: "growth REVENUE", data: growthRevenue, format: "percent" }],
    },
    {
      id: "g2-growth-net-income",
      title: "Growth Net Income",
      type: "line",
      format: "percent",
      series: [{ name: "growth NET INCOME", data: growthNi, format: "percent" }],
    },
    {
      id: "g3-flows-of-value",
      title: "Cash Flow Ratios",
      type: "line",
      format: "multiple",
      series: [
        { name: "CFO/NI", data: cfoNi, format: "multiple" },
        { name: "FCFF/NI", data: fcffNi, format: "multiple" },
      ],
    },
    {
      id: "g4-capex-cfo",
      title: "CapEx Investment",
      type: "line",
      format: "percent",
      series: [{ name: "CAPEX/CFO", data: capexCfo, format: "percent" }],
    },
  ];

  return sections.map((section) => {
    if (section.id !== "growth") return section;
    const ok = section.charts?.[0]?.id === "g1-growth-revenue" && section.charts?.[3]?.id === "g4-capex-cfo";
    if (ok) return section;
    return { ...section, charts: growthCharts };
  });
}

function patchEquityGrowthChart(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const bsBlock = data.blocks.find((b) => /^6 balance sheet$/i.test((b.name || "").trim()));
  const ratiosBlock = data.blocks.find((b) => /other key ratios/i.test(b.name || ""));
  const totalEquity = blockMetricSeries(bsBlock, "Total Equity");
  const bvGrowth = blockMetricSeries(ratiosBlock, "BOOK VALUE Growth");
  if (!totalEquity || !bvGrowth) return sections;

  const equityChart = {
    id: "f4-equity-growth",
    title: "Equity Accumulation",
    type: "bar",
    dual_axis: true,
    format: "number",
    series: [
      { name: F4_TOTAL_EQUITY_LEGEND, data: totalEquity },
      {
        name: F4_BV_GROWTH_LEGEND,
        data: bvGrowth,
        type: "line",
        format: "percent",
        y_axis: "y1",
      },
    ],
  };

  return sections.map((section) => {
    if (section.id !== "performance") return section;
    return {
      ...section,
      charts: section.charts.map((chart) => {
        if (chart.id !== "f4-equity-growth") return chart;
        const ok = chart.series?.some((s) => s.name === F4_TOTAL_EQUITY_LEGEND);
        if (ok) return chart;
        return equityChart;
      }),
    };
  });
}

function patchNiCfoFcffChart(sections, data) {
  if (!sections?.length || !data?.blocks?.length) return sections;

  const cashBlock = data.blocks.find((b) => /generate cash/i.test(b.name || ""));
  const netIncome = blockMetricSeries(cashBlock, "NET INCOME");
  const cfo = blockMetricSeries(cashBlock, "CFO");
  const fcff = blockMetricSeries(cashBlock, "FCFF");
  if (!netIncome || !cfo || !fcff) return sections;

  const niCfoFcffChart = {
    id: "f3-ni-cfo-fcff",
    title: "Cash Generation",
    type: "bar",
    grouped: true,
    format: "number",
    dual_axis: false,
    series: [
      { name: "NET INCOME", data: netIncome },
      { name: "CFO", data: cfo },
      { name: "FCFF", data: fcff },
    ],
  };

  return sections.map((section) => {
    if (section.id !== "performance") return section;
    const charts = section.charts.map((chart) => {
      if (chart.id !== "f3-wacc" && chart.id !== "f3-ni-cfo-fcff") return chart;
      const ok =
        chart.id === "f3-ni-cfo-fcff" &&
        chart.type === "bar" &&
        chart.grouped &&
        chart.series?.some((s) => s.name === "CFO");
      return ok ? chart : niCfoFcffChart;
    });
    return { ...section, charts };
  });
}

function createChartInstance(canvas, chartDef, years) {
  if (chartDef.as_percent && !chartDef.format) {
    chartDef.format = "percent";
  }

  const defaultType = chartDef.type;
  const isProfitability = chartDef.id === "f2-profitability";
  const isGroupedBar = !!chartDef.grouped;
  const isF4Equity = chartDef.id === "f4-equity-growth";
  const netMarginPointR = 2;
  const otherMarginPointR = netMarginPointR * (2 / 3);
  const bvGrowthPointR = 1;

  let brokenAxisInfo = null;
  if (shouldUseBrokenAxis(chartDef)) {
    const raw = chartDef.series[0]?.data;
    if (raw) brokenAxisInfo = computeBrokenBarAxis(raw);
  }

  const datasets = chartDef.series.map((s, i) => {
    const seriesType = s.type || defaultType;
    const isBar = seriesType === "bar";
    const isNetMargin = s.name === "NET margin";
    const isBvGrowthLine =
      isF4Equity &&
      seriesType === "line" &&
      (s.y_axis === "y1" || /BOOK VALUE/i.test(s.name || ""));
    const pointR = isBar
      ? 0
      : isProfitability
        ? isNetMargin
          ? netMarginPointR
          : otherMarginPointR
        : isBvGrowthLine
          ? bvGrowthPointR
          : 2;
    const seriesColor = fundamentalsSeriesColor(chartDef, s, i);
    const barFill =
      isBar && isF4Equity ? "rgba(255, 153, 0, 0.42)" : isBar ? seriesColor : undefined;
    const seriesData =
      brokenAxisInfo && i === 0 ? brokenAxisInfo.displayData : s.data;
    return {
      label: s.name,
      data: seriesData,
      type: seriesType,
      yAxisID: s.y_axis || "y",
      order: isBvGrowthLine ? 2 : isBar ? 1 : 0,
      backgroundColor: barFill,
      borderColor: isBar ? seriesColor : seriesColor,
      borderWidth: isBar ? 1 : isBvGrowthLine ? 1.5 : 1.5,
      tension: 0,
      fill: false,
      pointRadius: pointR,
      pointHoverRadius: isBvGrowthLine ? 2 : isProfitability ? (isNetMargin ? 3 : 2) : 3,
      pointBackgroundColor: seriesColor,
      pointBorderColor: seriesColor,
      borderRadius: 0,
      barPercentage: isGroupedBar ? 0.92 : chartDef.stacked ? 0.9 : 0.85,
      categoryPercentage: isGroupedBar ? 0.72 : 0.9,
      maxBarThickness: isGroupedBar ? 12 : undefined,
      stack: chartDef.stacked ? "stack" : undefined,
    };
  });

  const options = buildChartOptions(chartDef, years);

  if (brokenAxisInfo) {
    options.scales.y.max = brokenAxisInfo.yMax;
    options.scales.y.grace = 0;
    options.scales.y.beginAtZero = true;
    options.plugins.tooltip.callbacks.label = (c) => {
      const raw = brokenAxisInfo.brokenIndices.has(c.dataIndex)
        ? brokenAxisInfo.originalData[c.dataIndex]
        : c.raw;
      const seriesFmt =
        chartDef.series[c.datasetIndex]?.format || chartDef.format || "number";
      return `${c.dataset.label}: ${formatChartValue(seriesFmt, raw)}`;
    };
  }

  const chartInstance = new Chart(canvas, {
    type: defaultType,
    data: { labels: years, datasets },
    options,
    plugins: fundamentalsChartPlugins(chartDef.id),
  });
  chartInstance.$brokenAxis = brokenAxisInfo;
  charts[chartDef.id] = chartInstance;
}

function ensureChartsInBody(bodyEl) {
  const years = chartYears;
  bodyEl.querySelectorAll("canvas[data-chart-id]").forEach((canvas) => {
    const chartId = canvas.dataset.chartId;
    const chartDef = chartDefsById[chartId];
    if (!chartDef) return;

    const sig = chartDefSignature(chartDef);
    if (charts[chartId]) {
      if (charts[chartId].$defSig === sig) {
        charts[chartId].resize();
        return;
      }
      charts[chartId].destroy();
      delete charts[chartId];
    }

    try {
      createChartInstance(canvas, chartDef, years);
      charts[chartId].$defSig = sig;
    } catch (err) {
      console.error(`Chart failed: ${chartId}`, err);
      canvas.parentElement.innerHTML = `<p class="charts-missing-note">Chart error: ${chartDef.title}</p>`;
    }
  });
}

let chartYears = [];
const chartDefsById = {};

function renderCharts(data) {
  const grid = document.getElementById("charts-grid");
  const sections = normalizeChartSections(data);
  const missing = data.charts_missing_data || [];

  chartYears = data.blocks[0].years.map((y) => y.replace("FY ", ""));
  Object.keys(chartDefsById).forEach((k) => delete chartDefsById[k]);
  sections.forEach((section) => {
    section.charts.forEach((c) => {
      chartDefsById[c.id] = c;
    });
  });

  grid.innerHTML =
    sections
      .map(
        (section, i) => `
    <section class="block-section collapsible chart-section" id="chart-block-${i}" data-chart-section="${i}">
      <button type="button" class="section-toggle" aria-expanded="false" aria-controls="chart-body-${i}">
        <span class="chevron">+</span>
        <span class="section-title">${section.title}</span>
      </button>
      <div id="chart-body-${i}" class="section-body collapsed">
        <div class="charts-grid-inner">
          ${section.charts
            .map(
              (c) => `
          <article class="chart-card">
            <h3>${c.title}</h3>
            <div class="chart-wrap"><canvas id="chart-${c.id}" data-chart-id="${c.id}"></canvas></div>
          </article>`,
            )
            .join("")}
        </div>
      </div>
    </section>`,
      )
      .join("") +
    (missing.length
      ? `<p class="charts-missing-note">Charts with no data in preload: ${missing.join(", ")}</p>`
      : "") +
    (!sections.length
      ? `<p class="charts-missing-note">No chart data from API. Restart start.bat and hard-refresh (Ctrl+F5).</p>`
      : "");

  Object.values(charts).forEach((c) => c.destroy());
  Object.keys(charts).forEach((k) => delete charts[k]);

  bindCollapsibles(grid);
  if (isMobileLayout()) {
    setMobileActiveChartSection(mobileActiveChartSection);
  } else if (currentDomain === "fundamentals" && getUrlParams().chartSection == null && getUrlParams().fundSection == null) {
    collapseAllChartSectionsExcept(0);
  }
}

async function init() {
  const inputEl = document.getElementById("ticker-input");

  tickClock();
  setInterval(tickClock, 1000);
  bindMainNav();
  bindValuationNav();
  bindMobileShell();
  bindTickerPicker();
  bindTickerInput();

  const { ticker: urlTicker, domain, valMethod, fundSection } = getUrlParams();
  setTickerInputValue(urlTicker);
  setDomain(domain, { updateUrl: false });
  if (domain === "valuation") setValuationMethod(valMethod);
  syncMobileChrome();

  const tickersPromise = fetchReadyTickers({ catalog: false });
  const renderPromise = loadAndRender(urlTicker);
  await renderPromise;
  tickersPromise.catch(() => {});
}

async function navigateTicker(ticker) {
  const sym = resolveTicker(ticker);
  if (!READY_TICKERS.includes(sym)) return;
  const navState = captureNavState();
  closeTickerPicker();
  releaseMobileInputZoom();
  syncNavUrl(sym, navState);
  setTickerInputValue(sym);
  setDomain(navState.domain, { updateUrl: false });
  if (navState.domain === "valuation") setValuationMethod(navState.valMethod);
  syncMobileChrome();
  await loadAndRender(sym, { navState });
}

async function loadAndRender(ticker, { navState } = {}) {
  const nameEl = document.getElementById("company-name");
  const metaEl = document.getElementById("company-meta");
  const sourceStatus = document.getElementById("bb-source-status");
  const state = navState || captureNavState();
  const targetDomain = state.domain || currentDomain;

  try {
    const data = await loadThesis(ticker);
    currentThesisData = data;
    heavySectionsDone = false;
    heavySectionsTicker = null;
    renderHeader(data);
    renderOnePager(data);
    renderNav(data.blocks, data);

    const mobileOnePagerFirst = isMobileLayout() && targetDomain === "one-pager";
    if (mobileOnePagerFirst) {
      scheduleHeavySectionsRender(data);
    } else {
      await ensureHeavySectionsRendered(data);
    }

    setDomain(targetDomain, { updateUrl: false });
    if (targetDomain === "valuation") setValuationMethod(state.valMethod || currentValuationMethod);
    restoreFundamentalsSection(state);
    syncMobileChrome();
    if (sourceStatus) {
      const src = data.source || "preload";
      sourceStatus.textContent = `Source: ${src.toUpperCase()} · cached`;
    }
  } catch (err) {
    console.error(err);
    if (nameEl) nameEl.textContent = "Error loading data";
    if (metaEl) metaEl.textContent = err.message;
    const blocks = document.getElementById("blocks-container");
    if (blocks) {
      blocks.innerHTML = `<p class="error-banner">Could not load ${ticker}: ${err.message}</p>`;
    }
  }
}

init();
