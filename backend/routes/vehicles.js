import express from "express";
import axios from "axios";
import crypto from "crypto";
import pLimit from "p-limit";
import https from "https";
import auth from "../middleware/auth.js";
import diagnostics from "../middleware/diagnostics.js";
import VehicleMetadata from "../models/VehicleMetadata.js";
import { depotVisibilityRules } from "../config/visibilityRules.js";

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const VOLVO_BASE_URL = "https://api.volvotrucks.com/vehicle";

const VOLVO_ACCEPT = {
  vehicles: "application/x.volvogroup.com.vehicles.v1.0+json",
  positions: "application/x.volvogroup.com.vehiclepositions.v1.0+json",
};

const makeRequestId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

const pick = (obj, keys) =>
  keys.reduce((acc, k) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) acc[k] = obj[k];
    return acc;
  }, {});

const unwrapAxiosError = (err) => ({
  message: err?.message,
  status: err?.response?.status,
  data: err?.response?.data,
});

// Radius in meters for "at depot" detection.
// 300–800m is typical depending on GPS jitter + depot footprint.
const GEOFENCE_RADIUS_METERS = Number(process.env.GEOFENCE_RADIUS_METERS ?? 650);

// Simple haversine distance (meters)
const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000; // earth radius meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Add sites here (depots + maintenance locations)
const GEOFENCE_SITES = [
  {
    key: "ELLINGTON",
    name: "BUFFALOAD ELLINGTON",
    group: "Buffaload",
    latitude: 52.335571,
    longitude: -0.294590,
    radius: 700,
  },
  {
    key: "CREWE",
    name: "BUFFALOAD CREWE",
    group: "Buffaload",
    latitude: 53.088139,
    longitude: -2.420820,
    radius: 700,
  },
  {
    key: "SKELMERSDALE",
    name: "BUFFALOAD SKELMERSDALE",
    group: "Buffaload",
    latitude: 53.540878,
    longitude: -2.786520,
    radius: 700,
  },
  {
    key: "BELLSHILL",
    name: "BUFFALOAD BELLSHILL",
    group: "Buffaload",
    latitude: 55.8203,
    longitude: -3.9803,
    radius: 350,
  },
  {
    key: "COVENTRY",
    name: "BUFFALOAD COVENTRY",
    group: "Buffaload",
    latitude: 52.4068,
    longitude: -1.5197,
    radius: 600,
  },
  {
    key: "AVONMOUTH",
    name: "BUFFALOAD AVONMOUTH",
    group: "Buffaload",
    latitude: 51.5009,
    longitude: -2.7003,
    radius: 350,
  },
];

// Returns the matching geofence site (or null) for given coordinates
const matchGeofenceSite = (latitude, longitude) => {
  if (latitude == null || longitude == null) return null;

  let best = null;
  let bestDist = Infinity;

  for (const site of GEOFENCE_SITES) {
    const d = haversineMeters(latitude, longitude, site.latitude, site.longitude);
    if (d < bestDist) {
      best = site;
      bestDist = d;
    }
  }

  if (best && bestDist <= (best.radius ?? 650)) {
    return { ...best, distanceMeters: bestDist };
  }
  return null;
};

const normalizeText = (s) =>
  String(s ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const DEPOT_TEXT_MATCHERS = [
  { depot: "Ellington", patterns: [/ELLINGTON/i] },
  { depot: "Crewe", patterns: [/CREWE/i] },
  { depot: "Skelmersdale", patterns: [/SKELMERSDALE/i] },
  { 
    depot: "Coventry", 
    patterns: [/CO-OP\s*COVENTRY/i, /COOP\s*COVENTRY/i] 
  },
  {
    depot: "Avonmouth",
    patterns: [/AVONMOUTH/i, /CO-OP\s*AVONMOUTH/i, /COOP\s*AVONMOUTH/i,]
  },
];

const matchDepotByText = (vehicle) => {
  const hay = normalizeText(
    [
      vehicle?.locationName,
      vehicle?.formattedAddress,
      vehicle?.locationGroupName,
    ].filter(Boolean).join(" | ")
  );

  for (const entry of DEPOT_TEXT_MATCHERS) {
    if (entry.patterns.some((re) => re.test(hay))) return entry.depot;
  }
  return null;
};

// Simple in-memory cache (can later move to Redis or Mongo)
const reverseGeocodeCache = new Map();
const REVERSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// Limit concurrent reverse-geocode HTTP calls
const reverseGeocodeLimit = pLimit(5);

async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cached = reverseGeocodeCache.get(key);

  if (cached && Date.now() - cached.ts < REVERSE_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: {
          lat,
          lon,
          format: "json",
          zoom: 18,
          addressdetails: 1,
        },
        headers: {
          "User-Agent": "BuffaLink/1.0 (ops@buffaload.co.uk)",
        },
        timeout: 8000,
      }
    );

    const name =
      data?.name ||
      data?.address?.supermarket ||
      data?.address?.road ||
      data?.address?.industrial ||
      data?.display_name ||
      null;

    if (name) {
      reverseGeocodeCache.set(key, { ts: Date.now(), value: name });
    }

    return name;
  } catch (err) {
    console.warn("Reverse geocode failed", err.message);
    return null;
  }
}

async function fetchVolvoPaged({
  axiosInstance,
  path,
  params,
  accept,
  extractItems,
  getNextPageParam,
}) {
  const all = [];
  let pageParams = {};
  let guard = 0;

  while (guard++ < 50) {
    const resp = await axiosInstance.get(path, {
      params: {
        ...params,
        ...pageParams,
        requestId: makeRequestId(),
      },
      headers: { Accept: accept },
      timeout: 15000,
    });

    const items = extractItems(resp.data) || [];
    all.push(...items);

    const more = !!resp.data?.moreDataAvailable;
    if (!more || items.length === 0) break;

    // Compute params for next page (VIN or starttime depending on endpoint)
    pageParams =
      typeof getNextPageParam === "function"
        ? getNextPageParam({ respData: resp.data, items })
        : {};

    if (!pageParams || Object.keys(pageParams).length === 0) break;
  }

  return all;
}

const SOURCE_CACHE_TTL_MS = Number(process.env.SOURCE_CACHE_TTL_MS ?? 120000);
const MICHELIN_RETRY_ATTEMPTS = Number(process.env.MICHELIN_RETRY_ATTEMPTS ?? 1); // 1 retry => 2 total tries
const BLUE_RETRY_ATTEMPTS = Number(process.env.BLUE_RETRY_ATTEMPTS ?? 0);
const REQUIRE_MICHELIN_COMPLETE = String(process.env.REQUIRE_MICHELIN_COMPLETE ?? "1") === "1";

const sourceCache = {
  michelin: { ts: 0, data: [] },
  volvoMapped: { ts: 0, data: [] },
  blueCrystal: { ts: 0, data: [] },
  nightOut: { ts: 0, data: [] },
  combined: { ts: 0, data: [] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, { attempts = 1, baseDelayMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (i < attempts) await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

const normaliseToArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.vehicles)) return payload.vehicles;
  if (Array.isArray(payload?.vehicleResponse?.vehicles)) return payload.vehicleResponse.vehicles;
  return null;
};

const cacheIfNonEmpty = (key, arr) => {
  if (Array.isArray(arr) && arr.length > 0) {
    sourceCache[key] = { ts: Date.now(), data: arr };
    return arr;
  }

  // Do NOT wipe cache on empty-but-successful responses
  return isFresh(sourceCache[key]?.ts)
    ? sourceCache[key].data
    : [];
};

const isFresh = (ts) => Date.now() - ts <= SOURCE_CACHE_TTL_MS;

const router = express.Router();

// Fetch vehicles from external API
router.get("/", auth, diagnostics, async (req, res) => {
  console.log("Authenticated request from user:", req.user);
  const forceDebug =
    req.user?.role === "admin" &&
    String(req.query.forceDebug ?? "") === "1";
  const debug = forceDebug || Boolean(res.locals.debug);
  
  res.set("X-ForceDebug-Query", String(req.query.forceDebug ?? ""));
  res.set("X-ForceDebug-Enabled", String(forceDebug));

  try {
    // Environment detection: Use NODE_ENV or check for dummy URLs
    // const useMockData = process.env.NODE_ENV !== 'production' ||
    //                    process.env.API_URL?.includes('dummy') ||
    //                    process.env.BLUECRYSTAL_API_URL?.includes('dummy');
    const useMockData = false;

    let vehicles = [];
    let existingVehicles = [];
    let maintenanceDetails = [];
    let volvoVehicles = [];
    let volvoPositions = [];
    let nightOutMetadata = [];
    let volvoDebug = {};
    let sourceDebug = { michelin: null, blueCrystal: null, volvoVehicles: null, volvoPositions: null };

    if (useMockData) {
      // DEVELOPMENT MODE: Return mock data for local development
      console.log("Using mock data for development");

      vehicles = [
        {
          assetName: "HGV001",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: "High Street",
          locationGroupName: "Unknown", // Will show in HGVs filter (not excluded)
          date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          status: "Available"
        },
        {
          assetName: "HGV002",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: "Industrial Estate",
          locationGroupName: "Unknown",
          date: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
          status: "In Transit"
        },
        {
          assetName: "SERVICE001",
          assetType: "HGV",
          assetGroupName: "Services",
          eventType: "stopped",
          locationName: "Moto Service Station, M6 Junction 16",
          locationGroupName: "Services and Truckstops",
          date: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(), // 2.5 hours ago (meets >1.5h criteria)
          latitude: 52.1234,
          longitude: -1.5678,
          formattedAddress: "Moto Service Station, M6 Junction 16, Northamptonshire",
          temperature: 18.5,
          status: "Available"
        },
        {
          assetName: "SERVICE002",
          assetType: "HGV",
          assetGroupName: "Services",
          eventType: "stopped",
          locationName: "Welcome Break, M1 Junction 15a",
          locationGroupName: "Services and Truckstops",
          date: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
          latitude: 52.3456,
          longitude: -1.2345,
          formattedAddress: "Welcome Break Services, M1 Junction 15a, Northamptonshire",
          temperature: 22.3,
          status: "Available"
        },
        {
          assetName: "SERVICE003",
          assetType: "HGV",
          assetGroupName: "Services",
          eventType: "stopped",
          locationName: "Eurotunnel Truckstop",
          locationGroupName: "Services and Truckstops",
          date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
          latitude: 51.0987,
          longitude: 1.3456,
          formattedAddress: "Eurotunnel Freight Services, Folkestone, Kent",
          temperature: 15.7,
          status: "Available"
        },
        {
          assetName: "UNKNOWN001",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: null,
          locationGroupName: null, // Unknown location
          date: new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString(), // 3.5 hours ago
          latitude: 53.4567,
          longitude: -2.7890,
          formattedAddress: "Unknown Location - Manchester Area",
          temperature: 19.8,
          status: "Available"
        },
        {
          assetName: "UNKNOWN002",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: null,
          locationGroupName: null, // Unknown location
          date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
          latitude: 51.6789,
          longitude: -0.1234,
          formattedAddress: "Unknown Location - London Area",
          temperature: 21.2,
          status: "Available"
        },
        {
          assetName: "DEPOT001",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: "BUFFALOAD ELLINGTON",
          locationGroupName: "Buffaload",
          date: new Date().toISOString(),
          latitude: 52.3355,
          longitude: -0.2945,
          formattedAddress: "Buffaload Ellington, Ellington, Huntingdon, Cambridgeshire",
          temperature: 24.0,
          status: "Available"
        },
        {
          assetName: "TIPPER001",
          assetType: "Tipper",
          assetGroupName: "TFP Tipper Operation",
          eventType: "stopped",
          locationName: "Site B",
          locationGroupName: "Buffaload",
          date: new Date().toISOString(),
          latitude: 52.3773,
          longitude: -0.0240,
          formattedAddress: "Mick George, Somersham, Cambridgeshire",
          temperature: 24.0,
          status: "Available"
        },
        {
          assetName: "MAINT001",
          assetType: "HGV",
          assetGroupName: "Maintenance",
          eventType: "stopped",
          locationName: "Maintenance Bay",
          locationGroupName: "Maintenance",
          date: new Date().toISOString(),
          latitude: 52.3355,
          longitude: -0.2945,
          formattedAddress: "Buffaload Ellington, Ellington, Huntingdon, Cambridgeshire",
          temperature: 24.0,
          status: "Under Maintenance"
        }
      ];

      maintenanceDetails = [
        {
          VehicleId: "HGV001",
          ServiceDueDate: "2026-06-15",
          MotDueDate: "2026-08-20",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "HGV002",
          ServiceDueDate: "2027-03-10",
          MotDueDate: "2027-02-15",
          IsVor: true,
          LiveDefects: false
        },
        {
          VehicleId: "SERVICE001",
          ServiceDueDate: "2026-04-30",
          MotDueDate: "2026-06-25",
          IsVor: false,
          LiveDefects: true
        },
        {
          VehicleId: "SERVICE002",
          ServiceDueDate: "2026-07-15",
          MotDueDate: "2026-09-10",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "SERVICE003",
          ServiceDueDate: "2026-05-20",
          MotDueDate: "2026-07-30",
          IsVor: true,
          LiveDefects: true
        },
        {
          VehicleId: "UNKNOWN001",
          ServiceDueDate: "2026-08-01",
          MotDueDate: "2026-10-15",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "UNKNOWN002",
          ServiceDueDate: "2026-06-30",
          MotDueDate: "2026-08-25",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "DEPOT001",
          ServiceDueDate: "2026-07-01",
          MotDueDate: "2026-09-01",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "TIPPER001",
          ServiceDueDate: "2026-07-01",
          MotDueDate: "2026-09-01",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "MAINT001",
          ServiceDueDate: "2026-05-15",
          MotDueDate: "2026-07-20",
          IsVor: false,
          LiveDefects: false
        }
      ];

      // Get night-out metadata from MongoDB
      nightOutMetadata = await VehicleMetadata.find({});
    } else {
      // PRODUCTION MODE: Use real external APIs
      console.log("Using real external APIs for production");

      const apiUrl = process.env.API_URL;
      const apiUsername = process.env.API_USERNAME;
      const apiPassword = process.env.API_PASSWORD;
      const blueCrystalApiUrl = process.env.BLUECRYSTAL_API_URL;
      const blueCrystalApiKey = process.env.BLUECRYSTAL_API_KEY;
      const volvoUsername = process.env.VOLVO_USERNAME;
      const volvoPassword = process.env.VOLVO_PASSWORD;
      const volvoAxios = axios.create({
        baseURL: VOLVO_BASE_URL,
        auth: { username: volvoUsername, password: volvoPassword },
        timeout: 15000,
        httpsAgent,
      });

      const safeGet = (url, config) => {
        if (!url) {
          return Promise.reject(new Error("Missing required URL env var"));
        }
        return axios.get(url, {
          httpsAgent,
          timeout: 25000,
          ...config,
        });
      };

      
      const mapVolvoVehicles = (volvoVehicles, volvoPositions) => {
        // Build an index for O(1) lookup by VIN
        const posByVin = new Map(volvoPositions.map(p => [p.vin, p]));

        return Promise.all(
          volvoVehicles.map(async (v) => {
            const p = posByVin.get(v.vin);
            if (!p?.gnssPosition) return null;
            const gnss = p.gnssPosition;
            if (gnss.latitude == null || gnss.longitude == null) return null;
            const rawSpeed = p.wheelBasedSpeed ?? gnss.speed ?? 0;
            const speed = Number(rawSpeed);
            // Volvo feeds often jitter around 0 when stationary
            const MOVING_THRESHOLD = 1;
            const isMoving = Number.isFinite(speed) && speed > MOVING_THRESHOLD;
            const reg = v?.volvoGroupVehicle?.registrationNumber;
            const name = v.customerVehicleName;
            const lat = gnss.latitude;
            const lon = gnss.longitude;
            // Geofence match (depots / maintenance)
            const site = matchGeofenceSite(lat, lon);
            // Reverse geocode ONLY if not geofenced
            const reverseName = !site
              ? await reverseGeocodeLimit(() => reverseGeocode(lat, lon))
              : null;

            return {
              assetName: `[VOLVO] ${reg ?? v.vin}`,
              assetRegistration: reg || undefined,
              assetType: "HGV",
              assetGroupName: "HGVs",
              eventType: isMoving ? "driving" : "stopped",
              status: isMoving ? "In Transit" : "Available",
              latitude: lat,
              longitude: lon,
              date:
                gnss.positionDateTime ||
                p.receivedDateTime ||
                p.createdDateTime ||
                new Date().toISOString(),
              locationName: site?.name ?? reverseName ?? "Unknown location",
              locationGroupName: site?.group ?? null,
            };
          })
        ).then(arr => arr.filter(Boolean));
      };

      const [vehicleResponse, blueCrystalResponse, volvoVehiclesResponse, volvoPositionsResponse, nightOutMetadataResult] =
        await Promise.allSettled([
          // Michelin with retry: prevents Volvo-only first loads when Michelin is flaky/cold
          withRetry(
            () =>
              safeGet(apiUrl, {
                auth: { username: apiUsername, password: apiPassword },
              }),
            { attempts: MICHELIN_RETRY_ATTEMPTS, baseDelayMs: 300 }
          ),
          // BlueCrystal optional retry
          withRetry(
            () =>
              safeGet(blueCrystalApiUrl, {
                headers: { "x-api-key": blueCrystalApiKey, "x-end-point": "public.v1" },
              }),
            { attempts: BLUE_RETRY_ATTEMPTS, baseDelayMs: 300 }
          ),
          fetchVolvoPaged({
            axiosInstance: volvoAxios,
            path: "/vehicles",
            params: { additionalContent: "VOLVOGROUPVEHICLE" },
            accept: VOLVO_ACCEPT.vehicles,
            extractItems: (data) => data?.vehicleResponse?.vehicles,
            getNextPageParam: ({ items }) => ({ lastVin: items?.[items.length - 1]?.vin }),
          }),
          fetchVolvoPaged({
            axiosInstance: volvoAxios,
            path: "/vehiclepositions",
            params: { latestOnly: true },
            accept: VOLVO_ACCEPT.positions,
            extractItems: (data) => data?.vehiclePositionResponse?.vehiclePositions,
            getNextPageParam: null,
          }),
          VehicleMetadata.find({}),
        ]);
    
      const settledToDebug = (r) =>
        r.status === "fulfilled"
          ? { status: "fulfilled", http: r.value?.status, contentType: r.value?.headers?.["content-type"] }
          : { status: "rejected", error: unwrapAxiosError(r.reason) };

      sourceDebug.michelin = settledToDebug(vehicleResponse);
      sourceDebug.blueCrystal = settledToDebug(blueCrystalResponse);
      sourceDebug.volvoVehicles = { status: volvoVehiclesResponse.status, count: volvoVehiclesResponse.value?.length ?? 0 };
      sourceDebug.volvoPositions = { status: volvoPositionsResponse.status, count: volvoPositionsResponse.value?.length ?? 0 };
  
      if (volvoVehiclesResponse.status === "rejected") {
        console.warn("[VOLVO /vehicles] rejected", {
          message: volvoVehiclesResponse.reason?.message,
          status: volvoVehiclesResponse.reason?.response?.status,
          data: volvoVehiclesResponse.reason?.response?.data,
        });
      } else {
        console.log("[VOLVO /vehicles] fulfilled", { count: volvoVehiclesResponse.value?.length ?? 0 });
      }

      if (volvoPositionsResponse.status === "rejected") {
        console.warn("[VOLVO /vehiclepositions] rejected", {
          message: volvoPositionsResponse.reason?.message,
          status: volvoPositionsResponse.reason?.response?.status,
          data: volvoPositionsResponse.reason?.response?.data,
        });
      } else {
        console.log("[VOLVO /vehiclepositions] fulfilled", { count: volvoPositionsResponse.value?.length ?? 0 });
      }

      let volvoMapped = [];

      const volvoVehiclesOk = volvoVehiclesResponse.status === "fulfilled";
      const volvoPositionsOk = volvoPositionsResponse.status === "fulfilled";

      if (vehicleResponse.status === "fulfilled") {
        const arr = normaliseToArray(vehicleResponse.value.data);
        existingVehicles = cacheIfNonEmpty("michelin", arr);
      } else {
        console.warn("Primary vehicle API failed — continuing");
        existingVehicles = isFresh(sourceCache.michelin.ts)
          ? sourceCache.michelin.data
          : [];
      }
      // Tag Michelin vehicles as canonical source
      existingVehicles = existingVehicles.map(v => ({
        ...v,
        __source: "michelin"
      }));

      if (blueCrystalResponse.status === "fulfilled") {
        const arr = normaliseToArray(blueCrystalResponse.value.data);
        maintenanceDetails = cacheIfNonEmpty("blueCrystal", arr);
      } else {
        console.warn("BlueCrystal API failed — continuing");
        maintenanceDetails = isFresh(sourceCache.blueCrystal.ts)
          ? sourceCache.blueCrystal.data
          : [];
      }
      if (volvoVehiclesOk && volvoPositionsOk) {
        volvoVehicles = volvoVehiclesResponse.value;
        volvoPositions = volvoPositionsResponse.value;

        const mapped = await mapVolvoVehicles(volvoVehicles, volvoPositions);
        volvoMapped = cacheIfNonEmpty("volvoMapped", mapped);
      } else {
        volvoMapped = isFresh(sourceCache.volvoMapped.ts)
          ? sourceCache.volvoMapped.data
          : [];
      }
      // Tag Volvo vehicles as canonical source    
      volvoMapped = volvoMapped.map(v => ({
        ...v,
        __source: "volvo"
      }));


      if (nightOutMetadataResult.status !== "fulfilled") {
        console.warn("Night-Out metadata from MongoDB API failed — continuing");
        nightOutMetadata = isFresh(sourceCache.nightOut.ts) ? sourceCache.nightOut.data : [];
      } else {
        nightOutMetadata = nightOutMetadataResult.value;
        sourceCache.nightOut = { ts: Date.now(), data: nightOutMetadata };
      }

      volvoDebug = {
        useMockData,
        volvoVehiclesReq: volvoVehiclesResponse.status,
        volvoPositionsReq: volvoPositionsResponse.status,
        volvoVehiclesError:
          volvoVehiclesResponse.status === "rejected"
            ? unwrapAxiosError(volvoVehiclesResponse.reason)
            : null,
        volvoPositionsError:
          volvoPositionsResponse.status === "rejected"
            ? unwrapAxiosError(volvoPositionsResponse.reason)
            : null,
        volvoVehiclesCount: volvoVehicles?.length ?? 0,
        volvoPositionsCount: volvoPositions?.length ?? 0,
        volvoMappedCount: volvoMapped?.length ?? 0,
        volvoAuthPresent: !!(volvoUsername && volvoPassword),
      };

      vehicles = [
        ...existingVehicles,
        ...volvoMapped
      ];
    }

    // Data normalization
    const nightOutMap = nightOutMetadata.reduce((acc, item) => {
      acc[item.assetName.trim().toUpperCase()] = true; // if assetName exits, its a Night-Out
      return acc;
    }, {});

    // Merge data
    const mergedVehicles = await Promise.all(
      vehicles.map(async (vehicle) => {
        const normalisedAssetName = vehicle.assetName
          .replace(/\s+/g, "")
          .toUpperCase();

        // Match BlueCrystal data
        const maintenance = maintenanceDetails.find(
          (m) =>
            m.VehicleId.replace(/\s+/g, "").toUpperCase() ===
            normalisedAssetName
        );

        // Check if the vehicle is "driving"
        if (
          vehicle.eventType === "driving" &&
          nightOutMap[normalisedAssetName]
        ) {
          // Remove Night-Out status in MongoDB
          await VehicleMetadata.deleteOne({ assetName: normalisedAssetName });
          nightOutMap[normalisedAssetName] = false; // Update in-memory map
        }

        const site = matchGeofenceSite(vehicle.latitude, vehicle.longitude);

        const depotByText =
          site?.key === "AVONMOUTH" || site?.key === "BELLSHILL"
            ? null
            : matchDepotByText(vehicle);

        return {
          ...vehicle,
          depotMatch: depotByText ?? null,
          locationGroupName: depotByText ? "Buffaload" : vehicle.locationGroupName,
          ServiceDueDate: maintenance?.ServiceDueDate || "N/A",
          MotDueDate: maintenance?.MotDueDate || "N/A",
          IsVor: maintenance?.IsVor ?? false,
          LiveDefects: maintenance?.LiveDefects ?? false,
          isNightOut: !!nightOutMap[normalisedAssetName],
        };
      })
    );

    // Dedupe & canonical merge
    // Prefer Registration (present in both Michelin + Volvo) → VIN → assetName
    const normalizeKey = (val) =>
      String(val ?? "").replace(/\s+/g, "").toUpperCase().trim();

    const getVehicleKey = (v) => {
      const reg = normalizeKey(v.assetRegistration);
      if (reg) return `REG:${reg}`;

      const vin = normalizeKey(v.assetVin);
      if (vin) return `VIN:${vin}`;

      const name = normalizeKey(v.assetName);
      if (name) return `NAME:${name}`;

      return null;
    };

    // Michelin is canonical, Volvo is enrichment
    const mergeMichelinAndVolvo = (a, b) => {
      const michelin = a.__source === "michelin" ? a : b;
      const volvo = a.__source === "volvo" ? a : b;

      // If both exist, Michelin always wins for operational state
      if (michelin && volvo) {
        return {
          ...michelin,

          // Take Volvo GNSS only if Michelin is missing it
          latitude: michelin.latitude ?? volvo.latitude,
          longitude: michelin.longitude ?? volvo.longitude,

          // Never allow Volvo driving to override Michelin stopped
          eventType: michelin.eventType ?? volvo.eventType,
          status: michelin.status ?? volvo.status,

          __mergedFrom: ["michelin", "volvo"]
        };
      }

      // Only one source exists
      return a.__source === "michelin" ? a : b;
    };

    const dedupedMap = new Map();

    for (const vehicle of mergedVehicles) {
      const key = getVehicleKey(vehicle);
      if (!key) continue;

      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, vehicle);
      } else {
        const existing = dedupedMap.get(key);
        dedupedMap.set(key, mergeMichelinAndVolvo(existing, vehicle));
      }
    }

    const dedupedVehicles = Array.from(dedupedMap.values());
    const hasMichelin = existingVehicles.length > 0;
    const isComplete = !REQUIRE_MICHELIN_COMPLETE || hasMichelin;

    
    if (forceDebug) {
      res.set("X-Debug-Info", JSON.stringify(volvoDebug));
      res.set("X-Source-Debug", JSON.stringify({
        ...sourceDebug,
        counts: {
          michelin: existingVehicles.length,
          volvoMapped: (Array.isArray(sourceCache.volvoMapped.data) ? sourceCache.volvoMapped.data.length : 0),
          blueCrystal: maintenanceDetails.length,
          returned: dedupedVehicles.length
        },
        requireMichelinComplete: REQUIRE_MICHELIN_COMPLETE
      }));
    }

    // Only let a COMPLETE response update the "combined" cache
    if (dedupedVehicles.length > 0 && isComplete) {
      sourceCache.combined = { ts: Date.now(), data: dedupedVehicles };
    }

    // If Michelin is missing (incomplete) but we have a recent complete cache, serve that instead
    if (!isComplete && isFresh(sourceCache.combined?.ts) && sourceCache.combined.data?.length) {
      res.set("X-Partial-Data", "1");
      res.set("X-Served-From", "combined-cache");
      return res.json(sourceCache.combined.data);
    }

    res.json(dedupedVehicles);
  } catch (err) {
    if (forceDebug) {
      return res.status(500).json({
        message: "Failed to fetch vehicle data.",
        error: err?.message ?? String(err),
        name: err?.name,
        stack: err?.stack,
        _debug: volvoDebug ?? {},
      });
    }
    console.error("Error fetching vehicles:", err.message);
    res.status(500).json({ message: "Failed to fetch vehicle data." });
  }
});

router.patch("/:assetName/night-out", async (req, res) => {
  const { assetName } = req.params;
  const { isNightOut } = req.body;

  try {
    const normalisedAssetName = assetName.trim().toUpperCase();

    if (isNightOut) {
      const result = await VehicleMetadata.updateOne(
        { assetName: normalisedAssetName },
        { $set: { assetName: normalisedAssetName, isNightOut: true } },
        { upsert: true } // Create a new document if it doesn't exist
      );

      console.log("Night-Out enabled:", result);
      res
        .status(200)
        .json({ message: `Night-Out status set for ${assetName}.` });
    } else {
      const result = await VehicleMetadata.deleteOne({
        assetName: normalisedAssetName,
      });

      if (result.deletedCount > 0) {
        console.log("Night-Out disabled:", result);
        res
          .status(200)
          .json({ message: `Night-Out status removed for ${assetName}` });
      } else {
        res.status(404).json({ message: "Vehicle not found" });
      }
    }
  } catch (error) {
    console.error("Error updating Night-Out status:", error);
    res.status(500).json({ message: "Failed to update Night-Out status." });
  }
});

export default router;
