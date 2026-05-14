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
    // Must be out of a depot
    if (v.locationGroupName === "Buffaload") return false;

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
                // "Known location" rule stays consistent with your current dashboard:
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
            const isDepotBase =
            v.locationGroupName === "Buffaload" &&
            v.assetGroupName !== "TFP Tipper Operation";

            if (selectedDepots.length === 0) return isDepotBase;

            // Depot subtabs
            return selectedDepots.some((depot) => {
                if (!isDepotBase) return false;

                switch (depot) {
                    case "Ellington":
                    return v.locationName === "BUFFALOAD ELLINGTON";
                    case "Crewe":
                    return v.locationName === "BUFFALOAD CREWE";
                    case "Skelmersdale":
                    return v.locationName === "BUFFALOAD SKELMERSDALE";
                    default:
                    return false;
                }
            });
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

export const filterVehicles = (
    vehicles: VehicleLike[],
    filterOption: string,
    selectedDepots: string[] = [],
    nowMs: number = Date.now()
) => vehicles.filter((v) => matchesFilter(v, filterOption, selectedDepots, nowMs));

export const countFor = (
    vehicles: VehicleLike[],
    filterOption: string,
    selectedDepots: string[] = [],
    nowMs: number = Date.now()
) => filterVehicles(vehicles, filterOption, selectedDepots, nowMs).length;