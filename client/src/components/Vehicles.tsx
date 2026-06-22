import React, { useEffect, useMemo, useState, useRef } from "react";
import { filterVehicles, adjustedMs, useVehiclesWithStatusSince, isEligibleKioskVehicle, isCriticalArrival } from "../utils/vehicleRules";
import { ALL_DEPOT_LABELS, matchesDepot, getMatchedDepotLabel } from "../utils/depotMatching";
import { dedupeVehiclesByIdentity } from "../utils/vehicleIdentity";
import api from "../api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Building2,
  Bug,
  TriangleAlert,
  CircleCheckBig,
  ChevronUp,
  Image,
  Moon,
} from "lucide-react";
import L from "leaflet";
import "../css/Vehicles.css";
import InlineLoader from "./InlineLoader";
import API_BASE_URL from "../config";

// Define the type for a single vehicle object
interface Vehicle {
  id?: string;
  assetName: string;
  assetRegistration?: string;
  locationName?: string;
  formattedAddress?: string;
  eventType: string;
  date: string;
  locationGroupName?: string;
  branchId?: string | number;
  depotMatch?: string | null;
  assetGroupName?: string;
  assetType?: string;
  // New fields from BlueCrystal API
  ServiceDueDate?: string;
  MotDueDate?: string;
  BrakeDueDate?: string;
  TlWeightDueDate?: string;
  TachoDueDate?: string;
  FridgeDueDate?: string;
  RflDueDate?: string;
  LolerDueDate?: string;
  AncillaryOneDueDate?: string;
  AncillaryTwoDueDate?: string;
  NextMaintenanceType?: string;
  NextMaintenanceDueDate?: string;
  IsVor?: boolean;
  LiveDefects?: boolean;
  isNightOut?: boolean;
  latitude?: number;
  longitude?: number;
  temperature?: number;
  assetVin?: string;
  energyType?: string;
  fuelType?: string[];
  status?: string;
  speed?: number;
  engineTotalHours?: number;
  engineHours?: number;
  odometer?: number;
  totalVehicleDistance?: number;
  driverName?: string;
  driverGroupName?: string;
}
interface VehiclesProps {
  filterOption: string;
  selectedDepots: string[];
  isKioskMode: boolean;
  onKioskStatsChange?: (stats: {
    total: number;
    red: number;
    orange: number;
    yellow: number;
    green: number;
  }) => void;
}

const LOCATION_DEPOTS_EVENT = "buffalink:locationDepotsChanged";
const SERVICE_TIMELINE_DAYS_KEY = "buffalink:serviceTimelineDays";
const MOT_TIMELINE_DAYS_KEY = "buffalink:motTimelineDays";
const DEFAULT_SERVICE_TIMELINE_DAYS = 42;
const DEFAULT_MOT_TIMELINE_DAYS = 364;
const LAST_GOOD_VEHICLES_KEY = "buffalink:lastGoodVehicles";
const SUSPICIOUS_DROP_RATIO = 0.9; // treat >10% drop as suspicious unless backend explicitly says it's valid

const getServiceTimelineDays = () =>
  Number(localStorage.getItem(SERVICE_TIMELINE_DAYS_KEY)) ||
  DEFAULT_SERVICE_TIMELINE_DAYS;

const getMotTimelineDays = () =>
  Number(localStorage.getItem(MOT_TIMELINE_DAYS_KEY)) ||
  DEFAULT_MOT_TIMELINE_DAYS;

const readLastGoodVehicles = (): Vehicle[] => {
  try {
    const raw = localStorage.getItem(LAST_GOOD_VEHICLES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLastGoodVehicles = (vehicles: Vehicle[]) => {
  try {
    localStorage.setItem(LAST_GOOD_VEHICLES_KEY, JSON.stringify(vehicles));
  } catch {
    // ignore storage/quota errors
  }
};

// ISO week number (Monday–Sunday)
function getISOWeek(date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // ISO day of week: Mon=1 ... Sun=7
  const dayNum = d.getUTCDay() || 7;
  // Shift date to Thursday of this ISO week
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  // ISO week-year start
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate week number
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getISOWeekYear(date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

// Start of ISO week (Monday 00:00 UTC) for stable week-diff math
function startOfISOWeekUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseDateSafe(dateString?: string): Date | null {
  const raw = (dateString ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// ISO-week difference: 0 = this week, 1 = next week, 2 = in 2 weeks, etc.
function getISOWeekDiffFromToday(dueDate: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisWeekStart = startOfISOWeekUTC(today).getTime();
  const dueWeekStart = startOfISOWeekUTC(dueDate).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  return Math.round((dueWeekStart - thisWeekStart) / msPerWeek);
}

type VehiclesMemoResult = {
  categoryVehicles: VehicleWithSince[];
  displayVehicles: VehicleWithSince[];
  highlightFigures: {
    total: number;
    vor: number;
  };
};

type ServiceDueISOInfo = {
  dueWeek: number;
  dueWeekYear: number;
  weekDiff: number;      // 0=this ISO week, 1=next ISO week, etc.
  isOverdue: boolean;    // overdue by date (not just week)
};

function getServiceDueISOInfo(dateString?: string): ServiceDueISOInfo | null {
  const dueDate = parseDateSafe(dateString);
  if (!dueDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return {
    dueWeek: getISOWeek(dueDate),
    dueWeekYear: getISOWeekYear(dueDate),
    weekDiff: getISOWeekDiffFromToday(dueDate),
    isOverdue: dueDate.getTime() < today.getTime(),
  };
}

// Card colour rules for service due urgency
function getServiceDueCardClass(dateString?: string): string {
  const info = getServiceDueISOInfo(dateString);
  if (!info) return "";

  // Red: due this ISO week OR overdue
  if (info.isOverdue || info.weekDiff <= 0) return "pastel-red";
  // Orange: due next ISO week
  if (info.weekDiff === 1) return "pastel-orange";
  // Yellow: due in 2 ISO weeks
  if (info.weekDiff === 2) return "pastel-yellow";

  return "";
}

const getServiceSeverityProgressClass = (dateString?: string) => {
  const severity = getServiceDueCardClass(dateString);

  switch (severity) {
    case "pastel-red":
      return "progress-red";     // due this ISO week or overdue
    case "pastel-orange":
      return "progress-orange";  // due next ISO week
    case "pastel-yellow":
      return "progress-yellow";  // due in 2 ISO weeks
    default:
      return "progress-green";   // anything beyond
  }
};

function formatWeeksUntilDueLabel(info: ServiceDueISOInfo): string {
  if (info.isOverdue) return "OVERDUE";
  if (info.weekDiff === 0) return "Due this week";
  const w = Math.max(0, info.weekDiff);
  return `${w} week${w === 1 ? "" : "s"} until due`;
}

function formatDueISOWeekWithYear(info: ServiceDueISOInfo): string {
  const now = new Date();
  const currentISOYear = getISOWeekYear(now);

  return info.dueWeekYear !== currentISOYear
    ? `ISO week ${info.dueWeek} (${info.dueWeekYear})`
    : `ISO week ${info.dueWeek}`;
}

// Helper function to format date from BlueCrystal data
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0"); // Ensures day is always two digits
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Month is zero-based, hence why I add 1
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

// Helper function to check if the date is older than today
const isDatePast = (dateString: string) => {
  if (!dateString) return false;

  const date = new Date(dateString.trim());
  if (isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of today to avoid time issues

  return date < today; // Returns true if the date is in the past
};

const hasAssetName = (
  v: { assetName?: string }
): v is { assetName: string } => {
  return typeof v.assetName === "string" && v.assetName.length > 0;
};

const formatRegistration = (value?: string): string => {
  if (!value) return "";
  const reg = value.trim();
  // Only act on exactly 7 characters with no existing space
  if (reg.length === 7 && !reg.includes(" ")) {
    return `${reg.slice(0, 4)} ${reg.slice(4)}`;
  }

  return reg;
};

const formatRegForMarkerLabel = (value?: string) => {
  const raw = (value ?? "").trim();
  if (!raw) return "N/A";

  // If already has a space (e.g. "AV20 OAY"), convert to line break
  if (raw.includes(" ")) {
    const [a, ...rest] = raw.split(" ");
    return `${a}<br/>${rest.join(" ")}`;
  }

  if (raw.length === 7) {
    return `${raw.slice(0, 4)}<br/>${raw.slice(4)}`;
  }

  return raw;
};

const getVehicleDisplayLabel = (v: {
  assetType?: string;
  assetName?: string;
  assetRegistration?: string;
}): string => {
  const isTrailer = String(v.assetType ?? "").toLowerCase() === "trailer";
  const base = isTrailer
    ? (v.assetName ?? v.assetRegistration ?? "")
    : (v.assetRegistration ?? v.assetName ?? "");
  return base
    ? (isTrailer ? base : formatRegistration(base))
    : "UNKNOWN VEHICLE";
};

const isVorOrDefect = (v: { IsVor?: any; LiveDefects?: any }): boolean => {
  const toBool = (value: any): boolean => {
    if (value === true) return true;
    if (value === false || value == null) return false;

    if (typeof value === "number") {
      return value === 1;
    }

    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      if (["true", "1", "y", "yes"].includes(s)) return true;
      if (["false", "0", "n", "no", ""].includes(s)) return false;

      return false;
    }

    return false;
  };

  return toBool(v.IsVor) || toBool(v.LiveDefects);
};

const toBool = (value: any): boolean => {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "1", "y", "yes"].includes(s)) return true;
    return false;
  }
  return false;
};

// Helper function for percentage calculation and color coding for service/MOT due dates
const getProgressColorClass = (percentage: number) => {
  if (percentage < 33.33) return "progress-red";
  if (percentage < 66.66) return "progress-orange";
  return "progress-green";
};

// Remove trailing <_2> from UI written locations
const cleanLocationLabel = (value?: string | null): string => {
  if (!value) return "UNKNOWN LOCATION";
  return value.replace(/_\d+$/, "");
};

const getDepotDisplayName = (depot?: string | null): string => {
  if (!depot) return "UNKNOWN LOCATION";

  const name = titleCaseWords(depot.trim());

  if (["Coventry", "Avonmouth"].includes(name)) {
    return `Co-op ${name}`;
  }

  return `Buffaload ${name}`;
};

const normalizeLocationSortValue = (value?: string | null): string => {
  return cleanLocationLabel(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
};

const isUnknownLocationLabel = (value?: string | null): boolean => {
  const normalized = normalizeLocationSortValue(value);
  return (
    !normalized ||
    normalized === "UNKNOWN LOCATION" ||
    normalized === "UNKNOWN LOCATIONS"
  );
};

const getVehicleLocationDisplayLabel = (
  vehicle: Vehicle,
  filterOption: string
): string => {
  if (filterOption === "Depots") {
    const depotMatch = getMatchedDepotLabel(vehicle);
    if (depotMatch) {
      return getDepotDisplayName(depotMatch);
    }
  }

  return cleanLocationLabel(
    vehicle.locationName ?? vehicle.formattedAddress ?? "UNKNOWN LOCATION"
  );
};

const compareByLocation = (
  a: VehicleWithSince,
  b: VehicleWithSince,
  filterOption: string,
  sortDirection: "asc" | "desc"
): number => {
  const aLabel = getVehicleLocationDisplayLabel(a, filterOption);
  const bLabel = getVehicleLocationDisplayLabel(b, filterOption);

  const aUnknown = isUnknownLocationLabel(aLabel);
  const bUnknown = isUnknownLocationLabel(bLabel);

  // Always pin unknowns to the bottom
  if (aUnknown !== bUnknown) {
    return aUnknown ? 1 : -1;
  }

  let result = normalizeLocationSortValue(aLabel).localeCompare(
    normalizeLocationSortValue(bLabel),
    undefined,
    { numeric: true, sensitivity: "base" }
  );

  // Stable fallback
  if (result === 0) {
    const aReg = (a.assetRegistration ?? a.assetName ?? "").toUpperCase();
    const bReg = (b.assetRegistration ?? b.assetName ?? "").toUpperCase();

    result = aReg.localeCompare(bReg, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  return sortDirection === "asc" ? result : -result;
};

const isNilLike = (v: any) =>
  v == null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  v === "N/A" ||
  (typeof v === "string" && v.trim().toUpperCase() === "N/A");

const displayText = (v: any, fallback = "Not available") => {
  if (isNilLike(v)) return fallback;
  if (typeof v === "string") return v.trim();
  return String(v);
};

const displayNumber = (v: any, suffix = "", fallback = "—") => {
  if (isNilLike(v) || !Number.isFinite(Number(v))) return fallback;
  const n = Number(v);
  return `${n}${suffix}`;
};

const formatDateSafe = (dateString?: string, fallback = "Not available") => {
  const d = parseDateSafe(dateString);
  if (!d) return fallback;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const titleCaseWords = (input: string) =>
  input
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

const formatVehicleType = (assetType?: string) => {
  const raw = (assetType ?? "").trim();
  if (!raw) return "Not available";

  // HGV should stay uppercase
  if (raw.toUpperCase() === "HGV") return "HGV";

  // Everything else (e.g. TRAILER) → Trailer
  return humanizeEnum(raw);
};

const humanizeEnum = (input?: string) => {
  const raw = (input ?? "").trim();
  if (!raw) return "Not available";
  // BI_FUEL -> Bi Fuel, ICE -> Ice
  return titleCaseWords(raw.replace(/_/g, " ").toLowerCase());
};

const humanizeFuel = (fuel?: string[] | string) => {
  if (!fuel) return "Not available";
  if (Array.isArray(fuel)) {
    if (fuel.length === 0) return "Not available";
    return fuel.map((f) => humanizeEnum(f)).join(", ");
  }
  return humanizeEnum(fuel);
};

const humanizeStatus = (input?: string) => {
  const raw = (input ?? "").trim();
  if (!raw) return "Not available";

  // endOfJourney -> end Of Journey
  const spaced = raw
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");

  // Title-case with common small-words lowercased (except first word)
  const small = new Set(["of", "and", "the", "to", "in", "on", "at", "for", "from"]);
  const words = spaced.split(" ").filter(Boolean);

  return words
    .map((w, idx) => {
      const lower = w.toLowerCase();
      if (idx !== 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
};

const humanizeDriverName = (name?: string) => {
  const raw = (name ?? "").trim();
  if (!raw) return "Driver not assigned";

  return raw
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) =>
      part
        .split("'")
        .map(
          (seg) => seg.charAt(0).toUpperCase() + seg.slice(1)
        )
        .join("'")
    )
    .join(" ");
};

interface DueProgress {
  percentage: number;
  colorClass: string;
  label: string;
}

const getServiceDueProgress = (dateString: string): DueProgress | null => {
  if (!dateString) return null;

  const dueMs = adjustedMs(dateString.trim());
  if (isNaN(dueMs)) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilDue = Math.floor((dueMs - today.getTime()) / msPerDay);
  const isOverdue = daysUntilDue < 0;

  let percentage = 0;
  if (!isOverdue && daysUntilDue > 1) {
    const timelineDays = getServiceTimelineDays();
    percentage = Math.round(((daysUntilDue - 1) / timelineDays) * 100);
    percentage = Math.min(100, Math.max(0, percentage));
  }

  const colorClass = getProgressColorClass(percentage);
  const isoInfo = getServiceDueISOInfo(dateString);
  const label = isoInfo ? formatWeeksUntilDueLabel(isoInfo) : "";

  return { percentage, colorClass, label };
};

const getDueProgress = (dateString: string): DueProgress | null => {
  if (!dateString) return null;

  const dueMs = adjustedMs(dateString.trim());
  if (isNaN(dueMs)) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilDue = Math.floor((dueMs - today.getTime()) / msPerDay);
  const isOverdue = daysUntilDue < 0;

  let percentage = 0;
  if (!isOverdue && daysUntilDue > 1) {
    const timelineDays = getMotTimelineDays();
    percentage = Math.round(((daysUntilDue - 1) / timelineDays) * 100);
    percentage = Math.min(100, Math.max(0, percentage));
  }

  const colorClass = getProgressColorClass(percentage);

  const label = isOverdue
    ? `OVERDUE by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? "" : "s"}`
    : daysUntilDue <= 1
    ? "Due within 1 day"
    : `${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} until due`;

  return { percentage, colorClass, label };
};

type VehicleWithSince = Vehicle & {
  statusSinceMs?: number;
};

// Format "time in state" (clamps negative durations to 0)
const formatTimeInState = (sinceMs: number) => {
  const now = Date.now();
  const duration = Math.max(0, now - sinceMs); // prevents "-1 minutes ago"

  const days = Math.floor(duration / (1000 * 60 * 60 * 24));
  const hours = Math.floor((duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

  // "full duration" but still compact
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);

  return parts.join(", ");
};

const getKioskSeverityClass = (sinceMs?: number): string => {
  if (!sinceMs) return "";

  const hours = (Date.now() - sinceMs) / (1000 * 60 * 60);

  if (hours >= 4) return "pastel-red";
  if (hours >= 2) return "pastel-orange";
  if (hours >= 1) return "pastel-yellow";

  return "pastel-green";
};

const getViewportSnapshot = () => {
  if (typeof window === "undefined") {
    return {
      width: 1920,
      height: 1080,
      isPortrait: false,
    };
  }

  const visualViewport = window.visualViewport;

  const width = Math.round(
    visualViewport?.width ??
      window.innerWidth ??
      document.documentElement.clientWidth
  );

  const height = Math.round(
    visualViewport?.height ??
      window.innerHeight ??
      document.documentElement.clientHeight
  );

  return {
    width,
    height,
    isPortrait:
      window.matchMedia("(orientation: portrait)").matches || height > width,
  };
};

const KIOSK_CAROUSEL_SIDE_BREAKPOINT = 1660;
const KIOSK_BOTTOM_CAROUSEL_RESERVED_HEIGHT = 340;
const KIOSK_BOTTOM_CAROUSEL_RESERVED_HEIGHT_SMALL = 300;
const DEFAULT_KIOSK_MIN_WIDTH = 922;
const PORTRAIT_KIOSK_MIN_WIDTH = 510;

const renderStatusIcon = (rawType?: string) => {
  const type = (rawType ?? "unknown").toLowerCase();

  // Simple inline SVGs (tiny + consistent + no extra imports)
  const baseProps = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true as const,
    focusable: "false" as const,
  };

  switch (type) {
    case "stopped":
      // pause icon
      return (
        <svg {...baseProps}>
          <path d="M7 6h3v12H7V6Zm7 0h3v12h-3V6Z" fill="currentColor" />
        </svg>
      );

    case "driving":
      // arrow-right icon
      return (
        <svg {...baseProps}>
          <path
            d="M5 12h12m0 0-5-5m5 5-5 5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case "idling":
      // clock-ish icon
      return (
        <svg {...baseProps}>
          <path
            d="M12 8v5l3 2"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z"
            stroke="currentColor"
            strokeWidth="2.2"
          />
        </svg>
      );

    default:
      // dot icon
      return (
        <svg {...baseProps}>
          <path
            d="M12 12a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 0 1 3.6 0Z"
            fill="currentColor"
          />
          <path
            d="M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z"
            stroke="currentColor"
            strokeWidth="2.2"
          />
        </svg>
      );
  }
};

export const shouldApplyBranchFilter = (
  filterOption: string,
  isKioskMode: boolean
): boolean => {
  return (
    isKioskMode ||
    filterOption === "Services" ||
    filterOption === "Night-Out"
  );
};

const DEPOT_TO_BRANCH_ID: Record<string, string> = {
  ellington: "1",
  crewe: "2",
  coventry: "10",
  skelmersdale: "3",
  bellshill: "11",
  avonmouth: "4",
};

const LOCATION_DEPOT_KEYS = Object.keys(DEPOT_TO_BRANCH_ID);

const getAllowedBranchIds = (): Set<string> | null => {
  const role = (localStorage.getItem("role") ?? "").toLowerCase();
  const userDepot = (localStorage.getItem("depot") ?? "").toLowerCase();

  // Non-admin → always one depot
  if (role !== "admin") {
    const id = DEPOT_TO_BRANCH_ID[userDepot];
    return id ? new Set([id]) : new Set();
  }

  // Admin → use selected depots from location settings
  try {
    const raw = localStorage.getItem("buffalink:locationSelectedDepots");
    const parsed = raw ? JSON.parse(raw) : [];

    const normalized: string[] = Array.isArray(parsed)
      ? parsed
          .map((d: string) => d.toLowerCase().trim())
          .filter((d: string) => LOCATION_DEPOT_KEYS.indexOf(d) !== -1)
          .filter((d: string, index: number, arr: string[]) => arr.indexOf(d) === index)
      : [];

    // Nothing selected = ALL
    if (normalized.length === 0) {
      return null;
    }

    // All selectable depots selected = ALL
    const allSelected = LOCATION_DEPOT_KEYS.every((depot) => {
      return normalized.indexOf(depot) !== -1;
    });

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

const MODAL_HEALTH_FIELDS: Array<{ key: keyof Vehicle; label: string; kind: "service" | "standard" }> = [
  { key: "ServiceDueDate", label: "Service", kind: "service" },
  { key: "MotDueDate", label: "MOT", kind: "standard" },
  { key: "BrakeDueDate", label: "Brake test", kind: "standard" },
  { key: "AncillaryOneDueDate", label: "Loaded brake test", kind: "standard" },
  { key: "TlWeightDueDate", label: "Weight test", kind: "standard" },
  { key: "TachoDueDate", label: "Tacho", kind: "standard" },
  { key: "FridgeDueDate", label: "Fridge", kind: "standard" },
  { key: "RflDueDate", label: "FGAS", kind: "standard" },
  { key: "LolerDueDate", label: "LOLER", kind: "standard" },
];

const TRAILER_ONLY_HEALTH_KEYS = new Set<keyof Vehicle>([
  "FridgeDueDate",
  "RflDueDate",
  "LolerDueDate",
  "TlWeightDueDate",
]);

type DepotStreetViewRule = {
  tokens: string[]; // must ALL be present
  lat: number;
  lon: number;
};

const STREET_VIEW_DEPOTS: DepotStreetViewRule[] = [
  {
    tokens: ["BUFFALOAD", "ELLINGTON"],
    lat: 52.33577,
    lon: -0.294554,
  },
  {
    tokens: ["BUFFALOAD", "CREWE"],
    lat: 53.086336,
    lon: -2.416586,
  },
  {
    tokens: ["BUFFALOAD", "BELLSHILL"],
    lat: 55.826593,
    lon: -4.045517,
  },
  {
    tokens: ["BUFFALOAD", "SKELMERSDALE"],
    lat: 53.541459,
    lon: -2.784835,
  },
  {
    tokens: ["CO-OP", "AVONMOUTH"],
    lat: 51.522306,
    lon: -2.678811,
  },
];

function normalizeLocationText(value?: string): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const truncate = (value: string, max = 40) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

function getStreetViewLatLon(vehicle: {
  latitude?: number;
  longitude?: number;
  locationName?: string;
  formattedAddress?: string;
}) {
  const haystack = normalizeLocationText(
    vehicle.locationName ?? vehicle.formattedAddress
  );

  // Depot override (token-based)
  for (const depot of STREET_VIEW_DEPOTS) {
    if (depot.tokens.every(t => haystack.includes(t))) {
      return { lat: depot.lat, lon: depot.lon };
    }
  }

  // Fallback to live GPS
  if (
    Number.isFinite(vehicle.latitude) &&
    Number.isFinite(vehicle.longitude)
  ) {
    return {
      lat: vehicle.latitude!,
      lon: vehicle.longitude!,
    };
  }

  // Nothing usable
  return null;
}

type VehicleMiniMapProps = {
  vehicle: VehicleWithSince;
  height?: number;
  layoutKey?: string;
};

const VehicleMiniMap: React.FC<VehicleMiniMapProps> = ({
  vehicle,
  height = 180,
  layoutKey = "default",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const lat = vehicle.latitude;
    const lon = vehicle.longitude;
    const container = containerRef.current;

    if (!container || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    const coords: [number, number] = [lat!, lon!];
    const zoom = window.innerWidth < 769 ? 12.5 : 13;

    // Clean up any stale Leaflet instance before rebuilding
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Extra safety: clear any stale Leaflet DOM
    container.innerHTML = "";

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false,
      keyboard: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
    });

    mapInstanceRef.current = map;

    const tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 2,
    }).addTo(map);

    const displayReg = vehicle.assetRegistration ?? vehicle.assetName ?? "N/A";

    const marker = L.circleMarker(coords, {
      radius: 20,
      fillColor: "#6b7280",
      fillOpacity: 0.85,
      color: "#ffffff",
      weight: 2,
    }).addTo(map);

    marker.bindTooltip(formatRegForMarkerLabel(displayReg), {
      permanent: true,
      direction: "center",
      className: "vehicle-reg-tooltip",
    });

    const syncMapToContainer = () => {
      let hasOffsetApplied = false;
      const instance = mapInstanceRef.current;
      const offsetY = height * 0.15;
      
      if (!instance) return;

      instance.invalidateSize({
        pan: false,
        animate: false,
      });

      instance.setView(coords, zoom, {
        animate: false,
      });

      // Apply offset for small viewports minimap ONLY ONCE
      if (!hasOffsetApplied && window.innerWidth < 769) {
        hasOffsetApplied = true;

        instance.panBy([0, -offsetY], { animate: false });
      }
    };

    // Initial view
    map.setView(coords, zoom, { animate: false });

    // Run several times because kiosk carousel/card sizing settles over a few frames
    const raf1 = requestAnimationFrame(syncMapToContainer);
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(syncMapToContainer)
    );

    const timeout1 = window.setTimeout(syncMapToContainer, 120);
    const timeout2 = window.setTimeout(syncMapToContainer, 300);
    const timeout3 = window.setTimeout(syncMapToContainer, 500);

    const onTileLoad = () => {
      syncMapToContainer();
    };

    tileLayer.on("load", onTileLoad);

    map.whenReady(() => {
      syncMapToContainer();
    });

    let resizeObserver: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        syncMapToContainer();
      });
      resizeObserver.observe(container);
    }

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);

      window.clearTimeout(timeout1);
      window.clearTimeout(timeout2);
      window.clearTimeout(timeout3);

      tileLayer.off("load", onTileLoad);

      resizeObserver?.disconnect();

      map.remove();
      mapInstanceRef.current = null;
    };
  }, [
    vehicle.latitude,
    vehicle.longitude,
    vehicle.assetRegistration,
    vehicle.assetName,
    height,
    layoutKey,
  ]);

  if (
    !Number.isFinite(vehicle.latitude) ||
    !Number.isFinite(vehicle.longitude)
  ) {
    return (
      <div
        className="kiosk-carousel-card__map kiosk-carousel-card__map--empty"
        style={{ height }}
      >
        <div className="vehicle-modal-placeholder-title">
          No GPS location available
        </div>
        <div className="vehicle-modal-placeholder-sub">
          This vehicle has no latitude/longitude in the feed.
        </div>
      </div>
    );
  }

  const isCompactKioskMap = window.innerWidth < 769;

  return (
    <div className="kiosk-carousel-card__map" style={{ height }}>
      <div
        ref={containerRef}
        className={`kiosk-carousel-card__map-frame ${
          isCompactKioskMap ? "kiosk-carousel-card__map-frame--mobile-offset" : ""
        }`}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};

const Vehicles: React.FC<VehiclesProps> = ({
  filterOption,
  selectedDepots,
  isKioskMode,
  onKioskStatsChange,
}) => {
  const queryClient = useQueryClient();
  const [locationTick, setLocationTick] = useState(0);
  const [isVorFilterActive, setIsVorFilterActive] = useState(false);
  const [sortOption, setSortOption] = useState<"stoppedTime" | "serviceDue" | "reg" | "location">("stoppedTime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [timelineTick, setTimelineTick] = useState(0);
  void timelineTick;
  const [searchTerm, setSearchTerm] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const skeletonGridRef = useRef<HTMLUListElement | null>(null);
  const [skeletonCount, setSkeletonCount] = useState(8);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleWithSince | null>(null);
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isVehicleModalClosing, setIsVehicleModalClosing] = useState(false);
  const [maxRows, setMaxRows] = useState<number>(100);
  const [viewportInfo, setViewportInfo] = useState(() => getViewportSnapshot());
  const carouselViewportRef = useRef<HTMLDivElement | null>(null);
  const carouselGroupRef = useRef<HTMLDivElement | null>(null);
  const kioskCarouselPanelRef = useRef<HTMLDivElement | null>(null);
  const [shouldAnimateCarousel, setShouldAnimateCarousel] = useState(false);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const modalCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onLocationChanged = () => setLocationTick((t) => t + 1);
    window.addEventListener(LOCATION_DEPOTS_EVENT, onLocationChanged);
    return () =>
      window.removeEventListener(LOCATION_DEPOTS_EVENT, onLocationChanged);
  }, []);

  const scrollToTop = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;

    setShowBackToTop(el.scrollTop > 300);
  };

  useEffect(() => {
    handleScroll(); // sync visibility on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure each dashboard view starts at the true top of the vehicle container
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [filterOption, isKioskMode]);

  useEffect(() => {
    setSearchTerm("");
  }, [filterOption]);

  useEffect(() => {
    const onTimelineChanged = () => setTimelineTick((t) => t + 1);

    window.addEventListener("buffalink:timelineChanged", onTimelineChanged);
    return () => window.removeEventListener("buffalink:timelineChanged", onTimelineChanged);
  }, []);

  useEffect(() => {
    if (!isKioskMode || !scrollRef.current) return;

    const BOTTOM_BUFFER = 12;
    const TWO_COL_BREAKPOINT = 980;

    let raf = 0;

    const recalc = () => {
      const container = scrollRef.current!;
      const rect = container.getBoundingClientRect();

      const rows = Array.from(
        container.querySelectorAll(".kiosk-leaderboard-row")
      ) as HTMLElement[];

      if (rows.length === 0) {
        raf = requestAnimationFrame(recalc);
        return;
      }

      const isCompactPortrait =
        viewportInfo.width >= 510 &&
        viewportInfo.width <= 769 &&
        viewportInfo.isPortrait;

      let rowStep = isCompactPortrait ? 48 : 52;

      if (rows.length >= 2) {
        const r1 = rows[0].getBoundingClientRect();
        const r2 = rows[1].getBoundingClientRect();
        rowStep = Math.max(1, Math.round(r2.top - r1.top));
      } else {
        const r1 = rows[0].getBoundingClientRect();
        const col = container.querySelector(".kiosk-leaderboard-col") as HTMLElement | null;
        const gapStr =
          col ? (getComputedStyle(col).rowGap || getComputedStyle(col).gap) : "0px";
        const gap = Number.parseFloat(gapStr) || 0;
        rowStep = Math.max(1, Math.round(r1.height + gap));
      }

      if (isCompactPortrait) {
        rowStep = Math.min(rowStep, 48);
      }

      const viewportHeight = Math.round(
        window.visualViewport?.height ??
          window.innerHeight ??
          document.documentElement.clientHeight
      );

      const isBottomCarousel =
        viewportInfo.width <= KIOSK_CAROUSEL_SIDE_BREAKPOINT;

      const measuredCarouselHeight =
        isBottomCarousel && kioskCarouselPanelRef.current
          ? Math.ceil(kioskCarouselPanelRef.current.getBoundingClientRect().height)
          : 0;

      const reservedCarouselHeight = isBottomCarousel
        ? measuredCarouselHeight || (
            isCompactPortrait
              ? 240
              : viewportInfo.width <= TWO_COL_BREAKPOINT
                ? KIOSK_BOTTOM_CAROUSEL_RESERVED_HEIGHT_SMALL
                : KIOSK_BOTTOM_CAROUSEL_RESERVED_HEIGHT
          )
        : 0;

      const availableHeight = Math.max(
        120,
        viewportHeight - rect.top - BOTTOM_BUFFER - reservedCarouselHeight
      );

      const rowsPerColumn = Math.max(1, Math.floor(availableHeight / rowStep));
      const isTwoCol = viewportInfo.width > TWO_COL_BREAKPOINT;
      const columns = isTwoCol ? 2 : 1;

      setMaxRows(rowsPerColumn * columns);
    };

    recalc();

    window.addEventListener("resize", recalc);

    return () => {
      window.removeEventListener("resize", recalc);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isKioskMode, viewportInfo.width, viewportInfo.height, viewportInfo.isPortrait]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewport = () => {
      setViewportInfo((prev) => {
        const next = getViewportSnapshot();

        if (
          prev.width === next.width &&
          prev.height === next.height &&
          prev.isPortrait === next.isPortrait
        ) {
          return prev;
        }

        return next;
      });
    };

    updateViewport();

    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
    };
  }, []);

  const openVehicleModal = (vehicle: VehicleWithSince) => {
    lastActiveElementRef.current = document.activeElement as HTMLElement | null;
    setSelectedVehicle(vehicle);
    setIsVehicleModalOpen(true);
    setIsVehicleModalClosing(false);
  };

  const requestCloseVehicleModal = () => {
    // Allow CSS transition to animate out
    setIsVehicleModalClosing(true);
    window.setTimeout(() => {
      setIsVehicleModalOpen(false);
      setIsVehicleModalClosing(false);
      setSelectedVehicle(null);
      lastActiveElementRef.current?.focus?.();
    }, 180);
  };

  useEffect(() => {
    if (!isVehicleModalOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestCloseVehicleModal();
    };

    document.addEventListener("keydown", onKeyDown);

    // Lock background scroll
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus close button for accessibility
    window.setTimeout(() => modalCloseBtnRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isVehicleModalOpen]);

  useEffect(() => {
    if (
      !isVehicleModalOpen ||
      !selectedVehicle ||
      !Number.isFinite(selectedVehicle.latitude) ||
      !Number.isFinite(selectedVehicle.longitude)
    ) {
      return;
    }

    const map = L.map("vehicle-modal-map", {
      zoomControl: false,
      attributionControl: false,
    }).setView(
      [selectedVehicle.latitude!, selectedVehicle.longitude!],
      13
    );

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    const displayReg =
      selectedVehicle.assetRegistration ??
      selectedVehicle.assetName ??
      "N/A";

    const isMobile = window.innerWidth < 769;

    const marker = L.circleMarker(
      [selectedVehicle.latitude!, selectedVehicle.longitude!],
      {
        radius: isMobile ? 14 : 24,
        fillColor: "#6b7280",
        fillOpacity: 0.85,
        color: "#ffffff",
        weight: isMobile ? 1.5 : 2,
      }
    ).addTo(map);

    marker.bindTooltip(formatRegForMarkerLabel(displayReg), {
      permanent: true,
      direction: "center",
      className: "vehicle-reg-tooltip",
    });

    return () => {
      map.remove();
    };
  }, [isVehicleModalOpen, selectedVehicle]);

  const [nightOutToast, setNightOutToast] = useState<{
    reg: string;
    isOn: boolean;
    visible: boolean;
  } | null>(null);

  const nightOutToastTimerRef = useRef<number | null>(null);
  const nightOutToastCleanupRef = useRef<number | null>(null);

  const showNightOutToast = (reg: string, isOn: boolean) => {
    if (nightOutToastTimerRef.current) window.clearTimeout(nightOutToastTimerRef.current);
    if (nightOutToastCleanupRef.current) window.clearTimeout(nightOutToastCleanupRef.current);

    setNightOutToast({ reg, isOn, visible: true });

    nightOutToastTimerRef.current = window.setTimeout(() => {
      setNightOutToast((prev) => (prev ? { ...prev, visible: false } : prev));

      // allow CSS transition to finish before unmount
      nightOutToastCleanupRef.current = window.setTimeout(() => {
        setNightOutToast(null);
      }, 220);
    }, 10000);
  };

  const dismissNightOutToast = () => {
    if (nightOutToastTimerRef.current) {
      window.clearTimeout(nightOutToastTimerRef.current);
      nightOutToastTimerRef.current = null;
    }

    setNightOutToast((prev) => (prev ? { ...prev, visible: false } : prev));

    nightOutToastCleanupRef.current = window.setTimeout(() => {
      setNightOutToast(null);
    }, 220); // match CSS transition
  };

  useEffect(() => {
    return () => {
      if (nightOutToastTimerRef.current) window.clearTimeout(nightOutToastTimerRef.current);
      if (nightOutToastCleanupRef.current) window.clearTimeout(nightOutToastCleanupRef.current);
    };
  }, []);

  // Helpers for filtering, searching, and sorting
  const fetchVehicles = async (): Promise<Vehicle[]> => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("No token found. Please log in.");
    }

    const response = await api.get("/vehicles");

    if (response.status !== 200) {
      throw new Error("Failed to fetch vehicles");
    }

    const data = response.data;
    const arr =
      Array.isArray(data)
        ? data
        : Array.isArray(data?.vehicles)
        ? data.vehicles
        : [];

    const isPartial = response.headers?.["x-partial-data"] === "1";
    const previous = queryClient.getQueryData<Vehicle[]>(["vehicles"]) ?? [];
    const persistentLastGood = readLastGoodVehicles();

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
      console.warn("[Vehicles] Suspicious vehicle count drop detected; keeping last known good snapshot", {
        incomingCount: arr.length,
        comparisonBaseCount,
        ratio: comparisonBaseCount > 0 ? arr.length / comparisonBaseCount : null,
      });

      if (previous.length > 0) return previous;
      if (persistentLastGood.length > 0) return persistentLastGood;
    }

    // Fresh good payload - persist it
    writeLastGoodVehicles(arr);
    return arr;
  };

  // useQuery hook for fetching vehicles
  const {
    data: vehicles = [],
    isLoading,
    isFetching,
    isError,
    error,
  } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: 30000,
    staleTime: 60000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const vehiclesWithSince = useVehiclesWithStatusSince<VehicleWithSince>(vehicles);

  useEffect(() => {
    if (!isLoading) return;

    const recalcSkeletons = () => {
      const grid = skeletonGridRef.current;
      if (!grid) return;

      const width = grid.getBoundingClientRect().width;

      // Must match CSS min widths
      const minCardWidth =
        filterOption === "Critical" || filterOption === "Critical-Arrivals"
          ? 360
          : filterOption === "Depots"
          ? 320
          : 340;

      const gap = 16; // matches CSS
      const columns = Math.max(
        1,
        Math.floor((width + gap) / (minCardWidth + gap))
      );

      const rows = 2;
      setSkeletonCount(columns * rows);
    };

    recalcSkeletons();
    window.addEventListener("resize", recalcSkeletons);

    return () => window.removeEventListener("resize", recalcSkeletons);
  }, [isLoading, filterOption]);

  // Tracks when each vehicle entered its current eventType (state)
  type VehicleWithSince = Vehicle & {
    statusSinceMs?: number;
  };

  // Depot matching helpers (geofence + text/address fallback)
  const { categoryVehicles, displayVehicles, highlightFigures } = useMemo<VehiclesMemoResult>(() => {
    void locationTick;
    const now = Date.now();

    if (isKioskMode) {
      let leaderboard = vehiclesWithSince.filter((v) => isEligibleKioskVehicle(v, now));

      const allowedBranches = getAllowedBranchIds();
      if (allowedBranches !== null) {
        leaderboard = leaderboard.filter((v) => {
          if (v.branchId == null) return false;
          return allowedBranches.has(String(v.branchId));
        });
      }

      const sorted = leaderboard
        .slice()
        .sort((a, b) => {
          const aSince = a.statusSinceMs ?? now;
          const bSince = b.statusSinceMs ?? now;
          return (now - bSince) - (now - aSince);
        })
        .slice(0, maxRows);

      return {
        categoryVehicles: sorted,
        displayVehicles: sorted,
        highlightFigures: {
          total: sorted.length,
          vor: sorted.filter((v) => toBool(v.IsVor)).length,
        },
      };
    }

    let categoryVehicles: VehicleWithSince[] = [];
    if (filterOption === "Critical-Arrivals") {
      categoryVehicles = vehiclesWithSince.filter((v) => isCriticalArrival(v));
    } else {
      categoryVehicles = filterVehicles(
        vehiclesWithSince,
        filterOption,
        [],
        now
      ) as VehicleWithSince[];

      if (filterOption === "Depots") {
        const effectiveDepots =
          selectedDepots.length > 0 ? selectedDepots : ALL_DEPOT_LABELS;

        categoryVehicles = categoryVehicles.filter((v) =>
          effectiveDepots.some((d) => matchesDepot(v, d))
        );
      }
    }

    const depotFilteredVehicles =
      filterOption === "Depots" && selectedDepots.length > 0
        ? categoryVehicles.filter((v) =>
            selectedDepots.some((d) => matchesDepot(v, d))
          )
        : categoryVehicles;

    let list: VehicleWithSince[] = depotFilteredVehicles;

    if (shouldApplyBranchFilter(filterOption, isKioskMode)) {
      const allowedBranches = getAllowedBranchIds();
      if (allowedBranches !== null) {
        list = list.filter((v) => {
          if (v.branchId == null) return false;
          return allowedBranches.has(String(v.branchId));
        });
      }
    }

    if (isVorFilterActive) {
      list = list.filter(isVorOrDefect);
    }

    const normalize = (value: string | null | undefined): string =>
      (value ?? "").toLowerCase().replace(/\s+/g, "").trim();

    const q = normalize(searchTerm);
    if (q) {
      list = list.filter((v) => {
        const haystack = [
          v.assetName,
          v.assetRegistration,
          v.locationName,
          v.formattedAddress,
          v.locationGroupName ?? "",
        ]
          .map(normalize)
          .join("\n");

        return haystack.includes(q);
      });
    }

    const normalizedList = dedupeVehiclesByIdentity(list);

    const highlightFigures = {
      total: normalizedList.length,
      vor: normalizedList.filter((v) => isVorOrDefect(v)).length,
    };

    const sorted = [...normalizedList].sort((a, b) => {
      let result = 0;

      if (sortOption === "stoppedTime") {
        const aSince = a.statusSinceMs ?? (a.date ? adjustedMs(a.date) : now);
        const bSince = b.statusSinceMs ?? (b.date ? adjustedMs(b.date) : now);
        const aDur = now - aSince;
        const bDur = now - bSince;
        result = aDur - bDur;

        if (result === 0) {
          result = (a.assetName ?? "").localeCompare(b.assetName ?? "");
        }
      }

      if (sortOption === "serviceDue") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();

        const aDueMs = a.ServiceDueDate ? adjustedMs(a.ServiceDueDate.trim()) : NaN;
        const bDueMs = b.ServiceDueDate ? adjustedMs(b.ServiceDueDate.trim()) : NaN;

        const aVal = isNaN(aDueMs) ? Number.POSITIVE_INFINITY : aDueMs - todayMs;
        const bVal = isNaN(bDueMs) ? Number.POSITIVE_INFINITY : bDueMs - todayMs;

        result = aVal - bVal;
      }

      if (sortOption === "reg") {
        const aReg = (a.assetRegistration || a.assetName || "").toUpperCase();
        const bReg = (b.assetRegistration || b.assetName || "").toUpperCase();
        result = aReg.localeCompare(bReg);
      }

      if (sortOption === "location") {
        return compareByLocation(a, b, filterOption, sortDirection);
      }

      return sortDirection === "asc" ? result : -result;
    });

    return { categoryVehicles, displayVehicles: sorted, highlightFigures };
  }, [
    vehiclesWithSince,
    filterOption,
    selectedDepots,
    isVorFilterActive,
    searchTerm,
    sortOption,
    sortDirection,
    isKioskMode,
    maxRows,
    locationTick,
  ]);

  const dedupedDisplayVehicles = displayVehicles;

  const useSideKioskCarousel = viewportInfo.width > KIOSK_CAROUSEL_SIDE_BREAKPOINT;
  const topCarouselVehicles = useMemo(() => {
    if (!isKioskMode) return [];
    return dedupedDisplayVehicles.slice(0, 10);
  }, [isKioskMode, dedupedDisplayVehicles]);

  const canRenderKioskLeaderboard = useMemo(() => {
    return (
      viewportInfo.width >= DEFAULT_KIOSK_MIN_WIDTH ||
      (viewportInfo.isPortrait &&
        viewportInfo.width >= PORTRAIT_KIOSK_MIN_WIDTH)
    );
  }, [viewportInfo.width, viewportInfo.isPortrait]);

  useEffect(() => {
    if (!isKioskMode || !canRenderKioskLeaderboard  || !onKioskStatsChange) return;

    const now = Date.now();

    let red = 0;
    let orange = 0;
    let yellow = 0;
    let green = 0;

    displayVehicles.forEach((v) => {
      const since = v.statusSinceMs ?? now;
      const hours = (now - since) / (1000 * 60 * 60);

      if (hours >= 4) {
        red++;
      } else if (hours >= 2) {
        orange++;
      } else if (hours >= 1) {
        yellow++;
      } else {
        green++;
      }
    });

    onKioskStatsChange({
      total: displayVehicles.length,
      red,
      orange,
      yellow,
      green,
    });
  }, [isKioskMode, canRenderKioskLeaderboard, onKioskStatsChange, displayVehicles]);

  useEffect(() => {
    if (!isKioskMode) {
      setShouldAnimateCarousel(false);
      return;
    }

    const viewportEl = carouselViewportRef.current;
    const groupEl = carouselGroupRef.current;

    if (!viewportEl || !groupEl || topCarouselVehicles.length === 0) {
      setShouldAnimateCarousel(false);
      return;
    }

    const measure = () => {
      const isSideCarousel = viewportInfo.width > KIOSK_CAROUSEL_SIDE_BREAKPOINT;

      const viewportSize = isSideCarousel
        ? viewportEl.clientHeight
        : viewportEl.clientWidth;

      const contentSize = isSideCarousel
        ? groupEl.scrollHeight
        : groupEl.scrollWidth;

      // small tolerance avoids 1px measurement noise
      const shouldScroll = contentSize > viewportSize + 2;

      setShouldAnimateCarousel(shouldScroll);
    };

    measure();

    let resizeObserver: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        measure();
      });

      resizeObserver.observe(viewportEl);
      resizeObserver.observe(groupEl);
    }

    const handleResize = () => {
      measure();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [
    isKioskMode,
    viewportInfo.width,
    topCarouselVehicles,
  ]);

  const getTipperAlertClass = (
    vehicle: {
      eventType?: string | null;
      date?: string | null;
      statusSinceMs?: number;
      IsVor?: boolean;
    },
    filterOption: string,
    now: number
  ) => {
    if (vehicle.IsVor) return ""; // no alert if VOR
    if (filterOption !== "Tippers") return "";

    const isDriving = (vehicle.eventType ?? "").toLowerCase() === "driving";

    const sinceMs =
      typeof vehicle.statusSinceMs === "number"
        ? vehicle.statusSinceMs
        : vehicle.date
          ? adjustedMs(vehicle.date)
          : NaN;

    const safeSinceMs = Number.isFinite(sinceMs) ? sinceMs : now;
    const timeInState = Math.max(0, now - safeSinceMs);

    if (isDriving || timeInState <= 0) return ""; // moving → nothing

    if (timeInState >= 45 * 60 * 1000) return "pastel-red alert-red alert-critical";
    if (timeInState >= 15 * 60 * 1000) return "pastel-red alert-yellow";
    return "pastel-red";
  };

  // Function to toggle the Night-Out status of a vehicle
  const toggleNightOut = async (
    vehicle: {
      assetName: string;
      isNightOut?: boolean;
      assetRegistration?: string;
      assetType?: string;
    }
  ) => {
    const previousState = vehicle.isNightOut;
    const updatedState = !vehicle.isNightOut;
    const regLabel = getVehicleDisplayLabel(vehicle);

    // Optimistic update
    queryClient.setQueryData(["vehicles"], (old: any[] | undefined) =>
      old
        ? old.map((v) =>
            v.assetName === vehicle.assetName
              ? { ...v, isNightOut: updatedState }
              : v
          )
        : []
    );

    setSelectedVehicle((prev) =>
      prev && prev.assetName === vehicle.assetName
        ? { ...prev, isNightOut: updatedState }
        : prev
    );

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `${API_BASE_URL}/vehicles/${encodeURIComponent(vehicle.assetName)}/night-out`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isNightOut: updatedState }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to toggle Night-Out status");
      }

      showNightOutToast(regLabel, updatedState);

      // Re-sync with backend
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    } catch (error) {
      console.error("Error toggling Night-Out status:", error);

      // Roll back optimistic update on failure
      queryClient.setQueryData(["vehicles"], (old: any[] | undefined) =>
        old
          ? old.map((v) =>
              v.assetName === vehicle.assetName
                ? { ...v, isNightOut: previousState }
                : v
            )
          : []
      );

      setSelectedVehicle((prev) =>
        prev && prev.assetName === vehicle.assetName
          ? { ...prev, isNightOut: previousState }
          : prev
      );
    }
  };

  // Loading state
  const renderVehicleSkeletons = () => (
    <ul
      ref={skeletonGridRef}
      className={`vehicle-list ${filterOption === "Depots" ? "vehicle-list--depots" : ""} ${
        filterOption === "Critical" || filterOption === "Critical-Arrivals"
          ? "vehicle-list--critical"
          : ""
      }`}
      aria-label="Loading vehicles"
      aria-busy="true"
    >
      {Array.from({ length: skeletonCount }).map((_, i) => (
        <li key={`vehicle-skeleton-${i}`} className="vehicle-card vehicle-card--skeleton" aria-hidden="true">
          {/* Header */}
          <header className="vehicle-card__header">
            <div className="vehicle-card__title">
              <div className="skeleton skeleton--reg" />
            </div>

            <div className="vehicle-card__top-right">
              <div className="vehicle-card__chips">
                <span className="skeleton skeleton--chip" />
                <span className="skeleton skeleton--chip" />
              </div>

              {/* Mimic toggle presence (only visually) */}
              <div className="skeleton skeleton--toggle" />
            </div>
          </header>

          {/* Meta row */}
          <div className="vehicle-card__meta">
            <span className="skeleton skeleton--status" />
            <span className="skeleton skeleton--time" />
          </div>

          <div className="vehicle-card__divider" />

          {/* Health */}
          <section className="vehicle-card__health" aria-label="Vehicle compliance health loading">
            {/* Service */}
            <div className="health-block">
              <div className="health-block__row">
                <span className="skeleton skeleton--label" />
                <span className="skeleton skeleton--hint" />
              </div>
              <div className="skeleton skeleton--bar" />
              <div className="skeleton skeleton--sub" />
            </div>

            {/* Maintenance */}
            <div className="health-block">
              <div className="health-block__row">
                <span className="skeleton skeleton--label" />
                <span className="skeleton skeleton--hint" />
              </div>
              <div className="skeleton skeleton--bar" />
              <div className="skeleton skeleton--sub" />
            </div>
          </section>

          {/* Footer */}
          <footer className="vehicle-card__footer">
            <span className="skeleton skeleton--footer-label" />
            <span className="skeleton skeleton--location" />
          </footer>
        </li>
      ))}
    </ul>
  );

  // Error state
  if (isError) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to fetch vehicles.";

    return (
      <>
        <div className="vehicle-empty-state">
          <Bug className="vehicle-empty-icon" aria-hidden />
          <p className="vehicle-empty-text">{errorMessage}</p>
        </div>
      </>
    );
  }

  const renderKioskCarouselCard = (
    vehicle: VehicleWithSince,
    leaderboardPosition: number
  ) => {
    const isTrailer = (vehicle.assetType ?? "").toLowerCase() === "trailer";

    const displayId = isTrailer
      ? (vehicle.assetName ?? vehicle.assetRegistration ?? "")
      : (vehicle.assetRegistration ?? vehicle.assetName ?? "");

    const writtenAddress = displayText(
      vehicle.formattedAddress ?? vehicle.locationName,
      "Unknown location"
    );

    return (
      <article
        className={`kiosk-carousel-card ${getKioskSeverityClass(vehicle.statusSinceMs)}`}
        key={`kiosk-carousel-${vehicle.assetRegistration ?? "NO_REG"}-${vehicle.assetName}-${leaderboardPosition}`}
      >
        <header className="kiosk-carousel-card__header">
          <div className="kiosk-carousel-card__header-top">
            <span className="kiosk-carousel-card__rank">#{leaderboardPosition}</span>
            <span className="kiosk-carousel-card__reg">
              {isTrailer ? displayId : formatRegistration(displayId)}
            </span>
          </div>

          <div className="kiosk-carousel-card__header-bottom">
            <span className="status-pill status-pill--stopped">
              <span className="status-pill__icon">{renderStatusIcon("stopped")}</span>
              <span className="status-pill__text">STOPPED</span>
            </span>

            <span className="kiosk-carousel-card__time">
              {typeof vehicle.statusSinceMs === "number"
                ? formatTimeInState(vehicle.statusSinceMs)
                : vehicle.date
                ? formatTimeInState(adjustedMs(vehicle.date))
                : "--- : --- : ---"}
            </span>
          </div>
        </header>

        <div className="kiosk-carousel-card__body">
          <VehicleMiniMap
            key={`${vehicle.assetRegistration ?? vehicle.assetName}-${
              useSideKioskCarousel ? "side" : "bottom"
            }-${
              viewportInfo.width < 769
                ? "compact"
                : viewportInfo.width < 980
                ? "narrow"
                : "wide"
            }`}
            vehicle={vehicle}
            height={useSideKioskCarousel ? 180 : 140}
            layoutKey={`${
              useSideKioskCarousel ? "side" : "bottom"
            }-${
              viewportInfo.width < 769
                ? "compact"
                : viewportInfo.width < 980
                ? "narrow"
                : "wide"
            }`}
          />
        </div>

        <footer className="vehicle-modal-map-caption kiosk-carousel-card__caption">
          {writtenAddress}
        </footer>
      </article>
    );
  };

  if (isKioskMode && canRenderKioskLeaderboard) {
    const list = dedupedDisplayVehicles;
    const isCompactPortrait =
      viewportInfo.width >= 510 &&
      viewportInfo.width <= 769 &&
      viewportInfo.isPortrait;

    // Split only when NOT compact portrait
    const mid = isCompactPortrait ? list.length : Math.ceil(list.length / 2);
    const left = list.slice(0, mid);
    const right = isCompactPortrait ? [] : list.slice(mid);

    const renderRow = (vehicle: VehicleWithSince, position: number) => {
      const rawLocation =
        vehicle.locationName ?? vehicle.formattedAddress ?? "UNKNOWN LOCATION";
      const fullLocation = cleanLocationLabel(rawLocation);
      const truncatedLocation = truncate(fullLocation, 40);
      const isTrailer = (vehicle.assetType ?? "").toLowerCase() === "trailer";
      const displayId = isTrailer
        ? (vehicle.assetName ?? vehicle.assetRegistration ?? "")
        : (vehicle.assetRegistration ?? vehicle.assetName ?? "");

      return (
        <div
          className={`kiosk-leaderboard-row ${getKioskSeverityClass(vehicle.statusSinceMs!)}`}
          key={`${vehicle.assetRegistration ?? "NO_REG"}-${vehicle.assetName}`}
        >
          <div className="kiosk-leaderboard-left">
            <span className="kiosk-leaderboard-pos">{position}</span>

            <span className="kiosk-leaderboard-reg">
              {isTrailer ? displayId : formatRegistration(displayId)}
            </span>

            <span className="kiosk-leaderboard-loc" title={fullLocation}>
              {truncatedLocation}
            </span>
          </div>

          <div className="kiosk-leaderboard-time">
            {formatTimeInState(vehicle.statusSinceMs!)}
          </div>
        </div>
      );
    };

    return (
      <div
        className="kiosk-leaderboard-container kiosk-leaderboard-container--with-carousel"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {isLoading ? (
          <div className="vehicle-empty-state">
            <p className="vehicle-empty-text">Loading leaderboard…</p>
          </div>
        ) : list.length === 0 ? (
          <div className="vehicle-empty-state">
            <CircleCheckBig className="vehicle-empty-icon" aria-hidden />
            <p className="vehicle-empty-text">
              No stopped vehicles outside depots/maintenance sites
            </p>
          </div>
        ) : (
          <div
            className={`kiosk-layout ${
              useSideKioskCarousel ? "kiosk-layout--side" : "kiosk-layout--bottom"
            }`}
          >
            <section className="kiosk-main">
              <div className="kiosk-leaderboard-grid">
                <div className="kiosk-leaderboard-col">
                  {left.map((v, idx) => renderRow(v, idx + 1))}
                </div>

                {!isCompactPortrait && (
                  <div className="kiosk-leaderboard-col">
                    {right.map((v, idx) => renderRow(v, mid + idx + 1))}
                  </div>
                )}
              </div>
            </section>

            {topCarouselVehicles.length > 0 && (
              <aside
                ref={kioskCarouselPanelRef}
                className={`kiosk-carousel-panel ${
                  useSideKioskCarousel
                    ? "kiosk-carousel-panel--side"
                    : "kiosk-carousel-panel--bottom"
                }`}
                aria-label="Top 10 longest stopped vehicles"
              >
                <div className="kiosk-carousel-panel__header">
                  Top 10 longest stopped vehicles
                </div>

                <div
                  ref={carouselViewportRef}
                  className={`kiosk-carousel-viewport ${
                    useSideKioskCarousel
                      ? "kiosk-carousel-viewport--vertical"
                      : "kiosk-carousel-viewport--horizontal"
                  }`}
                >
                  <div
                    className={`kiosk-carousel-track ${
                      useSideKioskCarousel
                        ? "kiosk-carousel-track--vertical"
                        : "kiosk-carousel-track--horizontal"
                    } ${
                      shouldAnimateCarousel
                        ? "kiosk-carousel-track--animated"
                        : "kiosk-carousel-track--static"
                    }`}
                  >
                    <div
                      ref={carouselGroupRef}
                      className={`kiosk-carousel-group ${
                        useSideKioskCarousel
                          ? "kiosk-carousel-group--vertical"
                          : "kiosk-carousel-group--horizontal"
                      }`}
                    >
                      {topCarouselVehicles.map((vehicle, index) =>
                        renderKioskCarouselCard(vehicle, index + 1)
                      )}
                    </div>

                    {shouldAnimateCarousel && (
                      <div
                        className={`kiosk-carousel-group ${
                          useSideKioskCarousel
                            ? "kiosk-carousel-group--vertical"
                            : "kiosk-carousel-group--horizontal"
                        }`}
                        aria-hidden="true"
                      >
                        {topCarouselVehicles.map((vehicle, index) =>
                          renderKioskCarouselCard(vehicle, index + 1)
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
    );
  }

  const isTrailer = String(selectedVehicle?.assetType ?? "").toLowerCase() === "trailer";
  const modalHeaderSeverityClass =
    selectedVehicle
      ? getServiceDueCardClass(selectedVehicle.ServiceDueDate)
      : "";

  return (
    <>
      <div 
        className="vehicle-container" 
        ref={scrollRef}
        onScroll={handleScroll}
        >
        <div className="vehicle-inner">
          <div data-scroll-top-anchor />
          {(filterOption !== "DelaysMap" && !isKioskMode) ? (
            <div className="vehicles-wizard" aria-label="Dashboard tools">
              {/* VOR only (styled like a pill) */}
              <label className="wizard-pill wizard-vor">
                <input
                  className="wizard-checkbox"
                  type="checkbox"
                  checked={isVorFilterActive}
                  onChange={(e) => setIsVorFilterActive(e.target.checked)}
                />
                <span className="wizard-pill-text">VOR/Defects only</span>
              </label>

              {/* Sort dropdown (pill) */}
              <div className="wizard-pill wizard-sort">
                <span className="wizard-sort-label">Sort:</span>
                <select
                  className="wizard-select"
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as typeof sortOption)}
                >
                  <option value="stoppedTime">Stopped time</option>
                  <option value="serviceDue">Service due</option>
                  <option value="reg">Reg</option>
                  <option value="location">Location</option>
                </select>
              </div>

              <button
                type="button"
                className="iso-week-tooltip__sort-toggle wizard-sort-direction"
                onClick={() =>
                  setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
                }
                aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
                title={`Sort ${sortDirection === "asc" ? "Z-A" : "A-Z"}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                  className={`iso-week-tooltip__sort-icon ${sortDirection}`}
                >
                  {/* Up arrow */}
                  <path
                    d="M12 4l-5 5h10l-5-5Z"
                    fill="currentColor"
                    opacity={sortDirection === "asc" ? 1 : 0.35}
                  />
                  
                  {/* Down arrow */}
                  <path
                    d="M12 20l5-5H7l5 5Z"
                    fill="currentColor"
                    opacity={sortDirection === "desc" ? 1 : 0.35}
                  />
                </svg>
              </button>

              {/* Search bar (pill w/ icon) */}
              <div className="wizard-search">
                <svg
                  className="wizard-search-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M10 18a8 8 0 1 1 5.293-14.293A8 8 0 0 1 10 18Zm0-2a6 6 0 1 0 0-12a6 6 0 0 0 0 12Zm9.707 5.707-4.386-4.386a1 1 0 0 1 1.414-1.414l4.386 4.386a1 1 0 0 1-1.414 1.414Z"
                    fill="currentColor"
                  />
                </svg>

                <input
                  className="wizard-search-input"
                  type="text"
                  placeholder="Search reg / location..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="highlight-figures highlight-figures--dashboard" aria-label="Vehicle highlights">
                <span className="figure-pill figure-pill--grey">
                  <span className="figure-dot figure-dot--grey" aria-hidden="true" />
                  {highlightFigures.total}{" "}
                  {highlightFigures.total === 1 ? "Vehicle" : "Vehicles"}
                </span>

                <span className="figure-pill figure-pill--red">
                  <span className="figure-dot figure-dot--red" aria-hidden="true" />
                  {highlightFigures.vor} VOR/Defects
                </span>
              </div>
            </div>
          ) : null}

          {filterOption === "Depots" && !isKioskMode && (
            <div className="depots-info-banner">
              <Building2 size="16"/>
              {selectedDepots.length === 0 ? (
                <>Showing: <strong>ALL</strong></>
              ) : (
                <>
                  Showing:&nbsp; {selectedDepots.join(", ")}
                </>
              )}
            </div>
          )}

          {filterOption === "Critical" && (
            <div className="critical-info-banner">
              <TriangleAlert size="16"/>
              Showing all vehicles that are due a service/Maintenance within less than 5 days and are currently out of a depot
            </div>
          )}

          {filterOption === "Critical-Arrivals" && (
            <div className="critical-info-banner">
              <TriangleAlert size="16" />
              Showing vehicles that are due (or overdue) Maintenance and have arrived at a depot
            </div>
          )}

          {(isKioskMode) ? (
            <div className="kiosk-vehicles-wizard">
              <div className="highlight-figures" aria-label="Vehicle highlights">
                <span className="figure-pill figure-pill--grey">
                  <span className="figure-dot figure-dot--grey" aria-hidden="true" />
                  {highlightFigures.total}{" "}
                  {highlightFigures.total === 1 ? "Vehicle" : "Vehicles"}
                </span>

                <span className="figure-pill figure-pill--red">
                  <span className="figure-dot figure-dot--red" aria-hidden="true" />
                  {highlightFigures.vor} VOR
                </span>
              </div>
            </div>
          ) : null}

          {/* Check if there are filtered vehicles */}
          {isLoading ? (
            renderVehicleSkeletons()
          ) : dedupedDisplayVehicles.length === 0 ? (       
            <div className="vehicle-empty-state">
              <TriangleAlert className="vehicle-empty-icon" aria-hidden />
              <p className="vehicle-empty-text">
                {categoryVehicles.length === 0
                  ? "No stopped vehicles to show in this category"
                  : "No vehicles match your current filters (Search / VOR)"}
              </p>
            </div>
          ) : (
            <ul className={`vehicle-list ${filterOption === "Depots" ? "vehicle-list--depots" : ""} ${filterOption === "Critical" || filterOption === "Critical-Arrivals" ? "vehicle-list--critical" : ""}`}>
              {dedupedDisplayVehicles.map((vehicle) => {
                const now = Date.now();
                const isVor = !!vehicle.IsVor;

                const displayLocation = getVehicleLocationDisplayLabel(vehicle, filterOption);

                // Trailer display logic
                const isTrailer = (vehicle.assetType ?? "").toLowerCase() === "trailer";
                const displayId = isTrailer
                  ? (vehicle.assetName ?? vehicle.assetRegistration ?? "")
                  : (vehicle.assetRegistration ?? vehicle.assetName ?? "");

                // Apply conditional formatting site-wide except Night-Out/Map
                const shouldApplySeverityColour =
                  filterOption !== "Night-Out" && filterOption !== "DelaysMap";
                const BackgroundColourClass = shouldApplySeverityColour
                    ? getServiceDueCardClass(vehicle.ServiceDueDate ?? "")
                    : "";

                // Apply breathing red effect
                const animationClass = !isVor
                  ? getTipperAlertClass(vehicle, filterOption, now)
                  : "";

                const vorSkin = isVor ? "vor-banner" : "";
                const serviceProgress = getServiceDueProgress(vehicle.ServiceDueDate ?? "");
                const serviceBarClass = serviceProgress
                  ? getServiceSeverityProgressClass(vehicle.ServiceDueDate)
                  : "";
                const maintenanceProgress = getDueProgress(vehicle.NextMaintenanceDueDate ?? "");
                const maintenanceLabel = vehicle.NextMaintenanceType && vehicle.NextMaintenanceType !== "N/A"
                  ? `${vehicle.NextMaintenanceType} health`
                  : "Maintenance health";

                return (
                  // Display Dashboard wizard on all pages other than Map/Kiosk mode
                  <li
                    key={`${vehicle.assetRegistration ?? "NO_REG"}-${vehicle.assetName}`}
                    data-vor={isVor ? "true" : "false"}
                    data-nightout={vehicle.isNightOut ? "true" : "false"}
                    className={`vehicle-card vehicle-card--clickable ${vorSkin} ${
                      vehicle.isNightOut ? "night-out" : ""
                    } ${BackgroundColourClass}  ${animationClass}`} //Adding background colour to the className         
                    role="button"
                    tabIndex={0}
                    aria-label={`Open details for ${displayId}`}
                    onClick={() => openVehicleModal(vehicle)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openVehicleModal(vehicle);
                      }
                    }}
                  >

                    {/* Top / Header */}                 
                    <header className="vehicle-card__header">
                      <div className="vehicle-card__title">
                        <h2 className="vehicle-reg">
                          {isTrailer ? displayId : formatRegistration(displayId)}
                        </h2>
                      </div>

                      <div className="vehicle-card__top-right">
                        <div className="vehicle-card__chips">
                          {isVor && <span className="chip chip--vor">VOR</span>}
                          {vehicle.LiveDefects && (
                            <span className="chip chip--defects">LIVE DEFECTS</span>
                          )}
                        </div>

                        {(filterOption === "Services" || filterOption === "Night-Out") && (
                          <label 
                            className="toggle-container" 
                            aria-label="Toggle night out"
                            onClick={(e) => e.stopPropagation()}  
                          >
                            <input
                              type="checkbox"
                              checked={!!vehicle.isNightOut}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (hasAssetName(vehicle)) toggleNightOut(vehicle);
                              }}
                            />
                            <span className="toggle-slider" />
                          </label>
                        )}
                      </div>
                    </header>

                    {/* Meta row */}
                    <div className="vehicle-card__meta">   
                      <span className={`status-pill status-pill--${(vehicle.eventType || "unknown").toLowerCase()}`}>
                        <span className="status-pill__icon">{renderStatusIcon(vehicle.eventType)}</span>
                        <span className="status-pill__text">{(vehicle.eventType || "UNKNOWN").toUpperCase()}</span>
                      </span>

                      <span className="vehicle-time-since-update">        
                        {typeof (vehicle as any).statusSinceMs === "number"
                          ? formatTimeInState((vehicle as any).statusSinceMs)
                          : vehicle.date
                            ? formatTimeInState(adjustedMs(vehicle.date))
                            : "--- : --- : ---"}
                      </span>
                    </div>

                    <div className="vehicle-card__divider" />

                    {/* Health */}
                    <section className="vehicle-card__health" aria-label="Vehicle compliance health">
                      {/* Service */}
                      <div className="health-block">
                        <div className="health-block__row">
                          <span className="health-block__label">Service health</span>
                          <span className="health-block__hint">{serviceProgress?.label ?? ""}</span>
                        </div>

                        <div className={`due-progress-bar ${serviceProgress ? "" : "empty-progress-bar"}`}>
                          <div
                            className={`due-progress-bar-inner ${serviceBarClass}`}
                            style={{ width: `${serviceProgress?.percentage ?? 0}%` }}
                          />
                        </div>

                        <div className={`health-block__sub ${isDatePast(vehicle.ServiceDueDate ?? "") ? "is-overdue" : ""}`}>
                          {serviceProgress ? (
                            <>
                              <span className="vehicle-due-span">Due:</span>{" "}                
                              {(() => {
                                const info = getServiceDueISOInfo(vehicle.ServiceDueDate);
                                return (
                                  <b className="vehicle-due-dates">
                                    {info ? formatDueISOWeekWithYear(info) : "N/A"}
                                  </b>
                                );
                              })()}
                            </>
                          ) : (
                            <span className="muted">Data not available</span>
                          )}
                        </div>
                      </div>

                      {/* Maintenance */}
                      <div className="health-block">
                        <div className="health-block__row">
                          <span className="health-block__label">{maintenanceLabel}</span>
                          <span className="health-block__hint">{maintenanceProgress?.label ?? ""}</span>
                        </div>

                        <div className={`due-progress-bar ${maintenanceProgress ? "" : "empty-progress-bar"}`}>
                          <div
                            className={`due-progress-bar-inner ${maintenanceProgress?.colorClass ?? ""}`}
                            style={{ width: `${maintenanceProgress?.percentage ?? 0}%` }}
                          />
                        </div>

                        <div className={`health-block__sub ${isDatePast(vehicle.NextMaintenanceDueDate ?? "") ? "is-overdue" : ""}`}>
                          {maintenanceProgress ? (
                            <>
                              <span className="vehicle-due-span">Due:</span>{" "}
                              <b className="vehicle-due-dates">
                                {vehicle.NextMaintenanceDueDate ? formatDate(vehicle.NextMaintenanceDueDate) : "N/A"}
                              </b>
                            </>
                          ) : (
                            <span className="muted">Data not available</span>
                          )}
                        </div>
                      </div>
                    </section>

                    {/* Footer */}
                    <footer className="vehicle-card__footer">
                      <span className="vehicle-card__footer-label">Location</span>
                      <span 
                        className="vehicle-location"
                        title={cleanLocationLabel(displayLocation)}
                      >
                        {cleanLocationLabel(displayLocation)}
                      </span>
                    </footer>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="vehicle-disclaimer">
            {isFetching && (
              <span className="data-refreshing-indicator" title="Refreshing data">
                <InlineLoader size={12} color="rgba(107, 114, 128, 0.8)" /> 
              </span>
            )}
            Vehicle data is fetched every 30 seconds
          </p>
        </div>
      </div>

      {(isVehicleModalOpen || isVehicleModalClosing) && selectedVehicle && (
        <div
          className={`vehicle-modal-overlay ${
            isVehicleModalOpen && !isVehicleModalClosing ? "is-open" : "is-closed"
          }`}
          onMouseDown={(e) => {
            // close if click on the overlay (not the panel)
            if (e.target === e.currentTarget) requestCloseVehicleModal();
          }}
          aria-hidden={!isVehicleModalOpen}
        >
          <div
            className={`vehicle-modal-panel ${
              isVehicleModalOpen && !isVehicleModalClosing ? "is-open" : "is-closed"
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Vehicle details"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`vehicle-modal-header ${modalHeaderSeverityClass}`}>
              <div className="vehicle-modal-title">
                <div className="vehicle-modal-title-row">
                  <h2 className="vehicle-modal-reg">
                    {(() => {
                      const isTrailer = (selectedVehicle.assetType ?? "").toLowerCase() === "trailer";
                      const displayId = isTrailer
                        ? (selectedVehicle.assetName ?? selectedVehicle.assetRegistration ?? "")
                        : (selectedVehicle.assetRegistration ?? selectedVehicle.assetName ?? "");
                      return isTrailer ? displayId : formatRegistration(displayId);
                    })()}
                  </h2>

                  <div className="vehicle-modal-actions">
                    {/* close button with event type directly beneath */}
                    <div className="vehicle-modal-actions-right">
                      <button
                        ref={modalCloseBtnRef}
                        type="button"
                        className="vehicle-modal-close"
                        onClick={requestCloseVehicleModal}
                        aria-label="Close vehicle details"
                        title="Close"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>

                <div className="vehicle-modal-subtitle-row">
                  {/* Status pill */}
                  <span
                    className={`status-pill status-pill--${(selectedVehicle.eventType ?? "unknown").toLowerCase()}`}
                  >
                    <span className="status-pill__icon">
                      {renderStatusIcon(selectedVehicle.eventType)}
                    </span>
                    <span className="status-pill__text">
                      {(selectedVehicle.eventType ?? "UNKNOWN").toUpperCase()}
                    </span>
                  </span>

                  <div className="modal-subtitle-row-right">
                    {/* VOR / Defects chips */}
                    <div className="vehicle-modal-header-chips">
                      {!!selectedVehicle.IsVor && (
                        <span className="chip chip--vor">VOR</span>
                      )}
                      {!!selectedVehicle.LiveDefects && (
                        <span className="chip chip--defects">LIVE DEFECTS</span>
                      )}
                    </div>

                    {/* Night-Out toggle (conditional) */}
                    {(filterOption === "Services" || filterOption === "Night-Out") && (
                      <label
                        className="toggle-container"
                        aria-label="Toggle night out"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={!!selectedVehicle.isNightOut}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (hasAssetName(selectedVehicle)) toggleNightOut(selectedVehicle);
                          }}
                        />
                        <span className="toggle-slider" />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="vehicle-modal-body">
              {/* Left pane */}
              <div className="vehicle-modal-left">
                <div className="vehicle-modal-section">
                  <div className="vehicle-modal-section-title">Vehicle details</div>

                  <div className="vehicle-modal-details">
                    <div className="vehicle-modal-detail-row">
                      <span className="vehicle-modal-detail-label">VEHICLE DEPOT</span>
                      <span className="vehicle-modal-detail-value">
                        {(() => {
                          const branchIdToDepot: Record<string, string> = {
                            "1": "Ellington",
                            "2": "Crewe",
                            "3": "Skelmersdale",
                            "4": "Avonmouth",
                            "10": "Coventry",
                            "11": "Bellshill",
                          };

                          const branchId = selectedVehicle.branchId != null
                            ? String(selectedVehicle.branchId)
                            : null;

                          if (branchId && branchIdToDepot[branchId]) {
                            return branchIdToDepot[branchId];
                          }

                          return "No assigned depot";
                        })()}
                      </span>
                    </div>

                    <div className="vehicle-modal-detail-row">
                      <span className="vehicle-modal-detail-label">VIN</span>
                      <span className="vehicle-modal-detail-value">
                        {displayText((selectedVehicle as any).assetVin, "Not available")}
                      </span>
                    </div>

                    <div className="vehicle-modal-detail-row">
                      <span className="vehicle-modal-detail-label">Type</span>
                      <span className="vehicle-modal-detail-value">
                        {formatVehicleType(selectedVehicle.assetType)}
                      </span>
                    </div>

                    {isTrailer && (
                      <div className="vehicle-modal-detail-row">
                        <span className="vehicle-modal-detail-label">Energy</span>
                        <span className="vehicle-modal-detail-value">
                          {humanizeEnum(selectedVehicle.energyType)}
                        </span>
                      </div>
                    )}

                    <div className="vehicle-modal-detail-row">
                      <span className="vehicle-modal-detail-label">Fuel</span>
                      <span className="vehicle-modal-detail-value">
                        {humanizeFuel(selectedVehicle.fuelType)}
                      </span>
                    </div>

                    <div className="vehicle-modal-detail-row">
                      <span className="vehicle-modal-detail-label">Status</span>
                      <span className="vehicle-modal-detail-value">
                        {humanizeStatus(selectedVehicle.status)}
                      </span>
                    </div>

                    <div className="vehicle-modal-detail-row">
                      <span className="vehicle-modal-detail-label">Speed</span>
                      <span className="vehicle-modal-detail-value">
                        {displayNumber((selectedVehicle as any).speed, " mph", "—")}
                      </span>
                    </div>

                    {String(selectedVehicle.assetType ?? "").toLowerCase() !== "trailer" && (
                      <div className="vehicle-modal-detail-row">
                        <span className="vehicle-modal-detail-label">Vehicle driver</span>
                        <span className="vehicle-modal-detail-value">
                          {humanizeDriverName(selectedVehicle.driverName)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="vehicle-modal-section">
                  <div className="vehicle-modal-section-title">Vehicle health</div>

                  <div className="vehicle-modal-health">
                    {MODAL_HEALTH_FIELDS                 
                      .filter((f) =>
                        isTrailer ? true : !TRAILER_ONLY_HEALTH_KEYS.has(f.key)
                      )
                      .map((f) => {
                        const raw = (selectedVehicle as any)[f.key] as string | undefined;

                        const progress =
                          f.kind === "service"
                            ? getServiceDueProgress(raw ?? "")
                            : getDueProgress(raw ?? "");

                        const barColorClass = progress
                          ? (f.kind === "service"
                              ? getServiceSeverityProgressClass(raw)
                              : (progress.colorClass ?? ""))
                          : "";

                        const dueText =
                          f.kind === "service"
                            ? (() => {
                                const info = getServiceDueISOInfo(raw);
                                return info ? formatDueISOWeekWithYear(info) : displayText(raw, "Not available");
                              })()
                            : formatDateSafe(raw, displayText(raw, "Not available"));

                        return (
                          <div key={String(f.key)} className="health-block">
                            <div className="health-block__row">
                              <span className="health-block__label">{f.label}</span>
                              <span className="health-block__hint">
                                {progress?.label ?? ""}
                              </span>
                            </div>

                            <div className={`due-progress-bar ${progress ? "" : "empty-progress-bar"}`}>
                              <div
                                className={`due-progress-bar-inner ${barColorClass}`}
                                style={{ width: `${progress?.percentage ?? 0}%` }}
                              />
                            </div>

                            <div
                              className={`health-block__sub vehicle-modal-health-sub ${
                                isDatePast(raw ?? "") ? "is-overdue" : ""
                              }`}
                            >
                              {progress ? (
                                <>
                                  <span className="vehicle-due-span">Due:</span>{" "}
                                  <b className="vehicle-due-dates">{dueText}</b>
                                </>
                              ) : (
                                <span className="muted">Data not available</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    }
                  </div>
                </div>
              </div>

              {/* Right pane */}
              <div className="vehicle-modal-right">
                <div className="vehicle-modal-section">
                  <div className="vehicle-modal-section-title">Location</div>

                  {Number.isFinite(selectedVehicle.latitude) && Number.isFinite(selectedVehicle.longitude) ? (
                    <div className="vehicle-modal-map">
                      <div
                        id="vehicle-modal-map"
                        style={{
                          width: "100%",
                          height: 320,
                        }}
                      />

                      <div className="vehicle-modal-map-caption">
                        {displayText(
                          selectedVehicle.formattedAddress ??
                            selectedVehicle.locationName,
                          "Unknown location"
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="vehicle-modal-map vehicle-modal-map--empty">
                      <div className="vehicle-modal-placeholder-title">No GPS location available</div>
                      <div className="vehicle-modal-placeholder-sub">
                        This vehicle has no latitude/longitude in the current feed.
                      </div>
                    </div>
                  )}
                </div>

                <div className="vehicle-modal-section">
                  <div className="vehicle-modal-section-title">Street view</div>
                  {(() => {
                    const coords = getStreetViewLatLon(selectedVehicle);
                    return coords ? (
                      <div className="vehicle-modal-streetview-wrapper">
                        <a
                          className="streetview-open-btn"
                          href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coords.lat},${coords.lon}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open location in Google Maps"
                        >
                          Open in Google Maps
                        </a>
                        <iframe
                          className="vehicle-modal-streetview-iframe"
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                          src={`https://www.google.com/maps?q=&layer=c&cbll=${coords.lat},${coords.lon}&cbp=11,0,0,0,0&output=svembed`}
                          title="Street View"
                        />
                      </div>
                    ) : (
                      <div className="vehicle-modal-streetview vehicle-modal-streetview--empty">
                        <Image
                          className="vehicle-modal-streetview-icon"
                          aria-hidden="true"
                        />
                        <div className="vehicle-modal-streetview-text">
                          Street View not available
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Night-Out Toast */}
      {nightOutToast && (
        <div
          className={`nightout-toast ${nightOutToast.visible ? "nightout-toast--visible" : ""}`}
          role="status"
          aria-live="polite"
        >
          <div className="nightout-toast-card">
            <button
              type="button"
              className="nightout-toast-close"
              aria-label="Dismiss notification"
              onClick={dismissNightOutToast}
            >
              ✕
            </button>

            <div className="nightout-toast-header">
              <span className="nightout-toast-icon" aria-hidden="true">
                <Moon size={18} />
              </span>
              <span className="nightout-toast-title">Night-Out</span>
            </div>

            <div className="nightout-toast-body">
              <b>{nightOutToast.reg}</b>{" "}
              {nightOutToast.isOn
                ? "has been marked as Night-Out."
                : "has been removed from Night-Out."}
            </div>
          </div>
        </div>
      )}

      {/* Back to Top Button */}
      {!isKioskMode && (
        <button
          type="button"
          className={`back-to-top ${showBackToTop ? "back-to-top--visible" : ""}`}
          aria-label="Back to top"
          onClick={scrollToTop}
        >
          <ChevronUp size={20} aria-hidden="true" focusable="false" />
        </button>
      )}
    </>
  );
};

export default Vehicles;
