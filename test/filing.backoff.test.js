// Regression test for the reliability-pass fix: a failed upload used to be
// pushed to the back of the queue and the whole worker loop would then
// `await sleep(4000 * n)` before touching anything else — so one flaky
// photo blocked every other photo behind it for seconds at a time. Failed
// photos now get their own backoff timestamp and the loop picks the next
// *ready* photo instead of blocking on the one that just failed.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { uploadToOneDrive } = vi.hoisted(() => ({ uploadToOneDrive: vi.fn() }));
vi.mock("../src/cloud/lazy.js", () => ({
  loadMsGraph: async () => ({ uploadToOneDrive }),
  loadGoogleDrive: async () => ({ uploadToGoogleDrive: vi.fn() }),
}));

import { configureFiling, enqueueFiling, clearFilingQueue, filingState } from "../src/filing.js";

describe("filing queue backoff", () => {
  beforeEach(() => {
    clearFilingQueue();
    uploadToOneDrive.mockReset();
  });
  afterEach(() => {
    clearFilingQueue();
  });

  it("files a healthy photo without waiting behind a failing one's backoff", async () => {
    uploadToOneDrive.mockImplementation(async (_clientId, segments) => {
      if (segments[segments.length - 1] === "bad.jpg") throw new Error("network blip");
      return {};
    });

    const room = { id: "r1", name: "Kitchen", photoIds: ["bad", "good"] };
    const inspection = { id: "case1", address: "1 Test St" };
    const fileFor = async (_room, id) => new File(["x"], `${id}.jpg`);
    configureFiling({
      provider: "ms",
      context: () => ({ inspection, rooms: [room], photoCache: { bad: {}, good: {} }, fileFor }),
      filed: () => {},
    });

    enqueueFiling(["bad", "good"], 0);

    // "bad" fails and is backed off ~4s; "good" is queued right behind it
    // and, with the fix, gets tried in the same pass rather than waiting
    // out "bad"'s backoff first
    await vi.waitFor(() => expect(filingState().filed).toBe(1), { timeout: 2000, interval: 10 });

    // "bad" hasn't been given up on (3 attempts) yet — it's mid-backoff,
    // still counted as pending, not failed
    expect(filingState().failed).toBe(0);
    expect(filingState().pending).toBe(1);
  });
});
