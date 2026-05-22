// src/utils/depotMatching.ts
export type DepotMatchableVehicle = {
    locationName?: string | null;
    locationGroupName?: string | null;
};

// Depot definitions: - "strict": only allow known-safe strings (prevents nearby false positives) - "alias": allow controlled variations
const normalizeDepotText = (value: string | null | undefined) =>
    (value ?? "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();

export const DEPOT_DEFINITIONS: Record<
    string,
    { mode: "strict" | "alias"; patterns: string[] }
> = {
    ELLINGTON: { mode: "alias", patterns: ["ELLINGTON"] },
    CREWE: { mode: "alias", patterns: ["CREWE"] },
    SKELMERSDALE: { mode: "alias", patterns: ["SKELMERSDALE", "SKELMERSDALE DEPOT"] },

    // If these exist in your UI, keep them here too:
    COVENTRY: { mode: "alias", patterns: ["CO-OP COVENTRY", "COOP COVENTRY", "COVENTRY"] },

    // Strict depots (geofence + safe name patterns)
    BELLSHILL: { mode: "strict", patterns: ["BUFFALOAD BELLSHILL"] },
    AVONMOUTH: { mode: "strict", patterns: ["CO-OP AVONMOUTH", "COOP AVONMOUTH"] },
};

export const ALL_DEPOT_LABELS = Object.keys(DEPOT_DEFINITIONS);


// Returns true if the vehicle is within Buffaload geofence AND matches depot label patterns.
export function matchesDepot(
    v: DepotMatchableVehicle,
    depotLabel: string
): boolean {
  // Geofence is mandatory (this matches your dashboard intent)
    if ((v.locationGroupName ?? "") !== "Buffaload") return false;

    const key = normalizeDepotText(depotLabel);
    const locName = normalizeDepotText(v.locationName);

    const def = DEPOT_DEFINITIONS[key] ?? { mode: "alias" as const, patterns: [key] };
    return def.patterns.some((p) => locName.includes(normalizeDepotText(p)));
}


// True if vehicle is in ANY defined depot (geofence + name patterns).
export function isInAnyDepot(v: DepotMatchableVehicle): boolean {
    if ((v.locationGroupName ?? "") !== "Buffaload") return false;
    return ALL_DEPOT_LABELS.some((d) => matchesDepot(v, d));
}

export function matchedDepots(v: DepotMatchableVehicle): string[] {
    if ((v.locationGroupName ?? "") !== "Buffaload") return [];
    return ALL_DEPOT_LABELS.filter((d) => matchesDepot(v, d));
}