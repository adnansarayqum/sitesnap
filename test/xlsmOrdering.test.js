// The "Additional Claim Items" reordering both mlaXlsm.js and tlbXlsm.js
// rely on to get a consistent ITEM number across DATA ENTRY, the Findings
// narrative, and the Scott Schedule's fixed-row-range subtotal split (see
// each file's own header comment for why this exists at all — it was the
// source of a real bug this fixed). Tested directly since a full round-trip
// through a real .xlsm template isn't something a unit test can fixture.
import { describe, expect, it } from "vitest";
import { placeAdditionalItemsLast as mlaOrder } from "../src/export/mlaXlsm.js";
import { placeAdditionalItemsLast as tlbOrder } from "../src/export/tlbXlsm.js";

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
