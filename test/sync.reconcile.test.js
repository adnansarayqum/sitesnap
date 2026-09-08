// Regression test for the reliability-pass fix: reconcile() used to push a
// second, independently-read copy of a case whose debounced push was
// already queued or in flight — whichever finished last would silently win,
// possibly overwriting the fresher edit with a staler snapshot it happened
// to read first. It must skip any case already being handled by the
// debounced path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSyncEnabled, pushCaseNow, reconcile } from "../src/sync.js";

function fetchOkOnce() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ case_no: null, missingThumbs: [] }),
  };
}

describe("sync.reconcile", () => {
  beforeEach(() => {
    setSyncEnabled(true);
    global.fetch = vi.fn().mockResolvedValue(fetchOkOnce());
  });
  afterEach(() => {
    setSyncEnabled(false);
    vi.restoreAllMocks();
  });

  it("does not push a case whose debounced push is already in flight", async () => {
    const inspection = { id: "case1", address: "1 Test St" };
    // starts a push and, because run() has no internal await before calling
    // push(), synchronously marks case1 as in flight before we call reconcile
    const inFlight = pushCaseNow(inspection, [], {});

    const localIndex = [{ id: "case1", updatedAt: Date.now() }];
    const pushed = await reconcile(localIndex, [], async () => ({ inspection, rooms: [] }));

    expect(pushed).toBe(0);
    await inFlight;
    // exactly the one call from pushCaseNow — reconcile added no second PUT
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("pushes a local case the register doesn't have yet", async () => {
    const inspection = { id: "case2", address: "2 Test St" };
    const localIndex = [{ id: "case2", updatedAt: Date.now() }];
    const pushed = await reconcile(localIndex, [], async () => ({ inspection, rooms: [] }));
    expect(pushed).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("skips a local case the register already has a current copy of", async () => {
    const now = Date.now();
    const localIndex = [{ id: "case3", updatedAt: now }];
    const register = [{ id: "case3", updated_at: new Date(now).toISOString() }];
    const pushed = await reconcile(localIndex, register, async () => ({ inspection: { id: "case3" }, rooms: [] }));
    expect(pushed).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
