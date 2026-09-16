// parseIntakeDocuments (server/ai/intake.js) is the gate between whatever a
// phone sends and what reaches the model: it must accept a real image or
// PDF data URL, drop anything else quietly (an unreadable document is not
// evidence to preserve, unlike a photo — see the file's own comment), cap
// the count, and cap each document's size.
import { describe, expect, it } from "vitest";
import { parseIntakeDocuments } from "../server/ai/intake.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PDF = "data:application/pdf;base64,JVBERi0xLjQK"; // not a real PDF body, but a well-formed data URL

describe("parseIntakeDocuments", () => {
  it("recognises an image data URL as kind image", () => {
    const out = parseIntakeDocuments([{ dataUrl: PNG }], 8, 1024 * 1024);
    expect(out).toEqual([{ kind: "image", parsed: { media_type: "image/png", data: expect.any(String) } }]);
  });

  it("recognises a PDF data URL as kind pdf", () => {
    const out = parseIntakeDocuments([{ dataUrl: PDF }], 8, 1024 * 1024);
    expect(out).toEqual([{ kind: "pdf", parsed: { media_type: "application/pdf", data: expect.any(String) } }]);
  });

  it("drops anything that isn't a recognised image/PDF data URL", () => {
    expect(parseIntakeDocuments([{ dataUrl: "data:text/plain;base64,aGk=" }], 8, 1024 * 1024)).toEqual([]);
    expect(parseIntakeDocuments([{ dataUrl: "not a data url" }], 8, 1024 * 1024)).toEqual([]);
    expect(parseIntakeDocuments([null, {}, { dataUrl: 42 }], 8, 1024 * 1024)).toEqual([]);
    expect(parseIntakeDocuments(null, 8, 1024 * 1024)).toEqual([]);
  });

  it("drops a document over the byte cap, keeping the rest", () => {
    const huge = { dataUrl: PNG + "A".repeat(2000) };
    const out = parseIntakeDocuments([huge, { dataUrl: PNG }], 8, PNG.length);
    expect(out).toEqual([{ kind: "image", parsed: { media_type: "image/png", data: expect.any(String) } }]);
  });

  it("caps the number of documents", () => {
    const out = parseIntakeDocuments(Array(20).fill({ dataUrl: PNG }), 3, 1024 * 1024);
    expect(out.length).toBe(3);
  });
});
