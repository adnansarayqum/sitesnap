// Regression test for the updatePhoto race: two concurrent patches to the
// SAME photo id used to interleave their read-modify-write and silently
// drop one field (see src/storage.js's photoQueues comment). Proven broken
// 200/200 trials before the per-id queue was added; this locks in the fix.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { savePhoto, updatePhoto, loadPhoto } from "../src/storage.js";

describe("updatePhoto", () => {
  beforeEach(async () => {
    await savePhoto({ id: "p1", caption: "", filed: null });
  });

  it("never drops a concurrent patch to a different field on the same photo", async () => {
    // fired without awaiting either — this is exactly how a caption keystroke
    // and the background filing queue's "filed" update can land in the same
    // tick in the real app
    await Promise.all([
      updatePhoto("p1", { caption: "cracked tile" }),
      updatePhoto("p1", { filed: { provider: "ms", at: 123 } }),
    ]);
    const cur = await loadPhoto("p1");
    expect(cur.caption).toBe("cracked tile");
    expect(cur.filed).toEqual({ provider: "ms", at: 123 });
  });

  it("survives many concurrent patches without losing any field", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i);
    await Promise.all(ids.map((i) => updatePhoto("p1", { [`f${i}`]: i })));
    const cur = await loadPhoto("p1");
    for (const i of ids) expect(cur[`f${i}`]).toBe(i);
  });

  it("silently no-ops for a photo id that was never saved", async () => {
    await expect(updatePhoto("missing", { caption: "x" })).resolves.toBeUndefined();
    expect(await loadPhoto("missing")).toBeNull();
  });
});
