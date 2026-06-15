/**
 * Session analytics tracker — remove this script + temp_analytics/ to disable.
 */
(function () {
  const VISITOR_KEY = "thesis_visitor_id";
  const SESSION_KEY = "thesis_session_id";
  const HEARTBEAT_MS = 60_000;

  const SECTION_LABELS = {
    "one-pager": "One-Pager",
    fundamentals: "Fundamentals",
    valuation: "DCF · Method 1",
    "valuation-dcf-draft": "DCF · Draft",
    "valuation-multiples": "Multiples · P/E & P/BV",
    "valuation-consensus": "Analyst consensus",
  };

  function visitorId() {
    let vid = localStorage.getItem(VISITOR_KEY);
    if (!vid) {
      vid = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, vid);
    }
    return vid;
  }

  function sessionId() {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function currentTicker() {
    const p = new URLSearchParams(window.location.search);
    return (p.get("ticker") || "MSFT").toUpperCase();
  }

  function sectionLabelFromHash(hash) {
    const h = (hash || "#one-pager").replace("#", "").toLowerCase();
    if (h.startsWith("block-")) return "Fundamentals · Block " + h.replace("block-", "");
    if (h.startsWith("chart-")) return "Fundamentals · Chart " + h.replace("chart-", "");
    return SECTION_LABELS[h] || h || "One-Pager";
  }

  function utmParams() {
    const p = new URLSearchParams(window.location.search);
    return {
      utm_source: p.get("utm_source") || "",
      utm_medium: p.get("utm_medium") || "",
      utm_campaign: p.get("utm_campaign") || "",
    };
  }

  function send(event, extra) {
    const hash = window.location.hash || "#one-pager";
    const body = {
      session_id: sessionId(),
      visitor_id: visitorId(),
      event,
      ts: Date.now(),
      hash,
      section_label: sectionLabelFromHash(hash),
      ticker: currentTicker(),
      path: window.location.pathname + window.location.search,
      referrer: document.referrer || "",
      lang: navigator.language || "",
      screen: window.screen.width + "x" + window.screen.height,
      viewport: window.innerWidth + "x" + window.innerHeight,
      ...utmParams(),
      ...(extra || {}),
    };
    fetch("/api/temp-analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(function () {});
  }

  send("session_start");
  setInterval(function () {
    send("heartbeat");
  }, HEARTBEAT_MS);

  window.addEventListener("pagehide", function () {
    send("session_end");
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") send("session_end");
  });

  let lastHash = window.location.hash;
  let lastTicker = currentTicker();
  setInterval(function () {
    const hash = window.location.hash || "#one-pager";
    const ticker = currentTicker();
    if (hash !== lastHash) {
      lastHash = hash;
      send("section", { hash, section_label: sectionLabelFromHash(hash) });
    }
    if (ticker !== lastTicker) {
      lastTicker = ticker;
      send("ticker", { ticker });
    }
  }, 800);
})();
