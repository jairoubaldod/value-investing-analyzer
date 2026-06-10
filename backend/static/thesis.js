const charts = {};

/* Bloomberg Terminal chart / data palette */
const BB = {
  amber: "#ff9900",
  white: "#ffffff",
  gray: "#666666",
  grayLight: "#999999",
  red: "#ff3333",
  green: "#33cc33",
  cyan: "#00ffff",
  gold: "#e6ac00",
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

if (typeof Chart !== "undefined") {
  Chart.defaults.color = BB.amber;
  Chart.defaults.borderColor = BB.grid;
  Chart.defaults.backgroundColor = BB.bg;
  Chart.defaults.font.family = "Consolas, Courier New, monospace";
  Chart.defaults.font.size = 10;
}

let TOP_US_TICKERS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "BRK-B", "TSLA", "LLY", "AVGO",
  "JPM", "V", "UNH", "WMT", "XOM", "MA", "ORCL", "COST", "PG", "JNJ",
  "HD", "NFLX", "BAC", "CRM", "MRK", "AMD", "KO", "PEP", "TMO", "CSCO",
  "WFC", "LIN", "DIS", "MCD", "ACN", "ADBE", "TXN", "GE", "IBM", "QCOM",
  "CAT", "INTU", "AMAT", "DHR", "SPGI", "LOW", "HON", "UPS", "BKNG", "MS",
];

function sourceForTicker(ticker) {
  return ticker.toUpperCase() === "MSFT" ? "preload" : "edgar";
}

function setTickerStatus(text, level = "") {
  const el = document.getElementById("ticker-status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "bb-ticker-status" + (level ? ` ${level}` : "");
}

function setUiBusy(busy) {
  document.querySelectorAll("#ticker-go, #ticker-search, #ticker-select, #ticker-input").forEach((el) => {
    if (el) el.disabled = busy;
  });
}

async function fetchWithTimeout(url, options = {}, ms = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        "Server slow to respond (Render may be waking up). Wait 30–60 seconds and try GO again.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function populateTickerSelect(selectEl, selected) {
  if (!selectEl) return;
  /* Keep static HTML options if JS list unavailable */
  if (!TOP_US_TICKERS.length && selectEl.options.length) return;
  selectEl.innerHTML = TOP_US_TICKERS.map(
    (t) => `<option value="${t}"${t === selected ? " selected" : ""}>${t}</option>`,
  ).join("");
}

async function fetchTickerList() {
  try {
    const res = await fetchWithTimeout("/api/tickers", {}, 15000);
    if (res.ok) {
      const data = await res.json();
      if (data.top_us?.length) TOP_US_TICKERS = data.top_us;
    }
  } catch (_) {
    /* use built-in list */
  }
}

async function lookupTicker(symbol) {
  const res = await fetchWithTimeout(`/api/ticker/${encodeURIComponent(symbol)}`, {}, 30000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Lookup failed");
  }
  return res.json();
}

async function pollRefreshUntilDone(symbol, maxWaitMs = 180000) {
  const started = Date.now();
  while Date.now() - started < maxWaitMs) {
    const res = await fetch(`/api/ticker/${encodeURIComponent(symbol)}/refresh/status`);
    const data = await res.json();
    if (data.status === "done") return data;
    if (data.status === "failed") throw new Error(data.error || "Live fetch failed");
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("Timed out waiting for SEC EDGAR (~3 min). Try again.");
}

async function startLiveFetch(symbol) {
  const res = await fetch(`/api/ticker/${encodeURIComponent(symbol)}/refresh`, {
    method: "POST",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || "Could not start fetch");
  if (data.status === "done") return data;
  return pollRefreshUntilDone(symbol);
}

/** Top-50 dropdown: load cache directly (no SEC lookup). */
async function loadFromDropdown(rawSymbol) {
  const sym = rawSymbol.trim().toUpperCase().replace(/\./g, "-");
  if (!sym) return;
  setUiBusy(true);
  setTickerStatus(`Loading ${sym}…`, "warn");
  try {
    await navigateTicker(sym);
    setTickerStatus(`${sym} ready.`, "ok");
  } catch (err) {
    setTickerStatus(err.message, "err");
  } finally {
    setUiBusy(false);
  }
}

/** Search box: validate SEC → cache or live fetch. */
async function resolveAndLoad(rawSymbol) {
  const sym = rawSymbol.trim().toUpperCase().replace(/\./g, "-");
  if (!sym) {
    setTickerStatus("Enter a ticker symbol.", "err");
    return;
  }

  setUiBusy(true);
  setTickerStatus(`Checking ${sym}…`, "warn");
  let info;
  try {
    info = await lookupTicker(sym);
  } catch (err) {
    setTickerStatus(err.message, "err");
    setUiBusy(false);
    return;
  }

  if (!info.exists) {
    setTickerStatus(info.message || `${sym} does not exist in SEC EDGAR.`, "err");
    setUiBusy(false);
    return;
  }

  if (info.cached) {
    setTickerStatus(`${sym} — loading cached data…`, "ok");
    try {
      await navigateTicker(sym);
      setTickerStatus(`${sym} loaded from cache.`, "ok");
    } catch (err) {
      setTickerStatus(err.message, "err");
    } finally {
      setUiBusy(false);
    }
    return;
  }

  setTickerStatus(
    `${sym} is valid · Fetching from SEC EDGAR (up to 20 years)… ~1–2 min`,
    "warn",
  );
  try {
    await startLiveFetch(sym);
    setTickerStatus(`${sym} — data ready, rendering…`, "ok");
    await navigateTicker(sym);
    setTickerStatus(`${sym} loaded · live SEC data saved to cache.`, "ok");
  } catch (err) {
    setTickerStatus(err.message, "err");
  } finally {
    setUiBusy(false);
  }
}

function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  let ticker = (p.get("ticker") || "MSFT").toUpperCase();
  let source = p.get("source");
  if (!source) {
    source = sourceForTicker(ticker);
  }
  return { ticker, source };
}

async function loadThesis(ticker, sourceOverride) {
  const sym = (ticker || getUrlParams().ticker).toUpperCase();
  const source = sourceOverride ?? getUrlParams().source ?? sourceForTicker(sym);
  const qs =
    source && source !== "preload" ? `?source=${encodeURIComponent(source)}` : "";
  const res = await fetchWithTimeout(`/api/thesis/${sym}${qs}`, {}, 120000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail || "Failed to load thesis data";
    if (res.status === 404) {
      throw new Error(
        `${detail} If this is a Top 50 name, redeploy may be missing cache files — push latest code to GitHub.`,
      );
    }
    throw new Error(detail);
  }
  return res.json();
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

function renderBarCell(value, scale, color, formatted, hasBar, blockName) {
  const valClass = valueTextClass(value, blockName);
  if (!hasBar || value === null || value === undefined) {
    return `<td class="bar-cell plain"><span class="bar-text ${valClass}">${formatted}</span></td>`;
  }
  const safeScale = scale && scale > 0 ? scale : 1;
  const width = Math.max(2, Math.min(100, (Math.abs(value) / safeScale) * 100));
  const neg = value < 0 ? " bar-negative" : "";
  return `
    <td class="bar-cell${neg}">
      <div class="bar-track">
        <div class="bar-fill" style="width:${width}%;background:${color}"></div>
        <span class="bar-text ${valClass}">${formatted}</span>
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
          return renderBarCell(v, scale, color, fmtCell(v, m.format), hasBar, block.name);
        })
        .join("");
      return `<tr><td class="metric-label ${labelClass}">${m.label}</td>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table class="magic-table mode-${barMode}">
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
      if (body) toggleCollapsible(btn, body);
    });
  });
}

function expandSection(sectionIndex) {
  const section = document.getElementById(`block-${sectionIndex}`);
  if (!section) return;
  const toggle = section.querySelector(".section-toggle");
  const body = section.querySelector(".section-body");
  if (toggle && body) {
    const expandChildren = Boolean(body.querySelector(".bs-groups"));
    openCollapsible(toggle, body, expandChildren);
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.getElementById("company-name").textContent = data.company || data.ticker;
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
  if (badge) badge.textContent = data.ticker || "—";
  if (fx) fx.textContent = data.market_bar?.fx_label || (data.currency === "USD" ? "US $" : data.currency);
  if (security) security.textContent = data.company || data.ticker;

  renderMarketBar(data.market_bar);
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

function renderNav(blocks) {
  const nav = document.getElementById("block-nav");
  const topBlocks = blocks.filter(
    (b) => !b.display?.parent_section && !b.name.includes("% of assets"),
  );

  nav.innerHTML = topBlocks
    .map((b, i) => {
      const short = b.name.replace(/^\d+\s*/, "").slice(0, 42);
      return `<a href="#block-${i}" data-section="${i}"><span class="nav-num">${i + 1}</span> ${short}</a>`;
    })
    .join("");

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      nav.querySelectorAll("a").forEach((a) => a.classList.remove("active"));
      link.classList.add("active");
      expandSection(Number(link.dataset.section));
    });
  });
}

function formatChartValue(format, v, decimals = 0) {
  if (v === null || v === undefined) return "—";
  if (format === "percent") return `${(v * 100).toFixed(2)}%`;
  if (format === "percent_points") return `${v.toFixed(2)}%`;
  if (format === "ratio") return Number(v).toFixed(2);
  return fmtThousands(v, decimals);
}

function yTick(format, v) {
  if (format === "percent") return `${(v * 100).toFixed(0)}%`;
  if (format === "percent_points") return `${v.toFixed(1)}%`;
  if (format === "ratio") return Number(v).toFixed(1);
  return fmtThousands(v, 0);
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
        color: BB.cyan,
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
    plugins: {
      legend: {
        display: chartDef.series.length > 1,
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

function normalizeChartSections(data) {
  if (data.chart_sections?.length) return data.chart_sections;
  if (data.charts?.length) {
    return [{ id: "legacy", title: "Graphs", charts: data.charts }];
  }
  return [];
}

function createChartInstance(canvas, chartDef, years) {
  if (chartDef.as_percent && !chartDef.format) {
    chartDef.format = "percent";
  }

  const defaultType = chartDef.type;
  const datasets = chartDef.series.map((s, i) => {
    const seriesType = s.type || defaultType;
    const isBar = seriesType === "bar";
    return {
      label: s.name,
      data: s.data,
      type: seriesType,
      yAxisID: s.y_axis || "y",
      backgroundColor: isBar ? CHART_SERIES[i % CHART_SERIES.length] : undefined,
      borderColor: CHART_SERIES[i % CHART_SERIES.length],
      borderWidth: isBar ? 1 : 1.5,
      tension: 0,
      fill: false,
      pointRadius: isBar ? 0 : 2,
      pointHoverRadius: 3,
      pointBackgroundColor: CHART_SERIES[i % CHART_SERIES.length],
      pointBorderColor: CHART_SERIES[i % CHART_SERIES.length],
      borderRadius: 0,
      barPercentage: chartDef.stacked ? 0.9 : 0.85,
      categoryPercentage: 0.9,
      stack: chartDef.stacked ? "stack" : undefined,
    };
  });

  charts[chartDef.id] = new Chart(canvas, {
    type: defaultType,
    data: { labels: years, datasets },
    options: buildChartOptions(chartDef, years),
  });
}

function ensureChartsInBody(bodyEl) {
  const years = chartYears;
  bodyEl.querySelectorAll("canvas[data-chart-id]").forEach((canvas) => {
    const chartId = canvas.dataset.chartId;
    if (charts[chartId]) {
      charts[chartId].resize();
      return;
    }
    const chartDef = chartDefsById[chartId];
    if (!chartDef) return;
    try {
      createChartInstance(canvas, chartDef, years);
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
}

async function init() {
  const selectEl = document.getElementById("ticker-select");
  const goBtn = document.getElementById("ticker-go");
  const searchBtn = document.getElementById("ticker-search");
  const inputEl = document.getElementById("ticker-input");

  tickClock();
  setInterval(tickClock, 1000);

  const { ticker: urlTicker } = getUrlParams();
  populateTickerSelect(selectEl, urlTicker);

  if (selectEl) {
    goBtn?.addEventListener("click", () => loadFromDropdown(selectEl.value));
    selectEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadFromDropdown(selectEl.value);
    });
  }

  searchBtn?.addEventListener("click", () => {
    const q = inputEl?.value?.trim();
    if (q) resolveAndLoad(q);
    else setTickerStatus("Type a ticker in SEARCH, then LOOKUP.", "err");
  });
  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && inputEl.value.trim()) resolveAndLoad(inputEl.value);
  });

  // Load thesis immediately — do not wait for /api/tickers (Render cold start).
  loadAndRender(urlTicker);

  fetchTickerList().then(() => {
    populateTickerSelect(selectEl, getUrlParams().ticker);
  });
}

async function navigateTicker(ticker) {
  const sym = ticker.toUpperCase().replace(/\./g, "-");
  const source = sourceForTicker(sym);
  const params = new URLSearchParams();
  if (sym !== "MSFT") params.set("ticker", sym);
  if (source !== "preload") params.set("source", source);
  const qs = params.toString();
  window.history.replaceState({}, "", qs ? `?${qs}` : "/");
  if (document.getElementById("ticker-select")) {
    document.getElementById("ticker-select").value = sym;
  }
  if (document.getElementById("ticker-input")) {
    document.getElementById("ticker-input").value = sym;
  }
  await loadAndRender(sym);
}

async function loadAndRender(ticker) {
  const nameEl = document.getElementById("company-name");
  const metaEl = document.getElementById("company-meta");
  const selectEl = document.getElementById("ticker-select");
  const sourceStatus = document.getElementById("bb-source-status");

  if (!nameEl) return;

  nameEl.textContent = "Loading…";
  if (metaEl) metaEl.textContent = "Fetching data…";
  setTickerStatus(`Loading ${ticker}…`, "warn");
  if (selectEl) selectEl.value = ticker.toUpperCase().replace(/\./g, "-");

  const slowTimer = setTimeout(() => {
    if (nameEl.textContent === "Loading…") {
      nameEl.textContent = "Connecting to server…";
      if (metaEl) metaEl.textContent = "Render may take 30–60s to wake up. Please wait.";
      setTickerStatus("Server waking up — please wait…", "warn");
    }
  }, 8000);

  try {
    const data = await loadThesis(ticker);
    clearTimeout(slowTimer);
    renderHeader(data);
    renderNav(data.blocks);
    renderCharts(data);
    renderBlocks(data.blocks, data.currency, data.units);
    expandSection(0);
    document.querySelector('#block-nav a[data-section="0"]')?.classList.add("active");
    const firstToggle = document.querySelector("#block-0 .section-toggle .chevron");
    if (firstToggle) firstToggle.textContent = "−";
    if (sourceStatus) {
      const src = data.source || sourceForTicker(ticker);
      const n = data.blocks?.[0]?.years?.length || 0;
      sourceStatus.textContent = `Source: ${src.toUpperCase()} · ${n} years cached`;
    }
    setTickerStatus(`${ticker} ready.`, "ok");
  } catch (err) {
    clearTimeout(slowTimer);
    console.error(err);
    nameEl.textContent = "Error loading data";
    if (metaEl) metaEl.textContent = err.message;
    const blocks = document.getElementById("blocks-container");
    if (blocks) {
      blocks.innerHTML = `<p class="error-banner">Could not load ${ticker}: ${err.message}</p>`;
    }
    if (sourceStatus) sourceStatus.textContent = "Source: unavailable";
    setTickerStatus(err.message, "err");
  }
}

try {
  init();
} catch (err) {
  console.error(err);
  const meta = document.getElementById("company-meta");
  if (meta) meta.textContent = "UI error: " + err.message + " — hard refresh (Ctrl+F5).";
}
