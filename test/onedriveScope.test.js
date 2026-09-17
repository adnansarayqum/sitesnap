// Regression guard: the OneDrive OAuth scope was narrowed from the bare
// Files.ReadWrite (the whole drive) to Files.ReadWrite.AppFolder (just this
// app's own isolated folder) after a liability concern surfaced during
// testing — the consent screen's "have full access to your files" line was
// a real problem given what SiteSnap stores through it (tenant names,
// addresses, disrepair evidence). Confined to the app's own folder, a
// compromised app can't reach anything else in the drive.
//
// server/index.js can't be imported directly — it calls app.listen() at
// module load, which would try to bind a real port from inside a unit test —
// so this reads the source text and checks the onedrive provider's own
// block specifically, not the whole file (a bare "Files.ReadWrite" mention
// elsewhere, e.g. in a comment about what was changed, must not pass this).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "../server/index.js"), "utf8");

describe("OneDrive OAuth scope", () => {
  it("is confined to the app's own AppFolder, not the whole drive", () => {
    const m = /onedrive:\s*\{[\s\S]*?\n  \},/.exec(src);
    expect(m, "couldn't find the onedrive provider block in server/index.js — PROVIDERS shape may have changed").toBeTruthy();
    const block = m[0];
    const scopeMatch = /scope:\s*"([^"]+)"/.exec(block);
    expect(scopeMatch, "no scope: \"...\" line found in the onedrive block").toBeTruthy();
    const scope = scopeMatch[1];
    expect(scope).toContain("Files.ReadWrite.AppFolder");
    // a bare Files.ReadWrite (not followed by .AppFolder) would grant the
    // whole drive — the exact regression this test exists to catch
    expect(scope).not.toMatch(/Files\.ReadWrite(?!\.AppFolder)\b/);
  });
});
