// One indicator from four sources: the phone's save, the firm register,
// background filing and the online flag — with a fixed order of precedence.
import { describe, expect, it } from "vitest";
import { deriveSyncStatus } from "../src/syncStatus.js";

const filing = (o = {}) => ({ provider: "ms", pending: 0, filed: 0, failed: 0, busy: false, lastError: null, ...o });

describe("deriveSyncStatus", () => {
  it("local mode, nothing happening: saved on this phone", () => {
    const s = deriveSyncStatus({ saveStatus: "saved", sync: null, filing: null, online: true });
    expect(s).toMatchObject({ state: "saved", label: "Saved", waiting: 0 });
    expect(s.detail).toMatch(/on this phone/);
  });
  it("a save in flight wins over everything", () => {
    expect(deriveSyncStatus({ saveStatus: "saving", online: false, filing: filing({ pending: 3 }) })).toMatchObject({ state: "syncing", label: "Saving…" });
  });
  it("offline counts the photos waiting to file", () => {
    expect(deriveSyncStatus({ saveStatus: "saved", online: false, filing: filing({ pending: 14 }) })).toMatchObject({ state: "offline", label: "Offline · 14 waiting", waiting: 14 });
    expect(deriveSyncStatus({ saveStatus: "saved", online: false })).toMatchObject({ state: "offline", label: "Offline" });
    // the register's own offline branch reads the same
    expect(deriveSyncStatus({ saveStatus: "saved", online: true, sync: { status: "offline" } }).state).toBe("offline");
  });
  it("filing or the register in progress is syncing", () => {
    expect(deriveSyncStatus({ saveStatus: "saved", filing: filing({ busy: true, pending: 2 }) })).toMatchObject({ state: "syncing", label: "Syncing…", detail: "Filing 2 photos to OneDrive…" });
    expect(deriveSyncStatus({ saveStatus: "saved", sync: { status: "syncing" } })).toMatchObject({ state: "syncing", detail: "Updating the firm register…" });
  });
  it("a permanently failed upload, or a register error, is a failure — and says the photos are safe", () => {
    const f = deriveSyncStatus({ saveStatus: "saved", filing: filing({ failed: 1, lastError: "401" }) });
    expect(f).toMatchObject({ state: "failed", label: "Sync failed" });
    expect(f.detail).toMatch(/safe on this phone/);
    expect(deriveSyncStatus({ saveStatus: "saved", sync: { status: "error", error: "boom" } }).detail).toMatch(/register not updated: boom/);
  });
  it("in the firm register: saved, with when", () => {
    const s = deriveSyncStatus({ saveStatus: "saved", sync: { status: "synced", at: 1 }, ago: () => "2 min ago" });
    expect(s).toMatchObject({ state: "saved", label: "Saved", detail: "Saved · in the firm register, updated 2 min ago" });
    expect(deriveSyncStatus({ saveStatus: "saved", sync: { status: "idle" } }).detail).toMatch(/not in the firm register yet/);
  });
  it("precedence: offline beats a stale failure; a failure beats synced", () => {
    expect(deriveSyncStatus({ saveStatus: "saved", online: false, filing: filing({ failed: 2 }) }).state).toBe("offline");
    expect(deriveSyncStatus({ saveStatus: "saved", sync: { status: "synced" }, filing: filing({ failed: 2 }) }).state).toBe("failed");
  });
});
