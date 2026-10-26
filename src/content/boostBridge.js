// Runs in the page's main world. It asks Upwork's own sign-in helper for the
// proposals app's request function and uses it to read the boosted bids shown
// on the apply page. The access token stays inside Upwork's helper; this
// script never reads or stores it.
(function attachBoostBridge(root) {
  if (root.__uweBoostBridge) return;
  root.__uweBoostBridge = true;

  const REQUEST_SOURCE = "uwe-boost-request";
  const RESPONSE_SOURCE = "uwe-boost-response";
  const CLIENT_ID_STORAGE_KEY = "uwe_proposals_client_id_v1";
  const CLIENT_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const AUTH_SCRIPT_BASE = "https://auth.upwork.com/api/v3/oauth2/token/subordinate/v3/";
  const GRAPHQL_URL = "/api/graphql/v1?alias=gql-query-bidsjobpostuid";
  const BIDS_QUERY =
    "query ($jobPostUid: ID!) { bidsJobPostUid(jobPostUid: $jobPostUid, filter: IN_THE_MONEY) { bids { id, amount, createdTime } } }";

  let clientIdPromise = null;
  let requestFnPromise = null;

  function readCachedClientId() {
    try {
      const cached = JSON.parse(root.localStorage.getItem(CLIENT_ID_STORAGE_KEY) || "null");
      if (cached && /^[a-f0-9]{32}$/.test(cached.id) && Date.now() - cached.at < CLIENT_ID_TTL_MS) {
        return cached.id;
      }
    } catch (_) {
      // Fall through to a fresh lookup.
    }
    return "";
  }

  function forgetClientId() {
    clientIdPromise = null;
    requestFnPromise = null;
    try {
      root.localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
    } catch (_) {
      // Ignore storage failures.
    }
  }

  // The proposals app publishes its public client id in its page config.
  async function proposalsClientId(cipher) {
    const cached = readCachedClientId();
    if (cached) return cached;
    if (!clientIdPromise) {
      clientIdPromise = (async () => {
        const response = await root.fetch(
          `/nx/proposals/job/${encodeURIComponent(cipher)}/apply/`,
          { credentials: "same-origin" }
        );
        const html = await response.text();
        const match = html.match(/subordinateClientId["']?\s*:\s*["']([a-f0-9]{32})["']/);
        if (!match) throw new Error("proposals client id not found");
        try {
          root.localStorage.setItem(
            CLIENT_ID_STORAGE_KEY,
            JSON.stringify({ id: match[1], at: Date.now() })
          );
        } catch (_) {
          // The id can still be used for this page.
        }
        return match[1];
      })();
      clientIdPromise.catch(() => {
        clientIdPromise = null;
      });
    }
    return clientIdPromise;
  }

  function registeredRequestFn(clientId) {
    const callbacks = root._authRequestCallbacks;
    return callbacks && typeof callbacks[clientId] === "function" ? callbacks[clientId] : null;
  }

  function loadAuthScript(clientId) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("sign-in helper failed to load"));
      };
      script.src = `${AUTH_SCRIPT_BASE}${clientId}?${Date.now()}`;
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function requestFn(cipher) {
    if (!requestFnPromise) {
      requestFnPromise = (async () => {
        if (typeof root._authTokenRegister !== "function") {
          throw new Error("Upwork sign-in helper is not available on this page");
        }
        const clientId = await proposalsClientId(cipher);
        const existing = registeredRequestFn(clientId);
        if (existing) return existing;
        await loadAuthScript(clientId);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const fn = registeredRequestFn(clientId);
          if (fn) return fn;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("sign-in helper did not register");
      })();
      requestFnPromise.catch(() => {
        requestFnPromise = null;
      });
    }
    return requestFnPromise;
  }

  async function fetchBids({ cipher, uid }, retry = true) {
    const send = await requestFn(cipher);
    const response = await send(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: BIDS_QUERY, variables: { jobPostUid: uid } })
    });
    const payload = await response.json().catch(() => null);
    const errors = payload && Array.isArray(payload.errors) ? payload.errors : [];
    const authFailed =
      response.status === 401 ||
      errors.some((error) => /auth|permission|scope/i.test(String(error && error.message)));
    if (authFailed && retry) {
      forgetClientId();
      return fetchBids({ cipher, uid }, false);
    }
    if (!response.ok || errors.length) {
      const message = errors[0] && errors[0].message;
      throw new Error(message || `HTTP ${response.status}`);
    }
    const list =
      (payload &&
        payload.data &&
        payload.data.bidsJobPostUid &&
        payload.data.bidsJobPostUid.bids) ||
      [];
    return list
      .map((bid) => ({
        amount: Number(bid && bid.amount),
        createdTime: String((bid && bid.createdTime) || "")
      }))
      .filter((bid) => Number.isFinite(bid.amount))
      .sort((a, b) => b.amount - a.amount);
  }

  root.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== root || !data || data.source !== REQUEST_SOURCE) return;
    const id = String(data.id || "");
    const cipher = String(data.cipher || "");
    const uid = String(data.uid || "");
    if (!id || !/^~0[12]\d+$/.test(cipher) || !/^\d+$/.test(uid)) return;
    fetchBids({ cipher, uid })
      .then((bids) => {
        root.postMessage({ source: RESPONSE_SOURCE, id, ok: true, bids }, root.location.origin);
      })
      .catch((error) => {
        root.postMessage(
          {
            source: RESPONSE_SOURCE,
            id,
            ok: false,
            error: String((error && error.message) || error).slice(0, 200)
          },
          root.location.origin
        );
      });
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
