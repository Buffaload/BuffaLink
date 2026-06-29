import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

export interface VehicleQueryItem {
    id?: string;
    assetName: string;
    assetRegistration?: string;
    eventType: string;
    date: string;
    locationName?: string;
    formattedAddress?: string;
    locationGroupName?: string;
    depotMatch?: string;
    branchId?: string | number;
    isNightOut?: boolean;
    latitude?: number;
    longitude?: number;
    [key: string]: any;
}

const LAST_GOOD_VEHICLES_KEY = "buffalink:lastGoodVehicles";
const SUSPICIOUS_DROP_RATIO = 0.9; // treat >10% drop as suspicious unless backend explicitly says it's valid

const readLastGoodVehicles = (): VehicleQueryItem[] => {
    try {
        const raw = localStorage.getItem(LAST_GOOD_VEHICLES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeLastGoodVehicles = (vehicles: VehicleQueryItem[]) => {
    try {
        localStorage.setItem(LAST_GOOD_VEHICLES_KEY, JSON.stringify(vehicles));
    } catch {
        // ignore storage / quota errors
    }
};

const fetchVehicles = async (
    previous: VehicleQueryItem[],
    persistentLastGood: VehicleQueryItem[]
): Promise<VehicleQueryItem[]> => {
    const token = localStorage.getItem("token");
    if (!token) {
        throw new Error("No token found. Please log in.");
    }

    const response = await api.get("/vehicles", {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (response.status !== 200) {
        throw new Error("Failed to fetch vehicles");
    }

    const data = response.data;
    const arr = Array.isArray(data)
        ? data
        : Array.isArray(data?.vehicles)
        ? data.vehicles
        : [];

    const isPartial = response.headers?.["x-partial-data"] === "1";

    // Explicit partial response from backend
    if (isPartial) {
        if (previous.length > 0) return previous;
        if (persistentLastGood.length > 0) return persistentLastGood;
        return arr;
    }

    // Empty response - preserve last known good
    if (arr.length === 0) {
        if (previous.length > 0) return previous;
        if (persistentLastGood.length > 0) return persistentLastGood;
        return [];
    }

    // Suspicious count drop guard
    const comparisonBaseCount =
        previous.length > 0 ? previous.length : persistentLastGood.length;

    const suspiciousDrop =
        comparisonBaseCount > 0 &&
        arr.length < Math.floor(comparisonBaseCount * SUSPICIOUS_DROP_RATIO);

    if (suspiciousDrop) {
        console.warn(
            "[useVehiclesQuery] Suspicious vehicle count drop detected; keeping last known good snapshot",
            {
                incomingCount: arr.length,
                comparisonBaseCount,
                ratio:
                comparisonBaseCount > 0 ? arr.length / comparisonBaseCount : null,
            }
        );

        if (previous.length > 0) return previous;
        if (persistentLastGood.length > 0) return persistentLastGood;
    }

    // Fresh good payload - persist it
    writeLastGoodVehicles(arr);
    return arr;
};

export const useVehiclesQuery = () => {
    const queryClient = useQueryClient();

    return useQuery<VehicleQueryItem[]>({
        queryKey: ["vehicles"],
        queryFn: async () => {
            const previous =
                queryClient.getQueryData<VehicleQueryItem[]>(["vehicles"]) ?? [];
            const persistentLastGood = readLastGoodVehicles();

            return fetchVehicles(previous, persistentLastGood);
        },
        refetchInterval: 30000,
        staleTime: 60000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
        placeholderData: (previousData) => previousData,
        refetchOnWindowFocus: false,
    });
};

export default useVehiclesQuery;