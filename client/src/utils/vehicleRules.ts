export interface VehicleLike {
    statusSinceMs?: number;
    assetName?: string;
    assetRegistration?: string;
    assetType?: string;
    assetGroupName?: string;
    driverGroupName?: string;
    // Enrichment from Volvo
    driverName?: string;
    fuelType?: string[] | string | null;
    // Numeric speed value in mph when available
    speed?: number;
    locationGroupName?: string | null;
    branchId?: string | number | null;
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

const isTipper = (v: VehicleLike): boolean =>
    v.assetGroupName === "TFP Tipper Operation" ||
    v.driverGroupName === "TFP Tipper Operation";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Add 1h only for "naive" timestamps (no timezone in the string)
export const adjustedMs = (s?: string): number => {
    if (!s) return NaN;
    const naive = !/Z$|[+-]\d\d:?\d\d$/.test(s);
    const BST_OFFSET_MS = 60 * 60 * 1000;
    return new Date(s).getTime() + (naive ? BST_OFFSET_MS : 0);
};

const STOPPED_1_HOUR_MS = 60 * 60 * 1000;
const STOPPED_15_MIN_MS = 15 * 60 * 1000;

export const getStatusSinceMs = (
    v: VehicleLike,
    nowMs: number = Date.now()
): number | undefined => {
    const candidate =
        typeof v.statusSinceMs === "number"
            ? v.statusSinceMs
            : v.date
            ? adjustedMs(v.date)
            : NaN;

    if (!Number.isFinite(candidate)) return undefined;

    // Guard against bad future timestamps
    return Math.min(candidate, nowMs);
};

export const getTimeInStateMs = (
    v: VehicleLike,
    nowMs: number = Date.now()
): number => {
    const sinceMs = getStatusSinceMs(v, nowMs);
    if (sinceMs == null) return 0;
    return Math.max(0, nowMs - sinceMs);
};

export const isStoppedEvent = (v: VehicleLike): boolean =>
    (v.eventType ?? "").toLowerCase() === "stopped";

export const isDrivingEvent = (v: VehicleLike): boolean =>
    (v.eventType ?? "").toLowerCase() === "driving";

export const isAtDepot = (v: VehicleLike): boolean =>
    (v.locationGroupName ?? "").trim() === "Buffaload";

export const isAtMaintenance = (v: VehicleLike): boolean =>
    (v.locationGroupName ?? "").trim() === "Maintenance";

export const isAtServices = (v: VehicleLike): boolean =>
    (v.locationGroupName ?? "").trim() === "Services and Truckstops";

export const isEligibleStoppedHgv = (
    v: VehicleLike,
    nowMs: number = Date.now()
): boolean => {
    return (
        v.assetType === "HGV" &&
        isStoppedEvent(v) &&
        getTimeInStateMs(v, nowMs) >= STOPPED_1_HOUR_MS &&
        !isAtDepot(v) &&
        !isAtMaintenance(v) &&
        !isAtServices(v) &&
        !isTipper(v)
    );
};

export const isEligibleServicesHgv = (
    v: VehicleLike,
    nowMs: number = Date.now()
): boolean => {
    return (
        v.assetType === "HGV" &&
        (isAtServices(v) || !v.locationGroupName) &&
        getTimeInStateMs(v, nowMs) >= STOPPED_15_MIN_MS &&
        !isDrivingEvent(v) &&
        !isAtDepot(v) &&
        !isAtMaintenance(v) &&
        !isTipper(v) &&
        !v.isNightOut
    );
};

export const isEligibleKioskVehicle = (
    v: VehicleLike,
    nowMs: number = Date.now()
): boolean => {
    return (
        v.assetType === "HGV" &&
        isStoppedEvent(v) &&
        getTimeInStateMs(v, nowMs) > 0 &&
        !isAtDepot(v) &&
        !isAtMaintenance(v) &&
        !isTipper(v) &&
        !v.IsVor &&
        !v.LiveDefects
    );
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

function startOfISOWeekUTC(date: Date): Date {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (dayNum - 1));
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function getISOWeekDiffFromToday(dueDate: Date): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisWeekStart = startOfISOWeekUTC(today).getTime();
    const dueWeekStart = startOfISOWeekUTC(dueDate).getTime();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    return Math.round((dueWeekStart - thisWeekStart) / msPerWeek);
}

const isDateDueThisISOWeekOrOverdue = (date?: string): boolean => {
    if (!date) return false;

    const due = new Date(date);
    if (Number.isNaN(due.getTime())) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (due < today) return true;

    const weekDiff = getISOWeekDiffFromToday(due);
    return weekDiff === 0;
};

export const isServiceDueThisISOWeekOrOverdue = (v: VehicleLike) =>
    isDateDueThisISOWeekOrOverdue(v.ServiceDueDate);

export const isMotDueThisISOWeekOrOverdue = (v: VehicleLike) =>
    isDateDueThisISOWeekOrOverdue(v.MotDueDate);

type DueDateEntry = {
    key: string;
    raw: string;
    dueMs: number;
};

// Pull all "DueDate" fields off the runtime object, keeping the key name
const getAllDueDateEntries = (v: VehicleLike): DueDateEntry[] => {
    const entries: DueDateEntry[] = [];

    for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
        if (!/duedate$/i.test(key)) continue;
        if (typeof value !== "string") continue;

        const raw = value.trim();
        if (!raw) continue;

        const dueMs = parseDueMs(raw);
        if (Number.isNaN(dueMs)) continue;

        entries.push({ key, raw, dueMs });
    }

    return entries;
};

const VEHICLE_IGNORED_DUE_KEYS = /(fridge|rfl|fgas)/i;

// Critical Arrivals = vehicle is IN a depot AND has ANY due date that is due this ISO week or overdue
export const isCriticalArrival = (v: VehicleLike): boolean => {
    if (v.locationGroupName !== "Buffaload") return false;
    if (isTipper(v)) return false;
    
    const entries = getAllDueDateEntries(v);

    const dueNow = entries
        .filter((e) => isDateDueThisISOWeekOrOverdue(e.raw))
        .sort((a, b) => a.dueMs - b.dueMs);

    if (dueNow.length === 0) return false;
    if (v.assetType === "Trailer") return true;

    // Non-trailers: walk forward from the closest due date, ignoring Fridge/RFL/FGAS keys
    for (const item of dueNow) {
        if (VEHICLE_IGNORED_DUE_KEYS.test(item.key)) {
        continue;
        }

        return true;
    }

    return false;
};

export const matchesFilter = (
    v: VehicleLike,
    filterOption: string,
    selectedDepots: string[] = [],
    nowMs: number = Date.now()
): boolean => {
    switch (filterOption) {
        case "Night-Out":
            return !!v.isNightOut;

        case "HGVs":
            return isEligibleStoppedHgv(v, nowMs);

        case "Services":
            return isEligibleServicesHgv(v, nowMs);

            case "Depots": {
                // Exclude tippers from depot view
                if (isTipper(v)) return false;

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

        case "Critical-Arrivals":
            return isCriticalArrival(v);
            
        case "Tippers":
            return isTipper(v);

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
