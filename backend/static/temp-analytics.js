/**
 * TEMP ANALYTICS — disposable tracker. Remove this script + temp_analytics/ to disable.
 */
(function () {
  const SID_KEY = "thesis_temp_sid";
  const HEARTBEAT_MS = 60_000;

  function sessionId() {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  }

  function currentTicker() {
    const p = new URLSearchParams(window.location.search);
    return (p.get("ticker") || "MSFT").toUpperCase();
  }

  function send(event, extra) {
    const body = {
      session_id: sessionId(),
      event,
      ts: Date.now(),
      hash: window.location.hash || "#one-pager",
      ticker: currentTicker(),
      path: window.location.pathname + window.location.search,
      referrer: document.referrer || "",
      lang: navigator.language || "",
      screen: `${window.screen.width}x${window.screen.height}`,
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
      send("section", { hash });
    }
    if (ticker !== lastTicker) {
      lastTicker = ticker;
      send("ticker", { ticker });
    }
  }, 800);
})();
