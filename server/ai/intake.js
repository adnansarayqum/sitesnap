// The case-intake extraction pass: reads a letter of claim, letter of
// instruction, or agency instruction letter (photographed or a native PDF)
// and pulls out the fields Case Details already models, so the surveyor
// doesn't retype what a solicitor already sent them. Always a starting
// point the surveyor reviews and edits before saving — never written
// straight into the case.
import { MOCK, EFFORTS, structured, parseDataUrl, imageBlock, parsePdfDataUrl, documentBlock } from "./provider.js";
import { INTAKE } from "./prompts.js";
import { INTAKE_SCHEMA } from "./schemas.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY = {
  recognised: false, claimant: "", defendant: "", instructedBy: "", agency: "", reportType: "",
  landlordSurveyorName: "", dateOfInstruction: "", caseReference: "", address: "", postcode: "",
};

export async function extractIntake(documents, { signal } = {}) {
  if (MOCK) {
    return {
      output: { ...EMPTY, recognised: true, claimant: "[MOCK] Claimant Name", address: "[MOCK] 1 Example Street", postcode: "AB1 2CD" },
      model: "mock", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }
  const content = [{ type: "text", text: `${documents.length} document${documents.length === 1 ? "" : "s"} follow, all for the same case.` }];
  for (const d of documents) {
    if (d.kind === "pdf") { content.push(documentBlock(d.parsed)); continue; }
    content.push(imageBlock(d.parsed));
  }
  content.push({ type: "text", text: "Extract the case-intake fields described in your instructions." });
  const r = await structured({ label: "intake", system: [{ type: "text", text: INTAKE }], content, schema: INTAKE_SCHEMA, effort: EFFORTS.caption, maxTokens: 1500, signal });
  const o = r.output;
  const output = {
    recognised: !!o.recognised,
    claimant: o.claimant || "", defendant: o.defendant || "", instructedBy: o.instructed_by || "",
    agency: ["MLA", "TLB"].includes(o.agency) ? o.agency : "",
    reportType: ["Single Inspection", "Staggered Joint Inspection", "Joint Inspection", "Single Joint Inspection"].includes(o.report_type) ? o.report_type : "",
    landlordSurveyorName: o.landlord_surveyor_name || "",
    dateOfInstruction: ISO_DATE.test(o.date_of_instruction || "") ? o.date_of_instruction : "",
    caseReference: o.case_reference || "", address: o.address || "", postcode: o.postcode || "",
  };
  return { output, model: r.model, usage: r.usage };
}

// Validates and tags the phone's uploaded documents before they reach the
// model: which are readable images, which are PDFs, and the count actually
// usable — mirrors cleanPhotos' "stub for anything unreadable" approach in
// ai-routes.js, but there is no evidential record to preserve here, so an
// unreadable document is simply dropped rather than kept as a gap.
export function parseIntakeDocuments(list, maxDocs, maxBytes) {
  const sent = (Array.isArray(list) ? list : []).slice(0, maxDocs);
  const documents = [];
  for (const d of sent) {
    if (!d || typeof d.dataUrl !== "string" || d.dataUrl.length > maxBytes) continue;
    const img = parseDataUrl(d.dataUrl);
    if (img) { documents.push({ kind: "image", parsed: img }); continue; }
    const pdf = parsePdfDataUrl(d.dataUrl);
    if (pdf) { documents.push({ kind: "pdf", parsed: pdf }); continue; }
  }
  return documents;
}
