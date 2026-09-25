// A live real-provider run showed Sonnet-as-verifier lets real findings
// escape every control (server/ai/provider.js). This guard must fail fast
// on import if that config reaches production by accident, not just read
// as a comment nobody sees at deploy time.
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

function tryImportProvider(env) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, ["--input-type=module", "-e", "import('./server/ai/provider.js')"], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (c) => { output += c; });
    child.stderr.on("data", (c) => { output += c; });
    child.on("exit", (code) => resolve({ code, output }));
  });
}

describe("AI_VERIFY_MODEL production guard", () => {
  it("refuses to start when the verifier is overridden away from the generator model in production", async () => {
    const { code, output } = await tryImportProvider({ NODE_ENV: "production", AI_MODEL: "claude-fable-5-1", AI_VERIFY_MODEL: "claude-sonnet-5" });
    expect(code).not.toBe(0);
    expect(output).toMatch(/AI_VERIFY_MODEL=claude-sonnet-5 overrides the generator model/);
  });

  it("starts with the escape hatch set, for a deliberate re-tested deployment", async () => {
    const { code, output } = await tryImportProvider({ NODE_ENV: "production", AI_MODEL: "claude-fable-5-1", AI_VERIFY_MODEL: "claude-sonnet-5", AI_VERIFY_MODEL_ALLOW_OVERRIDE: "1" });
    expect(code).toBe(0);
    expect(output).not.toMatch(/overrides the generator model/);
  });

  it("starts when the verifier isn't overridden, or matches the generator", async () => {
    const unset = await tryImportProvider({ NODE_ENV: "production", AI_MODEL: "claude-fable-5-1" });
    expect(unset.code).toBe(0);
    const matching = await tryImportProvider({ NODE_ENV: "production", AI_MODEL: "claude-fable-5-1", AI_VERIFY_MODEL: "claude-fable-5-1" });
    expect(matching.code).toBe(0);
  });

  it("does not guard outside production, so local/dev experimentation stays free", async () => {
    const { code } = await tryImportProvider({ AI_MODEL: "claude-fable-5-1", AI_VERIFY_MODEL: "claude-sonnet-5" });
    expect(code).toBe(0);
  });
});
