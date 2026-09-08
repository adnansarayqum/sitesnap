// Regression test for the production "AI captions not generating" bug: the
// Anthropic SDK's APIConnectionError (a dropped connection, exhausted after
// the SDK's own internal retries) carries no HTTP status by design, so it
// used to reach the client as an unhelpful, generic 500. withConnectionRetry
// gives it one more attempt from a fresh connection and, only if that also
// fails, turns it into a clear, retryable 503 — never masking any other
// kind of error.
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { withConnectionRetry } from "../server/ai.js";

describe("withConnectionRetry", () => {
  it("returns the result on the first try when there's no error", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withConnectionRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once after a connection error and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: "conn reset" }))
      .mockResolvedValueOnce("recovered");
    await expect(withConnectionRetry(fn)).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("turns a connection error into a clear 503 when the retry also fails", async () => {
    const fn = vi.fn().mockRejectedValue(new Anthropic.APIConnectionError({ message: "conn reset" }));
    await expect(withConnectionRetry(fn)).rejects.toMatchObject({
      status: 503,
      code: "ai_unreachable",
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never retries or masks a real API error (e.g. a 400)", async () => {
    const headers = new Headers();
    const badRequest = new Anthropic.BadRequestError(400, { error: { type: "invalid_request_error" } }, "bad request", headers);
    const fn = vi.fn().mockRejectedValue(badRequest);
    await expect(withConnectionRetry(fn)).rejects.toBe(badRequest);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never retries an interrupted-connection abort, and gives it a clear status instead of the generic 500 fallback", async () => {
    // Same root problem as the connection-error case above: no HTTP status
    // by design (there was no response to have one), which used to reach
    // the client as "Something went wrong on the server." — indistinguishable
    // from a genuine bug — instead of something that says what happened
    // (the phone's connection dropped mid-request) and invites a retry.
    const abort = new Anthropic.APIUserAbortError({ message: "aborted by caller" });
    const fn = vi.fn().mockRejectedValue(abort);
    await expect(withConnectionRetry(fn)).rejects.toMatchObject({
      status: 499,
      code: "ai_interrupted",
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
