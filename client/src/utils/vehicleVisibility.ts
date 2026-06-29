export const DEPOT_TO_BRANCH_ID: Record<string, string> = {
    ellington: "1",
    crewe: "2",
    coventry: "10",
    skelmersdale: "3",
    bellshill: "11",
    avonmouth: "4",
};

const LOCATION_DEPOT_KEYS = Object.keys(DEPOT_TO_BRANCH_ID);

export const getAllowedBranchIds = (): Set<string> | null => {
    const role = (localStorage.getItem("role") ?? "").toLowerCase();
    const userDepot = (localStorage.getItem("depot") ?? "").toLowerCase();

    // Non-admin -> always one depot
    if (role !== "admin") {
        const id = DEPOT_TO_BRANCH_ID[userDepot];
        return id ? new Set([id]) : new Set();
    }

    // Admin -> use selected depots from location settings
    try {
        const raw = localStorage.getItem("buffalink:locationSelectedDepots");
        const parsed = raw ? JSON.parse(raw) : [];

        const normalized: string[] = Array.isArray(parsed)
            ? parsed
                .map((d: string) => d.toLowerCase().trim())
                .filter((d: string) => LOCATION_DEPOT_KEYS.includes(d))
                .filter(
                    (d: string, index: number, arr: string[]) =>
                        arr.indexOf(d) === index
                )
            : [];

        // Nothing selected = ALL
        if (normalized.length === 0) {
            return null;
        }

        // All selectable depots selected = ALL
        const allSelected = LOCATION_DEPOT_KEYS.every((depot) =>
            normalized.includes(depot)
        );

        if (allSelected) {
            return null;
        }

        return new Set(
            normalized
                .map((depot) => DEPOT_TO_BRANCH_ID[depot])
                .filter(Boolean)
        );
    } catch {
        return null;
    }
};

export const applyAllowedBranchFilter = <T extends { branchId?: string | number }>(
    vehicles: T[]
): T[] => {
    const allowedBranches = getAllowedBranchIds();

    if (allowedBranches === null) {
        return vehicles;
    }

    return vehicles.filter((vehicle) => {
        if (vehicle.branchId == null) return false;
        return allowedBranches.has(String(vehicle.branchId));
    });
};