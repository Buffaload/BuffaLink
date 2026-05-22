export interface VehicleLike {
    assetName?: string;
    assetRegistration?: string;
    assetType?: string;
    assetGroupName?: string;
    locationGroupName?: string | null;
    locationName?: string | null;
    formattedAddress?: string | null;
    eventType?: string;
    date?: string;
    latitude?: number;
    longitude?: number;
    temperature?: number;
    ServiceDueDate?: string;
    MotDueDate?: string;
    IsVor?: boolean;
    LiveDefects?: boolean;
    isNightOut?: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Add 1h only for "naive" timestamps (no timezone in the string)
export const adjustedMs = (s?: string): number => {
    if (!s) return NaN;
    const naive = !/Z$|[+-]\d\d:?\d\d$/.test(s);
    const BST_OFFSET_MS = 60 * 60 * 1000;
    return new Date(s).getTime() + (naive ? BST_OFFSET_MS : 0);
};

const parseDueMs = (s?: string): number => {
    if (!s) return NaN;
    const t = s.trim();
    if (!t) return NaN;
    const d = t.includes("T") ? new Date(t) : new Date(`${t}T00:00:00`);
    return d.getTime();
};

const daysUntil = (s?: string): number | null => {
    const dueMs = parseDueMs(s);
    if (Number.isNaN(dueMs)) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((dueMs - today.getTime()) / MS_PER_DAY);
};

export const isCriticalAlert = (v: VehicleLike): boolean => {
    // Must be out of a depot OR maintenance
    if (
        v.locationGroupName === "Buffaload" ||
        v.locationGroupName === "Maintenance"
    ) {
        return false;
    }

    const threshold = 5;
    const serviceDays = daysUntil(v.ServiceDueDate);
    const motDays = daysUntil(v.MotDueDate);

    return (
    (serviceDays !== null && serviceDays <= threshold) ||
    (motDays !== null && motDays <= threshold)
    );
};

export const matchesFilter = (
    v: VehicleLike,
    filterOption: string,
    selectedDepots: string[] = [],
    nowMs: number = Date.now()
): boolean => {
    const eventType = (v.eventType ?? "").toLowerCase();
    const timeStoppedMs = v.date ? nowMs - adjustedMs(v.date) : 0;

    switch (filterOption) {
        case "Night-Out":
            return !!v.isNightOut;

        case "HGVs":
            return (
                v.assetType === "HGV" &&
                // "Known location" rule stays consistent with current dashboard:
                // Volvo fix makes locationName non-null; Michelin already sets it when known.
                !!v.locationName &&
                timeStoppedMs > 1.5 * 60 * 60 * 1000 &&
                v.locationGroupName !== "Buffaload" &&
                v.locationGroupName !== "Maintenance" &&
                v.assetGroupName !== "TFP Tipper Operation" &&
                v.locationGroupName !== "Services and Truckstops"
            );

        case "Services":
            return (
                v.assetType === "HGV" &&
                (v.locationGroupName === "Services and Truckstops" || !v.locationGroupName) &&
                timeStoppedMs > 5 * 60 * 1000 &&
                eventType !== "driving" &&
                v.locationGroupName !== "Buffaload" &&
                v.locationGroupName !== "Maintenance" &&
                v.assetGroupName !== "TFP Tipper Operation" &&
                !v.isNightOut
            );

            case "Depots": {
                // Exclude tippers from depot view
                if (v.assetGroupName === "TFP Tipper Operation") return false;

                const hay = `${v.locationName ?? ""} ${v.formattedAddress ?? ""} ${v.locationGroupName ?? ""}`
                    .toUpperCase()
                    .replace(/\s+/g, " ")
                    .trim();

                const depotMatchers: Record<string, RegExp[]> = {
                    Ellington: [/ELLINGTON/i, /BUFFALOAD ELLINGTON/i],
                    Crewe: [/CREWE/i, /BUFFALOAD CREWE/i],
                    Skelmersdale: [/SKELMERSDALE/i, /BUFFALOAD SKELMERSDALE/i],
                    Coventry: [/COVENTRY/i, /CO-OP\s*COVENTRY/i, /COOP\s*COVENTRY/i],
                    Avonmouth: [/AVONMOUTH/i, /CO-OP\s*AVONMOUTH/i, /COOP\s*AVONMOUTH/i],
                    Bellshill: [/BELLSHILL/i],
                };

                const matchesAnyDepot = Object.values(depotMatchers).some((patterns) =>
                    patterns.some((re) => re.test(hay))
                );

                // "Depot base" = either geofenced (Buffaload group) OR text match fallback
                const isDepotBase = v.locationGroupName === "Buffaload" || matchesAnyDepot;

                if (selectedDepots.length === 0) return isDepotBase;

                return (
                    isDepotBase &&
                    selectedDepots.some((depot) => {
                    const patterns = depotMatchers[depot];
                    return patterns ? patterns.some((re) => re.test(hay)) : false;
                    })
                );
            }

        case "Maintenance":
            return v.locationGroupName === "Maintenance";

        case "Critical":
            return isCriticalAlert(v);

        case "Tippers":
            return v.assetGroupName === "TFP Tipper Operation";

        default:
            return true;
    }
};

export const filterVehicles = <T extends VehicleLike>(
    vehicles: T[],
    filterOption: string,
    selectedDepots: string[] = [],
    nowMs: number = Date.now()
): T[] => vehicles.filter((v) => matchesFilter(v, filterOption, selectedDepots, nowMs));

export const countFor = <T extends VehicleLike>(
    vehicles: T[],
    filterOption: string,
    selectedDepots: string[] = [],
    nowMs: number = Date.now()
): number => filterVehicles(vehicles, filterOption, selectedDepots, nowMs).length;
