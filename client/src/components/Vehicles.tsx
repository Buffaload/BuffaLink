import React, { useEffect, useMemo, useState, useRef } from "react";
import { filterVehicles, adjustedMs } from "../utils/vehicleRules";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Building2,
  Bug,
  TriangleAlert,
  ChevronUp,
} from "lucide-react";
import InlineLoader from "./InlineLoader";
import "../css/Vehicles.css";
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
  assetGroupName?: string;
  assetType?: string;
  // New fields from BlueCrystal API
  ServiceDueDate?: string;
  MotDueDate?: string;
  IsVor?: boolean;
  LiveDefects?: boolean;
  isNightOut?: boolean;
  latitude?: number;
  longitude?: number;
  temperature?: number;
}

interface VehiclesProps {
  filterOption: string;
  selectedDepots: string[];
  isKioskMode: boolean;
}

const SERVICE_TIMELINE_DAYS_KEY = "buffalink:serviceTimelineDays";
const MOT_TIMELINE_DAYS_KEY = "buffalink:motTimelineDays";

const DEFAULT_SERVICE_TIMELINE_DAYS = 42;
const DEFAULT_MOT_TIMELINE_DAYS = 364;

const getServiceTimelineDays = () =>
  Number(localStorage.getItem(SERVICE_TIMELINE_DAYS_KEY)) ||
  DEFAULT_SERVICE_TIMELINE_DAYS;

const getMotTimelineDays = () =>
  Number(localStorage.getItem(MOT_TIMELINE_DAYS_KEY)) ||
  DEFAULT_MOT_TIMELINE_DAYS;

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

// Critical Arrivals helpers
function getDueISOInfo(dateString?: string): { weekDiff: number; isOverdue: boolean } | null {
  const dueDate = parseDateSafe(dateString);
  if (!dueDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return {
    weekDiff: getISOWeekDiffFromToday(dueDate),
    isOverdue: dueDate.getTime() < today.getTime(),
  };
}

function isDueThisISOWeekOrOverdue(dateString?: string): boolean {
  const info = getDueISOInfo(dateString);
  if (!info) return false;
  // "due this week" + include overdue as still critical
  return info.isOverdue || info.weekDiff === 0;
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

const formatRegistration = (value?: string) => {
  if (!value) return value;
  const reg = value.trim();
  // Only act on exactly 7 characters with no existing space
  if (reg.length === 7 && !reg.includes(" ")) {
    return `${reg.slice(0, 4)} ${reg.slice(4)}`;
  }

  return reg;
};

// Helper function for percentage calculation and color coding for service/MOT due dates
const getProgressColorClass = (percentage: number) => {
  if (percentage < 33.33) return "progress-red";
  if (percentage < 66.66) return "progress-orange";
  return "progress-green";
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

type DepotMatchableVehicle = {
  locationName?: string | null;
  formattedAddress?: string | null;
  locationGroupName?: string | null;
};

const normalizeDepotText = (value: string | null | undefined) =>
  (value ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const DEPOT_ALIASES: Record<string, string[]> = {
  ELLINGTON: ["ELLINGTON"],
  CREWE: ["CREWE"],
  SKELMERSDALE: ["SKELMERSDALE", "SKELMERSDALE DEPOT"],
  COVENTRY: ["CO-OP COVENTRY", "COOP COVENTRY"],
  AVONMOUTH: ["AVONMOUTH", "BUFFALOAD AVONMOUTH", "CO-OP AVONMOUTH", "COOP AVONMOUTH"],
  BELLSHILL: ["BELLSHILL", "BUFFALOAD BELLSHILL"],
};

const vehicleDepotHaystack = (v: DepotMatchableVehicle) =>
  normalizeDepotText(
  [
    v.locationName,
    v.formattedAddress,
    v.locationGroupName,
  ]
    .filter(Boolean)
    .join(" | ")
);

const matchesSelectedDepot = (
  v: DepotMatchableVehicle & { locationName?: string },
  depotLabel: string
) => {
  const key = normalizeDepotText(depotLabel);

  // Strong signal: backend says this is a Buffaload depot
  if (v.locationGroupName === "Buffaload") {
    const loc = normalizeDepotText(v.locationName);
    if (loc.includes(key)) return true;
  }

  // Fallback to alias text matching (non-geofenced cases)
  const hay = vehicleDepotHaystack(v);
  const aliases = DEPOT_ALIASES[key] ?? [key];

  return aliases.some((a) =>
    hay.includes(normalizeDepotText(a))
  );
};

const Vehicles: React.FC<VehiclesProps> = ({
  filterOption,
  selectedDepots,
  isKioskMode,
}) => {
  const queryClient = useQueryClient();
  const [isVorFilterActive, setIsVorFilterActive] = useState(false);
  const [sortOption, setSortOption] = useState<"stoppedTime" | "serviceDue" | "reg" | "location">("stoppedTime");
  const [timelineTick, setTimelineTick] = useState(0);
  void timelineTick;
  const [searchTerm, setSearchTerm] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  // Helpers for filtering, searching, and sorting
  const fetchVehicles = async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      throw new Error("No token found. Please log in.");
    }

    const response = await axios.get(`${API_BASE_URL}/vehicles`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 200) {
      const data = response.data;

      const arr =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.vehicles)
          ? data.vehicles
          : [];

      if (arr.length === 0) {
        const previous = queryClient.getQueryData<Vehicle[]>(["vehicles"]);
        if (previous?.length) {
          return previous;
        }
      }

      return arr;
    }
    throw new Error("Failed to fetch vehicles");
  };

  // useQuery hook for fetching vehicles
  const {
    data: vehicles = [], //Default to an empty array
    isLoading,
    isError,
    error,
  } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: 30000, // Poll every 30 sec
    staleTime: 60000, // Data is fresh for 1 minute
  });

  // Tracks when each vehicle entered its current eventType (state)
  type StatusSince = {
    eventType: string; // normalized lowercase
    sinceMs: number;
  };

  const statusSinceRef = useRef<Map<string, StatusSince>>(new Map());

  // Depot matching helpers (geofence + text/address fallback)
  const { categoryVehicles, displayVehicles } = useMemo(() => {
    const now = Date.now();
    const currentKeys = new Set<string>();
    const vehiclesWithSince: VehicleWithSince[] = vehicles.map((v) => {
      const key = v.assetName;
      currentKeys.add(key);

      const currentType = (v.eventType ?? "unknown").toLowerCase();

      // Use vehicle.date as the transition timestamp when state changes
      // If it's invalid, fall back to "now"
      const incomingMs = v.date ? adjustedMs(v.date) : NaN;
      const incomingSafeMs = isNaN(incomingMs) ? now : incomingMs;

      const prev = statusSinceRef.current.get(key);

      const sinceMs =
        !prev || prev.eventType !== currentType
          ? incomingSafeMs
          : prev.sinceMs;

      statusSinceRef.current.set(key, { eventType: currentType, sinceMs });

      return { ...v, statusSinceMs: sinceMs };
    });

    Array.from(statusSinceRef.current.keys()).forEach((k) => {
      if (!currentKeys.has(k)) {
        statusSinceRef.current.delete(k);
      }
    });

    let categoryVehicles: VehicleWithSince[] = [];

    if (filterOption === "Critical-Arrivals") {
      categoryVehicles = vehiclesWithSince.filter((v) => {
        const dueService = isDueThisISOWeekOrOverdue(v.ServiceDueDate);
        const dueMot = isDueThisISOWeekOrOverdue(v.MotDueDate);
        const inDepot = (v.locationGroupName ?? "") === "Buffaload";
        return (dueService || dueMot) && inDepot;
      });
    } else {
      categoryVehicles = filterVehicles(vehiclesWithSince, filterOption, [], now) as VehicleWithSince[];
      if (filterOption === "Depots" && selectedDepots.length > 0) {
        categoryVehicles = categoryVehicles.filter((v) =>
          selectedDepots.some((d) => matchesSelectedDepot(v, d))
        );
      }
    }

    let list: VehicleWithSince[] = categoryVehicles;

    if (isVorFilterActive) {
      list = list.filter((v) => !!(v.IsVor || v.LiveDefects));
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

    const sorted = [...list].sort((a, b) => {
      if (sortOption === "stoppedTime") {
        // Make "Stopped time" effectively "Time in current state" across all states
        const aSince = a.statusSinceMs ?? (a.date ? adjustedMs(a.date) : now);
        const bSince = b.statusSinceMs ?? (b.date ? adjustedMs(b.date) : now);
        const aDur = now - aSince;
        const bDur = now - bSince;

        if (bDur !== aDur) return bDur - aDur;
        return (a.assetName ?? "").localeCompare(b.assetName ?? "");
      }

      // ...keep your other sort options unchanged...
      if (sortOption === "serviceDue") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();
        const aDueMs = a.ServiceDueDate ? adjustedMs(a.ServiceDueDate.trim()) : NaN;
        const bDueMs = b.ServiceDueDate ? adjustedMs(b.ServiceDueDate.trim()) : NaN;

        const aSortVal = isNaN(aDueMs) ? Number.POSITIVE_INFINITY : (aDueMs - todayMs);
        const bSortVal = isNaN(bDueMs) ? Number.POSITIVE_INFINITY : (bDueMs - todayMs);

        if (aSortVal !== bSortVal) return aSortVal - bSortVal;
        return (a.assetName ?? "").localeCompare(b.assetName ?? "");
      }

      if (sortOption === "reg") {
        const aReg = (a.assetRegistration || a.assetName || "").toUpperCase();
        const bReg = (b.assetRegistration || b.assetName || "").toUpperCase();
        return aReg.localeCompare(bReg);
      }

      if (sortOption === "location") {
        const aLoc = (a.locationName || a.formattedAddress || "").toUpperCase();
        const bLoc = (b.locationName || b.formattedAddress || "").toUpperCase();
        return aLoc.localeCompare(bLoc);
      }

      return 0;
    });

    return { categoryVehicles, displayVehicles: sorted };
  }, [
    vehicles,
    filterOption,
    selectedDepots,
    isVorFilterActive,
    searchTerm,
    sortOption,
  ]);

  const highlightFigures = useMemo(() => {
    // Reflect ALL active client-side filters (VOR-only + Search)
    const total = displayVehicles.length;
    const vor = displayVehicles.reduce(
      (count, v) => count + ((v.IsVor || v.LiveDefects) ? 1 : 0),
      0
    );

    return { total, vor };
  }, [displayVehicles]);

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
    }
  ) => {
    const previousState = vehicle.isNightOut;
    const updatedState = !vehicle.isNightOut;

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
    }
  };

  // Loading state
  if (isLoading) return (
    <div className="vehicle-placeholder-text">
      <InlineLoader size={24} />
    </div>
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

              <div className="highlight-figures" aria-label="Vehicle highlights">
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
              Showing all vehicles that are due a service/MOT within less than 5 days and are currently out of a depot
            </div>
          )}

          {filterOption === "Critical-Arrivals" && (
            <div className="critical-info-banner">
              <TriangleAlert size="16" />
              Showing vehicles that are due (or overdue) Maintenance and have just arrived at a depot
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
          {displayVehicles.length === 0 ? (       
            <div className="vehicle-empty-state">
              <TriangleAlert className="vehicle-empty-icon" aria-hidden />
              <p className="vehicle-empty-text">
                {categoryVehicles.length === 0
                  ? "No stopped vehicles to show in this category."
                  : "No vehicles match your current filters (Search / VOR)."}
              </p>
            </div>
          ) : (
            <ul className={`vehicle-list ${filterOption === "Depots" ? "vehicle-list--depots" : ""} ${filterOption === "Critical" || filterOption === "Critical-Arrivals" ? "vehicle-list--critical" : ""}`}>
              {displayVehicles.map((vehicle) => {
                const now = Date.now();
                const isVor = !!vehicle.IsVor;

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
                const motProgress = getDueProgress(vehicle.MotDueDate ?? "");

                return (
                  // Display Dashboard wizard on all pages other than Map/Kiosk mode
                  <li
                    key={vehicle.assetName}
                    data-vor={isVor ? "true" : "false"}
                    data-nightout={vehicle.isNightOut ? "true" : "false"}
                    className={`vehicle-card ${vorSkin} ${
                      vehicle.isNightOut ? "night-out" : ""
                    } ${BackgroundColourClass}  ${animationClass}`} //Adding background colour to the className
                  >

                    {/* Top / Header */}                 
                    <header className="vehicle-card__header">
                      <div className="vehicle-card__title">
                        <h2 className="vehicle-reg">
                          {formatRegistration(vehicle.assetRegistration ?? vehicle.assetName)}
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
                          <label className="toggle-container" aria-label="Toggle night out">
                            <input
                              type="checkbox"
                              checked={!!vehicle.isNightOut}
                              onChange={() => {
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
                            className={`due-progress-bar-inner ${serviceProgress?.colorClass ?? ""}`}
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

                      {/* MOT */}
                      <div className="health-block">
                        <div className="health-block__row">
                          <span className="health-block__label">MOT health</span>
                          <span className="health-block__hint">{motProgress?.label ?? ""}</span>
                        </div>

                        <div className={`due-progress-bar ${motProgress ? "" : "empty-progress-bar"}`}>
                          <div
                            className={`due-progress-bar-inner ${motProgress?.colorClass ?? ""}`}
                            style={{ width: `${motProgress?.percentage ?? 0}%` }}
                          />
                        </div>

                        <div className={`health-block__sub ${isDatePast(vehicle.MotDueDate ?? "") ? "is-overdue" : ""}`}>
                          {motProgress ? (
                            <>
                              <span className="vehicle-due-span">Due:</span>{" "}
                              <b className="vehicle-due-dates">
                                {vehicle.MotDueDate ? formatDate(vehicle.MotDueDate) : "N/A"}
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
                        title={vehicle.locationName ?? vehicle.formattedAddress ?? "UNKNOWN LOCATION"}
                      >
                        {vehicle.locationName ?? vehicle.formattedAddress ?? "UNKNOWN LOCATION"}
                      </span>
                    </footer>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="vehicle-disclaimer">Vehicle data is fetched every 30 seconds.</p>
        </div>
      </div>

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
