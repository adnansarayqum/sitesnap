// The "Additional Claim Items" reordering both mlaXlsm.js and tlbXlsm.js
// rely on to get a consistent ITEM number across DATA ENTRY, the Findings
// narrative, and the Scott Schedule's fixed-row-range subtotal split (see
// each file's own header comment for why this exists at all — it was the
// source of a real bug this fixed). Tested directly since a full round-trip
// through a real .xlsm template isn't something a unit test can fixture.
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { placeAdditionalItemsLast as mlaOrder, scottScheduleWrites as mlaScottSchedule, capForPrint as mlaCap, fillMlaTemplate } from "../src/export/mlaXlsm.js";
import { placeAdditionalItemsLast as tlbOrder, scottScheduleWrites as tlbScottSchedule, capForPrint as tlbCap, fillTlbTemplate } from "../src/export/tlbXlsm.js";

describe.each([["mlaXlsm", mlaOrder], ["tlbXlsm", tlbOrder]])("%s placeAdditionalItemsLast", (_, placeAdditionalItemsLast) => {
  it("leaves an order with no additional-items room untouched", () => {
    const items = [{ room: "Kitchen" }, { room: "Bathroom" }];
    expect(placeAdditionalItemsLast(items)).toEqual(items);
  });

  it("moves a room matching /additional/i to the end, keeping the rest in order", () => {
    const items = [{ room: "Additional Claim Items" }, { room: "Kitchen" }, { room: "Bathroom" }];
    expect(placeAdditionalItemsLast(items).map((it) => it.room)).toEqual(["Kitchen", "Bathroom", "Additional Claim Items"]);
  });

  it("is a no-op when the additional-items room is already last", () => {
    const items = [{ room: "Kitchen" }, { room: "Additional Claim Items" }];
    expect(placeAdditionalItemsLast(items).map((it) => it.room)).toEqual(["Kitchen", "Additional Claim Items"]);
  });

  it("handles a case with only an additional-items room (the edge case verified against the real TLB template)", () => {
    const items = [{ room: "Additional Claim Items" }];
    expect(placeAdditionalItemsLast(items).map((it) => it.room)).toEqual(["Additional Claim Items"]);
  });
});

// A real, two-stage bug caught by code review before this ever reached a
// real export. First version: a case with exactly as many rooms as the
// template's cap, and no "Additional Claim Items" room, silently lost its
// last room from the Scott Schedule entirely. First fix: made
// scottScheduleWrites fill the last block with that room regardless — but
// the Scott Schedule's "Additional Items" subtotal is a fixed CELL RANGE,
// not a text match, so whatever sits in that last block gets summed as
// "additional" whatever it's actually called; the fix silently
// re-labelled a real room's cost as an additional item instead of
// dropping it. The real fix has two parts: scottScheduleWrites goes back
// to only ever using the last block for a genuine additional-items room
// (or leaving it blank), and capForPrint enforces — before any of the
// three printed sheets are built — that a case with no additional-items
// room never has more than `blocks.length - 1` regular rooms handed to
// any of them, consistently, so DATA ENTRY, Findings and Scott Schedule
// always agree on which rooms made it into the report.
describe.each([["mlaXlsm", mlaScottSchedule, mlaCap, 8], ["tlbXlsm", tlbScottSchedule, tlbCap, 3]])("%s Scott Schedule capping", (_, scottScheduleWrites, capForPrint, cap) => {
  const rooms = ["Kitchen", "Bathroom", "Lounge", "Bedroom 1", "Bedroom 2", "Hallway", "Landing", "Loft"].slice(0, cap);
  const items = rooms.map((room, i) => ({ room, cost: (i + 1) * 100 }));

  it(`capForPrint drops the case to ${cap - 1} rooms when none is "Additional Claim Items"`, () => {
    expect(capForPrint(items, cap).length).toBe(cap - 1);
    expect(capForPrint(items, cap).map((it) => it.room)).toEqual(rooms.slice(0, cap - 1));
  });

  it("capForPrint keeps the full cap when the last room genuinely is additional", () => {
    const withAdditional = [...items.slice(0, cap - 1), { room: "Additional Claim Items", cost: 999 }];
    expect(capForPrint(withAdditional, cap).length).toBe(cap);
  });

  it("scottScheduleWrites never mislabels a regular room as additional: given the capped (cap-1) list, the last block stays blank, not filled", () => {
    const capped = capForPrint(items, cap); // cap-1 items, none additional
    const writes = scottScheduleWrites(capped);
    for (const room of rooms.slice(0, cap - 1)) {
      expect(writes.some((w) => typeof w.value === "string" && w.value.includes(room.toUpperCase()))).toBe(true);
    }
    // the room that didn't make the cap must not appear anywhere — not
    // regular, and critically not mislabelled into the additional block
    expect(writes.some((w) => typeof w.value === "string" && w.value.includes(rooms[cap - 1].toUpperCase()))).toBe(false);
  });

  it("scottScheduleWrites correctly places a genuine additional-items room in the last block", () => {
    const withAdditional = [...items.slice(0, cap - 1), { room: "Additional Claim Items", cost: 999 }];
    const writes = scottScheduleWrites(capForPrint(withAdditional, cap));
    expect(writes.some((w) => typeof w.value === "string" && w.value.includes("ADDITIONAL CLAIM ITEMS"))).toBe(true);
    for (const room of rooms.slice(0, cap - 1)) {
      expect(writes.some((w) => typeof w.value === "string" && w.value.includes(room.toUpperCase()))).toBe(true);
    }
  });
});

// Full round-trip against the real templates: the exact scenario the code
// review caught — a case with the full cap of regular rooms and no
// "Additional Claim Items" room — must truncate by exactly one room, and
// that room's issue text must not appear anywhere in the Scott Schedule
// sheet's raw XML (neither dropped silently nor mislabelled additional).
describe("fillMlaTemplate / fillTlbTemplate — full-cap, no additional-items room", () => {
  const SCOTT_SCHEDULE_XML = { mla: "xl/worksheets/sheet14.xml", tlb: "xl/worksheets/sheet14.xml" };

  it.each([
    ["mla", fillMlaTemplate, "public/templates/mla-template.xlsm", 8],
    ["tlb", fillTlbTemplate, "public/templates/tlb-template.xlsm", 3],
  ])("%s: truncates by exactly 1 and never writes the dropped room's marker into the Scott Schedule XML", async (agency, fill, templatePath, cap) => {
    const bytes = await readFile(path.join(process.cwd(), templatePath));
    const rooms = ["Kitchen", "Bathroom", "Lounge", "Bedroom 1", "Bedroom 2", "Hallway", "Landing", "Loft"].slice(0, cap);
    const items = rooms.map((room, i) => ({ room, issueOfConcern: `ISSUE-${i}`, siteFindings: `MARKER-${room.toUpperCase()}`, causation: "c", remedialWorks: "w", cost: (i + 1) * 10, breach: "S11 LTA" }));
    const { blob, truncated } = await fill(bytes, { meta: {}, items });
    expect(truncated).toBe(1);
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const xml = await zip.file(SCOTT_SCHEDULE_XML[agency]).async("string");
    // the last room (dropped from the capped, printed sheets) must not
    // appear anywhere in the Scott Schedule — dropped cleanly, not
    // mislabelled as an additional item
    expect(xml).not.toContain(`MARKER-${rooms[cap - 1].toUpperCase()}`);
    // every kept room must still be present
    for (const room of rooms.slice(0, cap - 1)) expect(xml).toContain(`MARKER-${room.toUpperCase()}`);
  });
});
