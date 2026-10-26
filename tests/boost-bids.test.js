const test = require("node:test");
const assert = require("node:assert/strict");

const boost = require("../src/content/boostBids.js");

function harness(overrides = {}) {
  const posted = [];
  const updates = [];
  let clock = 1000;
  const loader = boost.createBoostLoader({
    post: (message) => posted.push(message),
    onUpdate: (jobId) => updates.push(jobId),
    now: () => clock,
    ...overrides
  });
  const reply = (message, data) =>
    loader.handleMessage({ data: { source: "uwe-boost-response", id: message.id, ...data } });
  return {
    loader,
    posted,
    updates,
    reply,
    advance(ms) {
      clock += ms;
    }
  };
}

test("job ids map to the numeric uid the bids query expects", () => {
  assert.deepEqual(boost.jobRef("~022114757342884991284"), {
    cipher: "~022114757342884991284",
    uid: "2114757342884991284"
  });
  assert.deepEqual(boost.jobRef("~01abcdef"), null);
  assert.equal(boost.jobRef("Some-Job-Title"), null);
});

test("bids are formatted as the top four amounts", () => {
  assert.equal(
    boost.formatBids([{ amount: 135 }, { amount: 120 }, { amount: 97 }, { amount: 90 }, { amount: 80 }]),
    "135 · 120 · 97 · 90"
  );
  assert.equal(boost.formatBids([]), "");
});

test("requests run two at a time and results are cached", () => {
  const h = harness();
  ["~021111111", "~022222222", "~023333333"].forEach((id) => h.loader.request(id));
  assert.equal(h.posted.length, 2);
  assert.equal(h.loader.get("~023333333").status, "loading");

  h.reply(h.posted[0], { ok: true, bids: [{ amount: 50 }] });
  assert.equal(h.posted.length, 3, "a finished request frees a slot");
  assert.deepEqual(h.loader.get("~021111111").bids, [{ amount: 50 }]);
  assert.equal(h.posted[0].uid, "1111111");

  h.loader.request("~021111111");
  assert.equal(h.posted.length, 3, "cached jobs are not requested again");

  h.reply(h.posted[1], { ok: true, bids: [] });
  h.reply(h.posted[2], { ok: true, bids: [] });
  h.advance(11 * 60 * 1000);
  h.loader.request("~021111111");
  assert.equal(h.posted.length, 4, "expired cache entries are refreshed");
});

test("no more than ten requests start per minute", () => {
  const h = harness({ maxConcurrent: 20 });
  for (let i = 0; i < 12; i += 1) {
    h.loader.request(`~0210000000${String(i).padStart(2, "0")}`);
  }
  assert.equal(h.posted.length, 10);
});

test("jobs scrolled out of view are skipped until seen again", () => {
  const wanted = new Set(["~021111111"]);
  const h = harness({ maxConcurrent: 1, isWanted: (id) => wanted.has(id) });
  h.loader.request("~021111111");
  h.loader.request("~022222222");
  h.reply(h.posted[0], { ok: false, error: "boom" });
  assert.equal(h.posted.length, 1);
  assert.equal(h.loader.get("~022222222"), null);
  assert.equal(h.loader.get("~021111111").status, "error");
});

test("disabled loader sends nothing", () => {
  const h = harness({ isEnabled: () => false });
  h.loader.request("~021111111");
  assert.equal(h.posted.length, 0);
});

test("a priority request jumps ahead of queued cards", () => {
  const h = harness({ maxConcurrent: 1 });
  h.loader.request("~021111111");
  h.loader.request("~022222222");
  h.loader.request("~023333333", { priority: true });
  h.reply(h.posted[0], { ok: true, bids: [] });
  assert.equal(h.posted[1].uid, "3333333");
});
