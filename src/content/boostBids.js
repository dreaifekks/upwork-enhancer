// Loads the boosted bids of job cards as they scroll into view. Requests go
// through the main-world bridge (boostBridge.js), are rate limited, and are
// cached for a few minutes so scrolling back does not ask again.
(function attachBoostBids(root) {
  const REQUEST_SOURCE = "uwe-boost-request";
  const RESPONSE_SOURCE = "uwe-boost-response";
  const DEFAULTS = {
    maxConcurrent: 2,
    maxPerWindow: 10,
    windowMs: 60000,
    successTtlMs: 10 * 60 * 1000,
    errorTtlMs: 2 * 60 * 1000,
    timeoutMs: 20000
  };

  // Lets Node exit in tests; browsers return plain numbers here.
  function unrefTimer(timer) {
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function jobRef(jobId) {
    const match = String(jobId || "").match(/^~0([12])(\d{6,})$/);
    return match ? { cipher: match[0], uid: match[2] } : null;
  }

  function createBoostLoader(options = {}) {
    const config = { ...DEFAULTS, ...options };
    const now = options.now || (() => Date.now());
    const post = options.post || ((message) => root.postMessage(message, root.location.origin));
    const onUpdate = options.onUpdate || (() => {});
    const isEnabled = options.isEnabled || (() => true);
    const isWanted = options.isWanted || (() => true);

    const cache = new Map();
    const pending = new Map();
    const queue = [];
    const startedAt = [];
    let active = 0;
    let sequence = 0;
    let drainTimer = null;

    function get(jobId) {
      const entry = cache.get(jobId);
      if (entry && entry.expiresAt > now()) return entry;
      if (pending.has(jobId) || queue.includes(jobId)) return { status: "loading" };
      return null;
    }

    function request(jobId, requestOptions = {}) {
      if (!isEnabled() || !jobRef(jobId)) return;
      const cached = cache.get(jobId);
      if (cached && cached.expiresAt > now()) return;
      if (pending.has(jobId)) return;
      const queuedAt = queue.indexOf(jobId);
      if (queuedAt >= 0) {
        if (!requestOptions.priority) return;
        queue.splice(queuedAt, 1);
      }
      if (requestOptions.priority) {
        queue.unshift(jobId);
      } else {
        queue.push(jobId);
      }
      onUpdate(jobId);
      drain();
    }

    function withinRateLimit() {
      const cutoff = now() - config.windowMs;
      while (startedAt.length && startedAt[0] <= cutoff) startedAt.shift();
      return startedAt.length < config.maxPerWindow;
    }

    function scheduleDrain() {
      if (drainTimer) return;
      const wait = startedAt.length
        ? Math.max(50, startedAt[0] + config.windowMs - now())
        : 50;
      drainTimer = setTimeout(() => {
        drainTimer = null;
        drain();
      }, wait);
      unrefTimer(drainTimer);
    }

    function drain() {
      while (queue.length && active < config.maxConcurrent) {
        if (!withinRateLimit()) {
          scheduleDrain();
          return;
        }
        const jobId = queue.shift();
        if (!isEnabled() || !isWanted(jobId)) {
          // Scrolled away before its turn; it is queued again when seen.
          onUpdate(jobId);
          continue;
        }
        start(jobId);
      }
    }

    function start(jobId) {
      const ref = jobRef(jobId);
      const id = `uwe-boost-${++sequence}`;
      active += 1;
      startedAt.push(now());
      const timer = setTimeout(() => {
        finish(id, { ok: false, error: "timed out" });
      }, config.timeoutMs);
      unrefTimer(timer);
      pending.set(jobId, { id, timer });
      post({ source: REQUEST_SOURCE, id, cipher: ref.cipher, uid: ref.uid });
    }

    function finish(id, result) {
      let jobId = "";
      pending.forEach((value, key) => {
        if (value.id === id) jobId = key;
      });
      if (!jobId) return;
      clearTimeout(pending.get(jobId).timer);
      pending.delete(jobId);
      active = Math.max(0, active - 1);
      cache.set(
        jobId,
        result.ok
          ? {
              status: "done",
              bids: Array.isArray(result.bids) ? result.bids : [],
              expiresAt: now() + config.successTtlMs
            }
          : {
              status: "error",
              error: String(result.error || ""),
              expiresAt: now() + config.errorTtlMs
            }
      );
      onUpdate(jobId);
      drain();
    }

    function handleMessage(event) {
      const data = event && event.data;
      if (!data || data.source !== RESPONSE_SOURCE) return;
      if (event.source && event.source !== root) return;
      finish(String(data.id || ""), data);
    }

    return { get, request, handleMessage, jobRef };
  }

  function formatBids(bids, limit = 4) {
    return (Array.isArray(bids) ? bids : [])
      .slice(0, limit)
      .map((bid) => String(Math.round(Number(bid.amount))))
      .join(" · ");
  }

  const api = { createBoostLoader, formatBids, jobRef };
  root.UpworkEnhancer = { ...(root.UpworkEnhancer || {}), boostBids: api };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
