export type DepotMatchableVehicle = {
    locationName?: string | null;
    formattedAddress?: string | null;
    locationGroupName?: string | null;
    depotMatch?: string | null;
};

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
    COVENTRY: { mode: "alias", patterns: ["CO-OP COVENTRY", "COOP COVENTRY", "COVENTRY"] },
    BELLSHILL: { mode: "strict", patterns: ["BUFFALOAD BELLSHILL"] },
    AVONMOUTH: { mode: "strict", patterns: ["CO-OP AVONMOUTH", "COOP AVONMOUTH"] },
};

export const ALL_DEPOT_LABELS = Object.keys(DEPOT_DEFINITIONS);

export function getMatchedDepotLabel(v: DepotMatchableVehicle): string | null {
    if ((v.locationGroupName ?? "") !== "Buffaload") return null;

    const backendDepot = normalizeDepotText(v.depotMatch);
    if (backendDepot && ALL_DEPOT_LABELS.includes(backendDepot)) {
        return backendDepot;
    }

    const haystack = normalizeDepotText(
        `${v.locationName ?? ""} ${v.formattedAddress ?? ""}`
    );

    for (const depot of ALL_DEPOT_LABELS) {
        const def = DEPOT_DEFINITIONS[depot] ?? {
        mode: "alias" as const,
        patterns: [depot],
        };

        if (def.patterns.some((p) => haystack.includes(normalizeDepotText(p)))) {
        return depot;
        }
    }

    return null;
}

export function matchesDepot(v: DepotMatchableVehicle, depotLabel: string): boolean {
    return getMatchedDepotLabel(v) === normalizeDepotText(depotLabel);
}

export function isInAnyDepot(v: DepotMatchableVehicle): boolean {
    return getMatchedDepotLabel(v) !== null;
}

export function matchedDepots(v: DepotMatchableVehicle): string[] {
    const match = getMatchedDepotLabel(v);
    return match ? [match] : [];
}