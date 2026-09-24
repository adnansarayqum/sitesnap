// An expired access-key unlock and a dead OneDrive link both come back as
// 401 from /api/cloud/token. Only the second may discard the phone's sealed
// link — otherwise every 30-day unlock expiry silently disconnects OneDrive.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {};
vi.mock("../src/storage.js", () => ({
  loadCloudLink: async (p) => store[p] || null,
  saveCloudLink: async (p, v) => { store[p] = v; },
  clearCloudLink: async (p) => { delete store[p]; },
}));

const { serviceToken, beginLink } = await import("../src/cloud/service.js");
const { aiConfig } = await import("../src/ai.js");

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  store.onedrive = { blob: "sealed", account: "shah@example.com" };
});

describe("cloud link vs the access-key gate", () => {
  it("keeps the OneDrive link when the unlock has expired", async () => {
    globalThis.fetch = vi.fn(async () => reply(401, { error: "access_required" }));
    await expect(serviceToken("onedrive")).rejects.toThrow(/unlocking again/);
    expect(store.onedrive).toEqual({ blob: "sealed", account: "shah@example.com" });
  });

  it("keeps the OneDrive link when the server has no access key configured", async () => {
    globalThis.fetch = vi.fn(async () => reply(503, { error: "access_not_configured" }));
    await expect(serviceToken("onedrive")).rejects.toThrow(/SITESNAP_ACCESS_KEY/);
    expect(store.onedrive).toBeTruthy();
  });

  it("still discards a link Microsoft has actually revoked", async () => {
    globalThis.fetch = vi.fn(async () => reply(401, { error: "reconnect" }));
    await expect(serviceToken("onedrive")).rejects.toThrow(/needs connecting again/);
    expect(store.onedrive).toBeUndefined();
  });

  it("Connect explains a locked server instead of blaming OneDrive setup", async () => {
    globalThis.fetch = vi.fn(async () => reply(503, { error: "access_not_configured" }));
    await expect(beginLink("onedrive", null)).rejects.toThrow(/SITESNAP_ACCESS_KEY/);
    globalThis.fetch = vi.fn(async () => reply(404, { error: "provider not configured" }));
    await expect(beginLink("onedrive", null)).rejects.toThrow(/isn't set up for OneDrive/);
  });

  it("AI config records that drafting is locked, not missing a key", async () => {
    globalThis.fetch = vi.fn(async () => reply(503, { error: "access_not_configured" }));
    const cfg = await aiConfig(true);
    expect(cfg.enabled).toBe(false);
    expect(cfg.locked).toBe("access_not_configured");
  });
});
