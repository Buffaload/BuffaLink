import express from "express";
import axios from "axios";
import crypto from "crypto";
import pLimit from "p-limit";
import https from "https";
import auth from "../middleware/auth.js";
import diagnostics from "../middleware/diagnostics.js";
import VehicleMetadata from "../models/VehicleMetadata.js";
import SourceSnapshot from "../models/SourceSnapshot.js";
import { depotVisibilityRules } from "../config/visibilityRules.js";
import connectDb from "../lib/connectDb.js";

// Keep-alive agent for your main upstream APIs
const upstreamHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  keepAliveMsecs: 10_000,
});

// No keep-alive for Nominatim (prevents socket reuse + listener stacking)
const nominatimHttpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 5,
});

const VOLVO_BASE_URLS = {
  vehicle: "https://api.volvotrucks.com/vehicle",
};

const VOLVO_ACCEPT = {
  vehicles: "application/x.volvogroup.com.vehicles.v1.0+json",
  positions: "application/x.volvogroup.com.vehiclepositions.v1.0+json",
};

// Create a single reusable Volvo axios client (avoid per-request listener accumulation)
const createVolvoAxios = (baseURL) => {
  const volvoUsername = process.env.VOLVO_USERNAME;
  const volvoPassword = process.env.VOLVO_PASSWORD;

  return axios.create({
    baseURL,
    auth: { username: volvoUsername, password: volvoPassword },
    timeout: 4000,
    httpsAgent: upstreamHttpsAgent,
  });
};

const volvoClients = {
  vehicle: createVolvoAxios(VOLVO_BASE_URLS.vehicle),
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
  {
    key: "PYMOOR",
    name: "Buffaload Pymoor",
    group: "Maintenance",
    latitude: 52.455170,
    longitude: 0.201258,
    radius: 500,
  },
  {
    key: "WELLINGBOROUGH_VOLVO",
    name: "Wellingborough Volvo center",
    group: "Maintenance",
    latitude: 52.318713,
    longitude: -0.686575,
    radius: 400,
  },
  {
    key: "SCANIA_ABERDEEN",
    name: "Scania Aberdeen",
    group: "Maintenance",
    latitude: 57.112122,
    longitude: -2.075225,
    radius: 400,
  },
  {
    key: "KELTRUCK_WEST_BROMWICH",
    name: "Keltruck West Bromwich",
    group: "Maintenance",
    latitude: 52.509001,
    longitude: -1.975058,
    radius: 400,
  },
  {
    key: "KELTRUCK_TAMWORTH_VMU",
    name: "Keltruck Tamworth VMU",
    group: "Maintenance",
    latitude: 52.605860,
    longitude: -1.678003,
    radius: 400,
  },
  {
    key: "KELTRUCK_TAMWORTH",
    name: "Keltruck Tamworth",
    group: "Maintenance",
    latitude: 52.5991012,
    longitude: -1.629504,
    radius: 400,
  },
  {
    key: "SCANIA_AVONMOUTH",
    name: "Scania Avonmouth",
    group: "Maintenance",
    latitude: 51.50277104548086,
    longitude: -2.6895769368768163,
    radius: 400,
  },
  {
    key: "KELTRUCK_CARDIFF",
    name: "Keltruck Cardiff",
    group: "Maintenance",
    latitude: 51.4583277,
    longitude: -3.1988332,
    radius: 400,
  },
  {
    key: "KELTRUCK_BURTON",
    name: "Keltruck Burton-on-Trent",
    group: "Maintenance",
    latitude: 52.7988684,
    longitude: -1.6665118,
    radius: 400,
  },
  {
    key: "SCANIA_DUMFRIES",
    name: "Scania Dumfries",
    group: "Maintenance",
    latitude: 55.0900107,
    longitude: -3.5634246,
    radius: 400,
  },
  {
    key: "SCANIA_EXETER",
    name: "Scania Exeter",
    group: "Maintenance",
    latitude: 50.6985128,
    longitude: -3.520116,
    radius: 400,
  },
  {
    key: "SCANIA_HULL",
    name: "Scania Hull",
    group: "Maintenance",
    latitude: 53.7252593,
    longitude: -0.4171706,
    radius: 400,
  },
  {
    key: "SCANIA_INVERNESS",
    name: "Scania Inverness",
    group: "Maintenance",
    latitude: 57.4932097,
    longitude: -4.2200161,
    radius: 400,
  },
  {
    key: "SCANIA_LEEDS",
    name: "Scania Leeds",
    group: "Maintenance",
    latitude: 53.7733876,
    longitude: -1.5876252,
    radius: 400,
  },
  {
    key: "SCANIA_MAIDSTONE",
    name: "Scania Maidstone",
    group: "Maintenance",
    latitude: 51.30239873796766,
    longitude: 0.514459726786716,
    radius: 400,
  },
  {
    key: "TRUCKEAST_MILTON_KEYNES",
    name: "TruckEast Milton Keynes",
    group: "Maintenance",
    latitude: 52.0171318,
    longitude: -0.748872,
    radius: 400,
  },
  {
    key: "SCANIA_EUROCENTRAL",
    name: "Scania Eurocentral",
    group: "Maintenance",
    latitude: 55.8301937,
    longitude: -3.9893406,
    radius: 400,
  },
  {
    key: "SCANIA_NEWCASTLE",
    name: "Scania Newcastle-upon-Tyne",
    group: "Maintenance",
    latitude: 55.040933,
    longitude: -1.586324,
    radius: 400,
  },
  {
    key: "KELTRUCK_NEWARK",
    name: "Keltruck Newark",
    group: "Maintenance",
    latitude: 53.0820209,
    longitude: -0.7913822,
    radius: 400,
  },
  {
    key: "SCANIA_FAREHAM",
    name: "Scania Fareham",
    group: "Maintenance",
    latitude: 50.8711907,
    longitude: -1.2604107,
    radius: 400,
  },
  {
    key: "SCANIA_GATWICK",
    name: "Scania Gatwick",
    group: "Maintenance",
    latitude: 51.0695464,
    longitude: -0.2038482,
    radius: 400,
  },
  {
    key: "SCANIA_PURFLEET",
    name: "Scania Purfleet",
    group: "Maintenance",
    latitude: 51.486425,
    longitude: 0.2406036,
    radius: 400,
  },
  {
    key: "SCANIA_SHEFFIELD",
    name: "Scania Sheffield",
    group: "Maintenance",
    latitude: 53.4026755,
    longitude: -1.4319138,
    radius: 400,
  },
  {
    key: "SCANIA_SWINDON",
    name: "Scania Swindon",
    group: "Maintenance",
    latitude: 51.558286244414795,
    longitude: -1.7235724222264581,
    radius: 400,
  },
  {
    key: "SCANIA_HEATHROW",
    name: "Scania Heathrow",
    group: "Maintenance",
    latitude: 51.4556783,
    longitude: -0.4590869,
    radius: 400,
  },
  {
    key: "SCANIA_NORMANTON",
    name: "Scania Normanton",
    group: "Maintenance",
    latitude: 53.7038247,
    longitude: -1.3995925,
    radius: 400,
  },
  {
    key: "VOLVO_SHEPTON_MALLET",
    name: "Volvo Truck & Bus Shepton Mallet",
    group: "Maintenance",
    latitude: 51.1904274,
    longitude: -2.4282878,
    radius: 400,
  },
  {
    key: "VOLVO_AVONMOUTH",
    name: "Volvo Truck & Bus Avonmouth",
    group: "Maintenance",
    latitude: 51.5175266,
    longitude: -2.6498952,
    radius: 400,
  },
  {
    key: "VOLVO_CAMBRIDGE",
    name: "Volvo Truck & Bus Cambridge",
    group: "Maintenance",
    latitude: 52.386649,
    longitude: 0.2283469,
    radius: 400,
  },
  {
    key: "VOLVO_LONDON_SOUTH",
    name: "Volvo Truck & Bus London South",
    group: "Maintenance",
    latitude: 51.376628591127925,
    longitude: -0.12258359353511178,
    radius: 400,
  },
  {
    key: "VOLVO_COVENTRY",
    name: "Volvo Truck & Bus Coventry",
    group: "Maintenance",
    latitude: 52.3676012,
    longitude: -1.471546,
    radius: 400,
  },
  {
    key: "VOLVO_LONDON_NORTH",
    name: "Volvo Truck & Bus London North",
    group: "Maintenance",
    latitude: 51.67966779184931,
    longitude: -0.033170360958891865,
    radius: 400,
  },
  {
    key: "VOLVO_FELIXSTOWE",
    name: "Volvo Truck & Bus Felixstowe",
    group: "Maintenance",
    latitude: null,
    longitude: null,
    radius: 400,
  },
  {
    key: "VOLVO_BURY_ST_EDMUNDS",
    name: "Volvo Truck & Bus Bury St Edmunds",
    group: "Maintenance",
    latitude: 52.1674907,
    longitude: 0.5867222,
    radius: 400,
  },
  {
    key: "VOLVO_IPSWICH",
    name: "Volvo Truck & Bus Ipswich",
    group: "Maintenance",
    latitude: 52.0294194,
    longitude: 1.2055671,
    radius: 400,
  },
  {
    key: "VOLVO_LOUGHBOROUGH_BODYSHOP",
    name: "Volvo Truck & Bus Loughborough Body & Paint",
    group: "Maintenance",
    latitude: 52.7794412,
    longitude: -1.2216953,
    radius: 400,
  },
  {
    key: "VOLVO_LEICESTER",
    name: "Volvo Truck & Bus Leicester",
    group: "Maintenance",
    latitude: 52.7003191,
    longitude: -1.3336583,
    radius: 400,
  },
  {
    key: "VOLVO_MILTON_KEYNES",
    name: "Volvo Truck & Bus Milton Keynes",
    group: "Maintenance",
    latitude: 52.09129291013452,
    longitude: -0.46890717824725675,
    radius: 400,
  },
  {
    key: "VOLVO_GLASGOW_EAST",
    name: "Volvo Truck & Bus Glasgow East",
    group: "Maintenance",
    latitude: 55.7903459,
    longitude: -4.0717734,
    radius: 400,
  },
  {
    key: "VOLVO_WELLINGBOROUGH",
    name: "Volvo Truck & Bus Wellingborough",
    group: "Maintenance",
    latitude: 52.3035073,
    longitude: -0.7403679,
    radius: 400,
  },
  {
    key: "VOLVO_NEWPORT",
    name: "Volvo Truck & Bus Newport",
    group: "Maintenance",
    latitude: 51.5755941,
    longitude: -2.954042,
    radius: 400,
  },
  {
    key: "VOLVO_NORWICH",
    name: "Volvo Truck & Bus Norwich",
    group: "Maintenance",
    latitude: 52.6440121,
    longitude: 1.2614792,
    radius: 400,
  },
  {
    key: "VOLVO_BANBURY",
    name: "Volvo Truck & Bus Banbury",
    group: "Maintenance",
    latitude: null,
    longitude: null,
    radius: 400,
  },
  {
    key: "VOLVO_PETERBOROUGH",
    name: "Volvo Truck & Bus Peterborough",
    group: "Maintenance",
    latitude: 52.5438291,
    longitude: -0.2560728,
    radius: 400,
  },
  {
    key: "VOLVO_READING",
    name: "Volvo Truck & Bus Reading",
    group: "Maintenance",
    latitude: 51.4226345,
    longitude: -0.9755152,
    radius: 400,
  },
  {
    key: "VOLVO_SWANSEA",
    name: "Volvo Truck & Bus Swansea",
    group: "Maintenance",
    latitude: 51.65508875891232,
    longitude: -3.9022715656723257,
    radius: 400,
  },
  {
    key: "VOLVO_BRIDGWATER",
    name: "Volvo Truck & Bus Bridgwater",
    group: "Maintenance",
    latitude: 51.1518652,
    longitude: -2.9879281,
    radius: 400,
  },
  {
    key: "VOLVO_HEATHROW",
    name: "Volvo Truck & Bus London Heathrow",
    group: "Maintenance",
    latitude: 51.50176959795407,
    longitude: -0.40733755306888786,
    radius: 400,
  },
  {
    key: "VOLVO_EVESHAM",
    name: "Volvo Truck & Bus Evesham",
    group: "Maintenance",
    latitude: 52.07238373693834,
    longitude: -1.9345091726056425,
    radius: 400,
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

// Normalise IDs for cross‑API matching (BlueCrystal / Michelin / Volvo)
const normalizeId = (val) =>
  String(val ?? "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();

const MAINTENANCE_TEXT_OVERRIDES = [
  /BUFFALOAD\s+PYMOOR/i,
  /VOLVO.*WELLINGBOROUGH/i,
];

const matchesMaintenanceByText = (vehicle) => {
  const hay = normalizeText(
    [
      vehicle?.locationName,
      vehicle?.formattedAddress,
      vehicle?.locationGroupName,
    ].filter(Boolean).join(" ")
  );

  return MAINTENANCE_TEXT_OVERRIDES.some((re) => re.test(hay));
};

const DEPOT_TEXT_MATCHERS = [
  { 
    depot: "Ellington", 
    patterns: [
      [/GROVE LANE/i, /PE28\s?0DA/i], 
      [/BUFFALOAD/i, /ELLINGTON/i],
    ],
  },
  { 
    depot: "Crewe", 
    patterns: [
      [/14\s*GATEWAY/i, /CW1\s?6YY/i],
      [/BUFFALOAD/i, /CREWE/i],
    ],
  },
  { 
    depot: "Skelmersdale", 
    patterns: [
      [/GILLIBRAND/i, /WN8\s?9TA/i],
      [/EAST\s+GILLIBRAND/i, /INDUSTRIAL/i],
      [/BUFFALOAD/i, /SKELMERSDALE/i],
    ],
  },
  { 
    depot: "Coventry", 
    patterns: [
      [/CENTRAL\s*BLVD/i, /CV6\s?4BX/i],
      [/CO-OP/i, /COVENTRY/i],
      [/COOP/i, /COVENTRY/i],
    ],
  },
  { 
    depot: "Bellshill", 
    patterns: 
    [
      [/SHOLTO/i, /ML4\s?3LX/i],
      [/RIGHEAD/i, /INDUSTRIAL/i],
      [/BUFFALOAD/i, /BELLSHILL/i],
    ],
  },
  {
    depot: "Avonmouth",
    patterns: [
      [/POPLAR\s*WAY/i, /BS11\s?0YW/i],
      [/CO-OP/i, /AVONMOUTH/i],
      [/COOP/i, /AVONMOUTH/i],
    ],
  },
];

const matchDepotByText = (vehicle) => {
  const hay = normalizeText(
    `${vehicle.locationName ?? ""} ${vehicle.formattedAddress ?? ""}`
  );

  for (const entry of DEPOT_TEXT_MATCHERS) {
    const matches = entry.patterns.some(patternSet =>
      patternSet.every(re => re.test(hay))
    );

    if (matches) return entry.depot;
  }

  return null;
};

const MAINTENANCE_DUE_FIELDS = [
  { key: "MotDueDate", label: "MOT" },
  { key: "BrakeDueDate", label: "Brake test" },
  { key: "AncillaryOneDueDate", label: "Loaded brake test" },
  { key: "TlWeightDueDate", label: "Weight test" },
  { key: "TachoDueDate", label: "Tacho" },
  { key: "TailDueDate", label: "Tail lift" },
  { key: "FridgeDueDate", label: "Fridge" }, 
  { key: "RflDueDate", label: "FGAS" },
  { key: "LolerDueDate", label: "LOLER" },
  { key: "AncillaryTwoDueDate", label: "Ancillary 2" },
];

const MICHELIN_MIN_EXPECTED = Number(process.env.MICHELIN_MIN_EXPECTED ?? 250);
const MICHELIN_MIN_COMPLETE_RATIO = Number(process.env.MICHELIN_MIN_COMPLETE_RATIO ?? 0.92);
const MICHELIN_MIN_KEY_OVERLAP_RATIO = Number(process.env.MICHELIN_MIN_KEY_OVERLAP_RATIO ?? 0.85);

const getMichelinKey = (v) => {
  const reg = normalizeId(v?.assetRegistration);
  if (reg) return `REG:${reg}`;

  const name = normalizeId(v?.assetName);
  if (name) return `NAME:${name}`;

  return null;
};

const isMichelinPayloadComplete = (rows) => {
  const filtered = filterMichelinRows(rows);

  const currentCount = filtered.length;
  const cachedRows = Array.isArray(sourceCache.michelin.data)
    ? sourceCache.michelin.data
    : [];
  const cachedCount = cachedRows.length;

  const meetsFloor = currentCount >= MICHELIN_MIN_EXPECTED;

  const meetsRatio =
    cachedCount === 0
      ? true
      : currentCount >= Math.floor(cachedCount * MICHELIN_MIN_COMPLETE_RATIO);

  let overlapRatio = 1;
  if (cachedCount > 0) {
    const prevKeys = new Set(cachedRows.map(getMichelinKey).filter(Boolean));
    const currKeys = new Set(filtered.map(getMichelinKey).filter(Boolean));

    let overlap = 0;
    for (const key of currKeys) {
      if (prevKeys.has(key)) overlap++;
    }
    overlapRatio = currKeys.size === 0 ? 0 : overlap / currKeys.size;
  }

  const meetsOverlap = overlapRatio >= MICHELIN_MIN_KEY_OVERLAP_RATIO;

  const ok = currentCount > 0 && meetsFloor && meetsRatio && meetsOverlap;

  let reason = "ok";
  if (currentCount === 0) reason = "empty";
  else if (!meetsFloor) reason = "below-min-expected";
  else if (!meetsRatio) reason = "below-cached-ratio";
  else if (!meetsOverlap) reason = "low-key-overlap";

  return {
    ok,
    filtered,
    reason,
    currentCount,
    cachedCount,
    minimumExpected: MICHELIN_MIN_EXPECTED,
    minimumRatio: MICHELIN_MIN_COMPLETE_RATIO,
    overlapRatio,
    minimumOverlapRatio: MICHELIN_MIN_KEY_OVERLAP_RATIO,
  };
};

const filterMichelinRows = (rows) => {
  return (Array.isArray(rows) ? rows : []).filter((v) => getMichelinKey(v));
};

function parseMs(dateString) {
  if (!dateString) return null;
  const ms = Date.parse(dateString);
  return Number.isNaN(ms) ? null : ms;
}

// "Most urgent" = smallest (dueMs - todayMs). Overdue becomes negative → more urgent.
function computeNextMaintenanceDue(maintenance, assetType) {
  if (!maintenance) return { type: null, dueDate: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const isTrailer = String(assetType).toLowerCase() === "trailer";
  let best = null;

  for (const { key, label } of MAINTENANCE_DUE_FIELDS) {
    if (!isTrailer && (key === "TlWeightDueDate" || key === "TailDueDate" || key === "FridgeDueDate" || key === "RflDueDate" || key === "LolerDueDate")) {
      continue;
    }
    const raw = maintenance[key];
    const dueMs = parseMs(raw);
    if (dueMs == null) continue;

    const delta = dueMs - todayMs;
    if (!best || delta < best.delta) {
      best = { type: label, dueDate: raw, delta };
    }
  }

  return best ? { type: best.type, dueDate: best.dueDate } : { type: null, dueDate: null };
}

// Reverse geocode tuning (avoid 429 + Vercel timeouts)
const REVERSE_GEOCODE_ENABLED =
  String(process.env.REVERSE_GEOCODE_ENABLED ?? "0") === "1"; // default OFF
const REVERSE_GEOCODE_PRECISION = Number(process.env.REVERSE_GEOCODE_PRECISION ?? 3); // ~110m grid
const REVERSE_GEOCODE_BUDGET = Number(process.env.REVERSE_GEOCODE_BUDGET ?? 10); // max calls/request
const REVERSE_GEOCODE_COOLDOWN_MS = Number(process.env.REVERSE_GEOCODE_COOLDOWN_MS ?? 15 * 60 * 1000);
let reverseGeocodeDisabledUntil = 0;
// Limit concurrent reverse-geocode HTTP calls (lower concurrency helps)
const reverseGeocodeLimit = pLimit(Number(process.env.REVERSE_GEOCODE_CONCURRENCY ?? 2));
// Simple in-memory cache (24h)
const reverseGeocodeCache = new Map();
const REVERSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function reverseGeocode(lat, lon) {
  if (Date.now() < reverseGeocodeDisabledUntil) return null;

  // Coarser grid => fewer unique keys => fewer HTTP calls
  const key = `${lat.toFixed(REVERSE_GEOCODE_PRECISION)},${lon.toFixed(REVERSE_GEOCODE_PRECISION)}`;
  const cached = reverseGeocodeCache.get(key);
  if (cached && Date.now() - cached.ts < REVERSE_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const { data } = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      httpsAgent: nominatimHttpsAgent,
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
      timeout: 2500, // keep it short to avoid serverless runtime blowups
    });

    const name =
      data?.name ??
      data?.address?.supermarket ??
      data?.address?.road ??
      data?.address?.industrial ??
      data?.display_name ??
      null;

    if (name) reverseGeocodeCache.set(key, { ts: Date.now(), value: name });
    return name;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) {
      console.warn("Reverse geocode rate-limited (429). Cooling down.");
      reverseGeocodeDisabledUntil = Date.now() + REVERSE_GEOCODE_COOLDOWN_MS;
      return null;
    }
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
  maxPages = 10,
  label = path,
}) {
  const all = [];
  let pageParams = {};
  let guard = 0;
  const seenPageParams = new Set();

  while (guard++ < maxPages) {
    const pageKey = JSON.stringify(pageParams ?? {});

    if (seenPageParams.has(pageKey)) {
      console.warn(`[Volvo pagination] Stopping repeated page params for ${label}`, {
        pageParams,
        fetchedCount: all.length,
      });
      break;
    }

    seenPageParams.add(pageKey);

    const headers = accept ? { Accept: accept } : undefined;

    const resp = await axiosInstance.get(path, {
      params: {
        ...params,
        ...pageParams,
        requestId: makeRequestId(),
      },
      ...(headers ? { headers } : {}),
      timeout: 4000,
    });

    const items = extractItems(resp.data) || [];
    all.push(...items);

    const more = Boolean(resp.data?.moreDataAvailable);
    if (!more || items.length === 0) break;

    pageParams =
      typeof getNextPageParam === "function"
        ? getNextPageParam({ respData: resp.data, items })
        : {};

    if (!pageParams || Object.keys(pageParams).length === 0) break;
  }

  if (guard >= maxPages) {
    console.warn(`[Volvo pagination] Hit maxPages for ${label}`, {
      maxPages,
      fetchedCount: all.length,
    });
  }

  return all;
}

async function fetchVolvoOnce({
  axiosInstance,
  path,
  params,
  accept,
  extractItems,
}) {
  const resp = await axiosInstance.get(path, {
    params: { ...(params ?? {}), requestId: makeRequestId() },
    headers: { Accept: accept },
    timeout: 10000,
  });

  return typeof extractItems === "function" ? (extractItems(resp.data) ?? []) : resp.data;
}

const SOURCE_CACHE_TTL_MS = Number(process.env.SOURCE_CACHE_TTL_MS ?? 120000);
const SOURCE_CACHE_MAX_STALE_MS = Number(process.env.SOURCE_CACHE_MAX_STALE_MS ?? 1800000);
const MICHELIN_RETRY_ATTEMPTS = Number(process.env.MICHELIN_RETRY_ATTEMPTS ?? 1); // 1 retry => 2 total tries
const BLUE_RETRY_ATTEMPTS = Number(process.env.BLUE_RETRY_ATTEMPTS ?? 0);
const REQUIRE_MICHELIN_COMPLETE = String(process.env.REQUIRE_MICHELIN_COMPLETE ?? "1") === "1";
const REQUIRE_BLUECRYSTAL_COMPLETE = String(process.env.REQUIRE_BLUECRYSTAL_COMPLETE ?? "1") === "1";
const BLUECRYSTAL_MIN_EXPECTED = Number(
  process.env.BLUECRYSTAL_MIN_EXPECTED ?? 200
);
const BLUECRYSTAL_MIN_COMPLETE_RATIO = Number(
  process.env.BLUECRYSTAL_MIN_COMPLETE_RATIO ?? 0.85
);

const sourceCache = {
  michelin: { ts: 0, data: [] },
  volvoMapped: { ts: 0, data: [] },
  blueCrystal: { ts: 0, data: [] },
  nightOut: { ts: 0, data: [] },
  combined: { ts: 0, data: [] },
};

const isUsableStale = (ts) => Date.now() - ts <= SOURCE_CACHE_MAX_STALE_MS;

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

const filterBlueCrystalRows = (rows) => {
  return (Array.isArray(rows) ? rows : []).filter(
    (m) =>
      typeof m?.VehicleId === "string" &&
      !m.Category?.toLowerCase().includes("equipment") &&
      m.Archived === false
  );
};

const isBlueCrystalPayloadComplete = (rows) => {
  const filtered = filterBlueCrystalRows(rows);
  if (!REQUIRE_BLUECRYSTAL_COMPLETE) {
    return {
      ok: true,
      filtered,
      reason: "completeness-check-disabled",
      currentCount: filtered.length,
      cachedCount: Array.isArray(sourceCache.blueCrystal.data)
        ? sourceCache.blueCrystal.data.length
        : 0,
      minimumExpected: BLUECRYSTAL_MIN_EXPECTED,
      minimumRatio: BLUECRYSTAL_MIN_COMPLETE_RATIO,
    };
  }

  const currentCount = filtered.length;
  const cachedCount = Array.isArray(sourceCache.blueCrystal.data)
    ? sourceCache.blueCrystal.data.length
    : 0;

  const meetsFloor = currentCount >= BLUECRYSTAL_MIN_EXPECTED;

  // If there is no good cache yet, use the absolute floor only.
  const meetsRatio =
    cachedCount === 0
      ? true
      : currentCount >= Math.floor(cachedCount * BLUECRYSTAL_MIN_COMPLETE_RATIO);

  const ok = currentCount > 0 && meetsFloor && meetsRatio;

  let reason = "ok";
  if (currentCount === 0) {
    reason = "empty-after-filter";
  } else if (!meetsFloor) {
    reason = "below-min-expected";
  } else if (!meetsRatio) {
    reason = "below-cached-ratio";
  }

  return {
    ok,
    filtered,
    reason,
    currentCount,
    cachedCount,
    minimumExpected: BLUECRYSTAL_MIN_EXPECTED,
    minimumRatio: BLUECRYSTAL_MIN_COMPLETE_RATIO,
  };
};

const router = express.Router();

// CORS (route-level)
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ??
  "https://buffalink.vercel.app,http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Fetch vehicles from external API
router.get("/", auth, diagnostics, async (req, res) => {
  // console.log("MODEL DB:", VehicleMetadata.db?.name);
  // console.log("MODEL NATIVE DB:", VehicleMetadata.db?.db?.databaseName);
  // console.log("MODEL COLLECTION:", VehicleMetadata.collection?.name);

  let blueCrystalIntegrity = {
    ok: false,
    reason: "initial",
    currentCount: 0,
    cachedCount: 0,
    minimumExpected: BLUECRYSTAL_MIN_EXPECTED,
    minimumRatio: BLUECRYSTAL_MIN_COMPLETE_RATIO,
    servedFrom: "none",
  };

  let michelinIntegrity = {
    ok: false,
    reason: "initial",
    currentCount: 0,
    cachedCount: 0,
    minimumExpected: MICHELIN_MIN_EXPECTED,
    minimumRatio: MICHELIN_MIN_COMPLETE_RATIO,
    servedFrom: "none",
  };

  const forceDebug =
    req.user?.role === "admin" &&
    String(req.query.forceDebug ?? "") === "1";
  const debug = forceDebug || Boolean(res.locals.debug);
  
  res.set("X-ForceDebug-Query", String(req.query.forceDebug ?? ""));
  res.set("X-ForceDebug-Enabled", String(forceDebug));

  try {
    await connectDb();
    console.log("Authenticated request from user:", req.user);

    // Environment detection: Use NODE_ENV or check for dummy URLs
    // const useMockData = process.env.NODE_ENV !== 'production' ||
    //                    process.env.API_URL?.includes('dummy') ||
    //                    process.env.BLUECRYSTAL_API_URL?.includes('dummy');
    const useMockData = false;

    let vehicles = [];
    let existingVehicles = [];
    let maintenanceDetails = [];
    let maintenanceByVehicleId = new Map();
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

      const safeGet = (url, config) => {
        if (!url) {
          return Promise.reject(new Error("Missing required URL env var"));
        }
        return axios.get(url, {
          httpsAgent: upstreamHttpsAgent,
          timeout: 5000,
          ...config,
        });
      };

      // Mapping for Volvo fuel type codes to human-readable names
      const mapVolvoFuelType = (codes) => {
        if (!codes) return null;

        const arr = Array.isArray(codes) ? codes : [String(codes)];
        const fuelCodeMap = {
          "1A": "Diesel",
        };

        return arr.map((code) => fuelCodeMap[code] ?? code);
      };

      const mapVolvoVehicles = async (volvoVehicles, volvoPositions) => {
        const posByVin = new Map((volvoPositions ?? []).map((p) => [p.vin, p]));
        let budget = REVERSE_GEOCODE_BUDGET;

        const mapped = await Promise.all(
          (volvoVehicles ?? []).map(async (v) => {
            const p = posByVin.get(v.vin);
            if (!p?.gnssPosition) return null;
            const gnss = p.gnssPosition;
            const lat = gnss.latitude;
            const lon = gnss.longitude;
            if (lat == null || lon == null) return null;

            // Determine moving/stopped + mph conversion
            const rawSpeedVal = p.wheelBasedSpeed ?? gnss.speed ?? 0;
            const rawSpeedNum = Number(rawSpeedVal ?? 0);

            let speedMph = null;
            if (Number.isFinite(rawSpeedNum)) {
              speedMph =
                rawSpeedNum <= 50
                  ? Math.round(rawSpeedNum * 2.2369362920544 * 10) / 10 // m/s -> mph
                  : Math.round(rawSpeedNum * 0.621371 * 10) / 10; // km/h -> mph
            }

            const MOVING_THRESHOLD = 1;
            const isMoving = Number.isFinite(rawSpeedNum) && rawSpeedNum > MOVING_THRESHOLD;

            const site = matchGeofenceSite(lat, lon);

            const reg = v?.volvoGroupVehicle?.registrationNumber;
            const fuelType = mapVolvoFuelType(v.possibleFuelType);

            let reverseName = null;
            if (REVERSE_GEOCODE_ENABLED && !site && !isMoving && budget > 0) {
              budget -= 1;
              reverseName = await reverseGeocodeLimit(() => reverseGeocode(lat, lon));
            }

            return {
              assetVin: v.vin,
              assetName: reg ?? v.vin,
              assetRegistration: reg || undefined,
              assetType: "HGV",
              assetGroupName: "HGVs",
              energyType: v.energyType ?? null,
              fuelType,
              speed: speedMph ?? undefined,
              rawSpeed: Number.isFinite(rawSpeedNum) ? rawSpeedNum : undefined,
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
        );

        return mapped.filter(Boolean);
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
            axiosInstance: volvoClients.vehicle,
            path: "/vehicles",
            params: { additionalContent: "VOLVOGROUPVEHICLE" },
            accept: VOLVO_ACCEPT.vehicles,
            extractItems: (data) => data?.vehicleResponse?.vehicles,
            getNextPageParam: ({ items }) => ({ lastVin: items?.[items.length - 1]?.vin }),
          }),
          fetchVolvoPaged({
            axiosInstance: volvoClients.vehicle,
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
        const arr = normaliseToArray(vehicleResponse.value.data) ?? [];
        const assessed = isMichelinPayloadComplete(arr);

        michelinIntegrity = {
          ...assessed,
          servedFrom: assessed.ok ? "fresh-michelin" : "michelin-cache-or-partial",
        };

        if (assessed.ok) {
          existingVehicles = assessed.filtered;
          sourceCache.michelin = {
            ts: Date.now(),
            data: assessed.filtered,
          };
        } else {
          console.warn("[Michelin] Partial/incomplete payload detected — refusing to overwrite cache", {
            reason: assessed.reason,
            currentCount: assessed.currentCount,
            cachedCount: assessed.cachedCount,
            minimumExpected: assessed.minimumExpected,
            minimumRatio: assessed.minimumRatio,
            overlapRatio: assessed.overlapRatio,
            minimumOverlapRatio: assessed.minimumOverlapRatio,
          });

          if (sourceCache.michelin.data.length > 0) {
            existingVehicles = sourceCache.michelin.data;
            michelinIntegrity.servedFrom = "michelin-cache";
          } else {
            existingVehicles = assessed.filtered;
            michelinIntegrity.servedFrom = "fresh-michelin-partial";
          }
        }
      } else {
        console.warn("Primary Michelin API failed — continuing");

        if (sourceCache.michelin.data.length > 0) {
          existingVehicles = sourceCache.michelin.data;
          michelinIntegrity = {
            ok: false,
            reason: "request-failed-using-cache",
            currentCount: 0,
            cachedCount: sourceCache.michelin.data.length,
            servedFrom: "michelin-cache",
          };
        } else {
          existingVehicles = [];
          michelinIntegrity = {
            ok: false,
            reason: "request-failed-no-cache",
            currentCount: 0,
            cachedCount: 0,
            servedFrom: "none",
          };
        }
      }

      // Tag Michelin vehicles as canonical source
      existingVehicles = existingVehicles.map(v => ({
        ...v,
        __source: "michelin"
      }));

      if (blueCrystalResponse.status === "fulfilled") {
        const arr = normaliseToArray(blueCrystalResponse.value.data) ?? [];

        const assessed = isBlueCrystalPayloadComplete(arr);
        blueCrystalIntegrity = {
          ...assessed,
          servedFrom: assessed.ok ? "fresh-bluecrystal" : "bluecrystal-cache-or-fresh-partial",
        };

        if (assessed.ok) {
          // Only cache BlueCrystal when it looks complete enough
          maintenanceDetails = assessed.filtered;
          sourceCache.blueCrystal = {
            ts: Date.now(),
            data: assessed.filtered,
          };
        } else {
          console.warn("[BlueCrystal] Partial/incomplete payload detected — refusing to overwrite cache", {
            reason: assessed.reason,
            currentCount: assessed.currentCount,
            cachedCount: assessed.cachedCount,
            minimumExpected: assessed.minimumExpected,
            minimumRatio: assessed.minimumRatio,
          });

          // Prefer last known good BlueCrystal cache
          if (isFresh(sourceCache.blueCrystal.ts) && sourceCache.blueCrystal.data.length > 0) {
            maintenanceDetails = sourceCache.blueCrystal.data;
            blueCrystalIntegrity.servedFrom = "bluecrystal-cache";
          } else {
            // No cache available — fall back to current filtered response
            // so the endpoint still works, but do NOT treat it as "complete"
            maintenanceDetails = assessed.filtered;
            blueCrystalIntegrity.servedFrom = "fresh-bluecrystal-partial";
          }
        }

        // Build O(1) lookup by VehicleId from whichever maintenanceDetails we decided to trust
        maintenanceByVehicleId.clear();
        for (const m of maintenanceDetails) {
          const key = normalizeId(m?.VehicleId);
          if (key) maintenanceByVehicleId.set(key, m);
        }
      } else {
        console.warn("BlueCrystal API failed — continuing");

        if (isFresh(sourceCache.blueCrystal.ts) && sourceCache.blueCrystal.data.length > 0) {
          maintenanceDetails = sourceCache.blueCrystal.data;
          blueCrystalIntegrity = {
            ok: false,
            reason: "request-failed-using-cache",
            currentCount: 0,
            cachedCount: sourceCache.blueCrystal.data.length,
            minimumExpected: BLUECRYSTAL_MIN_EXPECTED,
            minimumRatio: BLUECRYSTAL_MIN_COMPLETE_RATIO,
            servedFrom: "bluecrystal-cache",
          };
        } else {
          maintenanceDetails = [];
          blueCrystalIntegrity = {
            ok: false,
            reason: "request-failed-no-cache",
            currentCount: 0,
            cachedCount: 0,
            minimumExpected: BLUECRYSTAL_MIN_EXPECTED,
            minimumRatio: BLUECRYSTAL_MIN_COMPLETE_RATIO,
            servedFrom: "none",
          };
        }

        maintenanceByVehicleId.clear();
        for (const m of maintenanceDetails) {
          const key = normalizeId(m?.VehicleId);
          if (key) maintenanceByVehicleId.set(key, m);
        }
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

        // DEBUG: show duplicate VehicleMetadata docs that normalize to the same key
        const groupedMetadata = new Map();

        for (const item of nightOutMetadata) {
          const key = normalizeId(item?.assetName);
          if (!key) continue;

          if (!groupedMetadata.has(key)) {
            groupedMetadata.set(key, []);
          }

          groupedMetadata.get(key).push({
            _id: String(item._id),
            assetName: item.assetName,
            branchId: item.branchId ?? null,
            isNightOut: Boolean(item.isNightOut),
            lastEventType: item.lastEventType ?? null,
          });
        }

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
        volvoAuthPresent: !!(process.env.VOLVO_USERNAME && process.env.VOLVO_PASSWORD),
      };

      vehicles = [
        ...existingVehicles,
        ...volvoMapped
      ];
    }

    // Data normalization
    const nightOutMap = nightOutMetadata.reduce((acc, item) => {
      const key = normalizeId(item?.assetName);
      if (!key) return acc;
      acc[key] = {
        isNightOut: Boolean(item?.isNightOut),
        branchId: item?.branchId ?? null,
      };
      return acc;
    }, {});

    const metadataMap = new Map();

    for (const item of nightOutMetadata) {
      const key = normalizeId(item?.assetName);
      if (!key) continue;

      const existing = metadataMap.get(key);

      const merged = {
        branchId:
          existing?.branchId != null
            ? existing.branchId // ALWAYS preserve existing if valid
            : item?.branchId ?? null,

        isNightOut:
          Boolean(existing?.isNightOut) ||
          Boolean(item?.isNightOut),

        lastEventType:
          existing?.lastEventType ??
          item?.lastEventType ??
          null,
      };

      metadataMap.set(key, merged);
    }

    // Merge data
    const mergedVehicles = await Promise.all(
      vehicles.map(async (vehicle) => {
        const normalisedAssetName = normalizeId(vehicle.assetName);
        const normalisedReg = normalizeId(vehicle.assetRegistration);

        // Match BlueCrystal data
        const maintenance = 
          maintenanceByVehicleId.get(normalisedReg) ||
          maintenanceByVehicleId.get(normalisedAssetName) ||
          null;

        const nextMaint = computeNextMaintenanceDue(maintenance, vehicle.assetType);

        const bcBranchId = maintenance?.BranchID ?? null;

        const ownershipKey = 
          normalizeId(maintenance?.VehicleId) ||
          normalisedReg ||
          normalisedAssetName;
        const meta = ownershipKey ? metadataMap.get(ownershipKey) : null;
        const branchId = bcBranchId ?? meta?.branchId ?? null;
        const isNightOut = meta?.isNightOut ?? false;

        // Check if the vehicle is "driving"
        const nightOutEntry = nightOutMap[normalisedAssetName];

        if (vehicle.eventType === "driving" && nightOutEntry?.isNightOut) {
          await VehicleMetadata.updateOne(
            { assetName: normalisedAssetName },
            { $set: { isNightOut: false } }
          );

          nightOutMap[normalisedAssetName] = {
            ...nightOutEntry,
            isNightOut: false,
          };
        }

        const site = matchGeofenceSite(vehicle.latitude, vehicle.longitude);
        const maintenanceByText = matchesMaintenanceByText(vehicle);
        const depotByGeo =
          site?.group === "Buffaload"
            ? site.key // e.g. "BELLSHILL"
            : null;
        const depotByText =
          maintenanceByText ||
            site?.group === "Maintenance"
              ? null
              : matchDepotByText(vehicle);
        const resolvedDepot = depotByGeo ?? depotByText ?? null;
        const resolvedLocationGroup =
          maintenanceByText || site?.group === "Maintenance"
            ? "Maintenance"
            : (depotByGeo || depotByText)
              ? "Buffaload"
              : vehicle.locationGroupName;

        return {
          ...vehicle,
          depotMatch: resolvedDepot,
          locationName:
            site?.name ??
            vehicle.locationName ??
            vehicle.formattedAddress ??
            "Unknown location",
          locationGroupName: resolvedLocationGroup,
          ServiceDueDate: maintenance?.ServiceDueDate || "N/A",
          MotDueDate: maintenance?.MotDueDate || "N/A",
          BrakeDueDate: maintenance?.BrakeDueDate || "N/A",         
          TlWeightDueDate: maintenance?.TlWeightDueDate ?? "N/A",
          TachoDueDate: maintenance?.TachoDueDate ?? "N/A",
          TailDueDate: maintenance?.TailDueDate ?? "N/A",
          FridgeDueDate: maintenance?.FridgeDueDate ?? "N/A",
          RflDueDate: maintenance?.RflDueDate ?? "N/A",
          LolerDueDate: maintenance?.LolerDueDate ?? "N/A",
          AncillaryOneDueDate: maintenance?.AncillaryOneDueDate ?? "N/A",
          AncillaryTwoDueDate: maintenance?.AncillaryTwoDueDate ?? "N/A",
          NextMaintenanceType: nextMaint.type ?? "N/A",
          NextMaintenanceDueDate: nextMaint.dueDate ?? "N/A",
          IsVor: maintenance?.IsVor ?? false,
          LiveDefects: maintenance?.LiveDefects ?? false,
          Archived: maintenance?.Archived ?? null,
          branchId,
          isNightOut,
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

          // Preserve Volvo enrichment fields
          assetVin: michelin.assetVin ?? volvo.assetVin,
          fuelType: michelin.fuelType ?? volvo.fuelType,
          energyType: michelin.energyType ?? volvo.energyType,
          // speed from Volvo mapped into mph (enrichment)
          speed: michelin.speed ?? volvo.speed,
          rawSpeed: michelin.rawSpeed ?? volvo.rawSpeed,

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

    const visibleVehicles = dedupedVehicles.filter((v) => {
      const key =
        normalizeId(v.assetRegistration) ||
        normalizeId(v.assetName);

      const maintenance = maintenanceByVehicleId.get(key);

      // Remove archived vehicles from the visible list
      return !!maintenance;
    });

    const michelinComplete =
      !REQUIRE_MICHELIN_COMPLETE || michelinIntegrity.ok;
    const blueCrystalComplete =
      !REQUIRE_BLUECRYSTAL_COMPLETE || blueCrystalIntegrity.ok;
    const isComplete = michelinComplete && blueCrystalComplete;

    if (forceDebug) {
      res.set("X-Debug-Info", JSON.stringify(volvoDebug));
      res.set(
        "X-Source-Debug",
        JSON.stringify({
          ...sourceDebug,
          counts: {
            michelin: existingVehicles.length,
            volvoMapped: Array.isArray(sourceCache.volvoMapped.data)
              ? sourceCache.volvoMapped.data.length
              : 0,
            blueCrystal: maintenanceDetails.length,
            returned: dedupedVehicles.length,
          },
          requireMichelinComplete: REQUIRE_MICHELIN_COMPLETE,
          requireBlueCrystalComplete: REQUIRE_BLUECRYSTAL_COMPLETE,
          michelinIntegrity,
          blueCrystalIntegrity,
          overallComplete: isComplete,
        })
      );
    }

    // Only allow fully complete responses to refresh the in-memory cache
    if (dedupedVehicles.length > 0 && isComplete) {
      sourceCache.combined = {
        ts: Date.now(),
        data: dedupedVehicles,
      };

      return res.json(visibleVehicles);
    }

    // If the current response is incomplete, prefer the last known complete combined cache
    if (!isComplete) {
      // Try in-memory cache first
      if (
        sourceCache.combined?.data?.length &&
        isUsableStale(sourceCache.combined.ts)
      ) {
        res.set("X-Partial-Data", "1");
        res.set("X-Served-From", "combined-cache");
        return res.json(sourceCache.combined.data);
      }

      // Then try Mongo snapshot
      try {
        const mongoSnapshot = await SourceSnapshot.findOne(
          { key: "combined" },
          { data: 1, _id: 0 }
        ).lean();

        if (mongoSnapshot?.data?.length) {
          res.set("X-Partial-Data", "1");
          res.set("X-Served-From", "mongo-snapshot");
          return res.json(mongoSnapshot.data);
        }
      } catch (err) {
        console.warn(
          "[Mongo Snapshot] Failed to read combined snapshot",
          err.message
        );
      }

      // No fallback available — return current partial data, but flag it
      res.set("X-Partial-Data", "1");
      res.set(
        "X-Served-From",
        michelinIntegrity.servedFrom || blueCrystalIntegrity.servedFrom || "partial-live"
      );
      return res.json(visibleVehicles);
    }

    // Final successful response
    return res.json(visibleVehicles);
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

router.patch("/:assetName/night-out", auth, async (req, res) => {
  await connectDb();

  const { assetName } = req.params;
  const { isNightOut } = req.body;

  try {
    const normalisedAssetName = normalizeId(assetName);

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
      const result = await VehicleMetadata.updateOne(
        { assetName: normalisedAssetName },
        { $set: { isNightOut: false } },
        { upsert: true } // ensure doc exists; preserve branchId if already present
      );

      res.status(200).json({ message: `Night-Out status removed for ${assetName}` });
    }
  } catch (error) {
    console.error("Error updating Night-Out status:", error);
    res.status(500).json({ message: "Failed to update Night-Out status." });
  }
});

export const getCombinedVehicleCache = () => sourceCache.combined;
export default router;

