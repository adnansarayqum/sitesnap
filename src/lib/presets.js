// The surveyor's own SOURCE list from his report workbook — folder names must
// match these exactly or his macro can't line the photos up with the findings.
// Numbered variants (Bedroom 1-4, Bathroom 1-3) come from the +/- stepper, so
// they aren't listed separately.
export const PRESET_GROUPS = [
  {
    group: "Rooms",
    items: [
      { base: "Kitchen" }, { base: "Living Room" }, { base: "Dining Room" },
      { base: "Bedroom", steppable: true }, { base: "Bedrooms" },
      { base: "Bathroom", steppable: true }, { base: "Bathroom (Upstairs)" },
      { base: "Upstairs Bathroom" }, { base: "Downstairs Bathroom" },
      { base: "Wet Room" }, { base: "Toilet" }, { base: "Downstairs Toilet" },
      { base: "Separate WC" }, { base: "WC" }, { base: "Utility Room" },
      { base: "Hallway" }, { base: "Upstairs Hallway" }, { base: "Hallway and Landing" },
      { base: "Landing" }, { base: "Landing/Stairs" },
      { base: "Attic" }, { base: "Balcony" },
    ],
  },
  {
    group: "Services",
    items: [
      { base: "Boiler" }, { base: "Boiler/Heating" }, { base: "Heating" },
      { base: "Electrics" }, { base: "Windows" },
      { base: "Doors & Windows (Throughout)" },
      { base: "Front Door" }, { base: "Back Door" },
    ],
  },
  {
    group: "Outside",
    items: [
      { base: "External" }, { base: "Exterior" }, { base: "External Areas" },
      { base: "External Walls & Drains" }, { base: "Garden" },
      { base: "Other (Exterior)" },
    ],
  },
  {
    group: "Whole property & other",
    items: [
      { base: "Property" }, { base: "Whole Property" }, { base: "Throughout Property" },
      { base: "Infestation" }, { base: "Additional Claim Item", steppable: true },
      { base: "Other" },
    ],
  },
];

export const PRESETS = PRESET_GROUPS.flatMap((g) => g.items);

export const CONDITIONS = ["Good", "Fair", "Poor"];
