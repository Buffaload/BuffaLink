// Common collections
const commonGroups = {
  avonmouth: ["Avonmouth DVS Units", "Avonmouth Non-DVS"],
  trailers: [
    "42 Pallet Deckers",
    "Baymasters",
    "Big Door 44s",
    "Small Door 44s",
  ],
};

export const depotVisibilityRules = {
  ellington: [
    "Ellington DVS Units",
    "Ellington Non-DVS",
    ...commonGroups.trailers,
    ...commonGroups.avonmouth,
  ], // Units visibile to Ellington depot account
  crewe: [
    "CRSK DVS Units",
    "CRSK Non-DVS",
    ...commonGroups.trailers,
    ...commonGroups.avonmouth,
  ], // Units visibile to Crewe depot account
};
