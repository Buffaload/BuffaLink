type VehicleIdentityLike = {
    assetName?: string;
    assetRegistration?: string;
    assetType?: string;
    date?: string;
};

const normalizeIdentityPart = (value?: string) =>
    (value ?? "").trim().toUpperCase();

const getSafeTime = (value?: string) => {
    if (!value) return 0;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
};

export const getVehicleIdentityKey = (vehicle: VehicleIdentityLike) => {
    const type = normalizeIdentityPart(vehicle.assetType);
    const reg = normalizeIdentityPart(vehicle.assetRegistration);
    const name = normalizeIdentityPart(vehicle.assetName);

    return `${type}|${reg || "NO_REG"}|${name || "NO_NAME"}`;
};

export const dedupeVehiclesByIdentity = <T extends VehicleIdentityLike>(
    vehicles: T[]
): T[] => {
    const map = new Map<string, T>();

    for (const vehicle of vehicles) {
        const key = getVehicleIdentityKey(vehicle);
        const existing = map.get(key);

        if (!existing) {
            map.set(key, vehicle);
            continue;
        }

        // Keep the newest record if duplicates exist
        const existingTime = getSafeTime(existing.date);
        const currentTime = getSafeTime(vehicle.date);

        if (currentTime >= existingTime) {
            map.set(key, vehicle);
        }
    }

    return Array.from(map.values());
};