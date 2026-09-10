// The golden evaluation harness must keep loading every case and running
// end to end under the mock provider, and the deterministic control cases
// must pass — those exercise server code, not a model. Nothing here asserts
// anything about model reasoning; a mock run cannot.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.AI_MOCK = "1";
const { runSuite } = await import("../server/evals/run.mjs");
const { loadCases } = await import("../server/evals/lib/load.mjs");

describe("golden evaluation harness", () => {
  it("every case file loads and names only known rules", () => {
    const all = loadCases({ split: "all" });
    expect(all.length).toBeGreaterThanOrEqual(30);
    for (const c of all) expect(c.id).toMatch(/^GOLDEN-[ABCDHV]-\d{3}$/);
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("real-multimodal placeholders are never counted as run", () => {
    const real = loadCases({ split: "all", categories: ["real_multimodal"] });
    expect(real.length).toBeGreaterThan(0);
    for (const c of real) expect(c.status).toBe("REQUIRES_REAL_SURVEY_EVIDENCE");
  });

  it("runs every split under mock; deterministic controls all pass; the report says MOCK", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-"));
    const { summary, results, mdPath } = await runSuite({ split: "all", quiet: true, reportDir: dir });
    expect(summary.meta.mock).toBe(true);
    expect(summary.cases.pipelineErrors).toBe(0);
    expect(summary.deterministic.total).toBeGreaterThanOrEqual(10);
    expect(summary.deterministic.passed).toBe(summary.deterministic.total);
    expect(summary.cases.requiresRealEvidence).toBeGreaterThan(0);
    expect(fs.readFileSync(mdPath, "utf8")).toMatch(/MOCK RUN/);
    // the planted fabrication in V-003 is caught by the deterministic id check even with a mock verifier
    const v3 = results.find((r) => r.id === "GOLDEN-V-003");
    expect(v3.units[0].checks.every((k) => k.pass)).toBe(true);
    // …and the eligibility refusals are expected errors, not pipeline errors
    for (const id of ["GOLDEN-A-020", "GOLDEN-A-042", "GOLDEN-A-043"]) expect(results.find((r) => r.id === id).units[0].error.code).toBe("not_eligible");
  }, 120000);

  it("the known missing-photo gap is measured, not hidden (GOLDEN-A-019 fails by design until addressed)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-"));
    const { results } = await runSuite({ filter: ["GOLDEN-A-019"], quiet: true, reportDir: dir });
    const unit = results[0].units[0];
    expect(unit.missingPhotos.length).toBe(1);
    expect(unit.finding.gate.status).toBe("review_ready");
  }, 60000);
});
