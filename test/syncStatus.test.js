// One indicator from three sources: the phone's save, background filing
// and the online flag — with a fixed order of precedence.
import { describe, expect, it } from "vitest";
import { deriveSyncStatus } from "../src/syncStatus.js";

const filing = (o = {}) => ({ provider: "ms", pending: 0, filed: 0, failed: 0, busy: false, lastError: null, ...o });

describe("deriveSyncStatus", () => {
  it("nothing happening: saved on this phone", () => {
    const s = deriveSyncStatus({ saveStatus: "saved", filing: null, online: true });
    expect(s).toMatchObject({ state: "saved", label: "Saved", waiting: 0 });
    expect(s.detail).toMatch(/on this phone/);
  });
  it("a save in flight wins over everything", () => {
    expect(deriveSyncStatus({ saveStatus: "saving", online: false, filing: filing({ pending: 3 }) })).toMatchObject({ state: "syncing", label: "Saving…" });
  });
  it("offline counts the photos waiting to file", () => {
    expect(deriveSyncStatus({ saveStatus: "saved", online: false, filing: filing({ pending: 14 }) })).toMatchObject({ state: "offline", label: "Offline · 14 waiting", waiting: 14 });
    expect(deriveSyncStatus({ saveStatus: "saved", online: false })).toMatchObject({ state: "offline", label: "Offline" });
  });
  it("filing in progress is syncing", () => {
    expect(deriveSyncStatus({ saveStatus: "saved", filing: filing({ busy: true, pending: 2 }) })).toMatchObject({ state: "syncing", label: "Syncing…", detail: "Filing 2 photos to OneDrive…" });
    expect(deriveSyncStatus({ saveStatus: "saved", filing: filing({ busy: true }) })).toMatchObject({ state: "syncing", detail: "Syncing…" });
  });
  it("a permanently failed upload is a failure — and says the photos are safe", () => {
    const f = deriveSyncStatus({ saveStatus: "saved", filing: filing({ failed: 1, lastError: "401" }) });
    expect(f).toMatchObject({ state: "failed", label: "Sync failed" });
    expect(f.detail).toMatch(/safe on this phone/);
  });
  it("precedence: offline beats a stale failure", () => {
    expect(deriveSyncStatus({ saveStatus: "saved", online: false, filing: filing({ failed: 2 }) }).state).toBe("offline");
  });
});
