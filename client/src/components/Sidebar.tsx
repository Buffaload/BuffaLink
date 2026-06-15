import API_BASE_URL from "../config";
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { adjustedMs, countFor, isCriticalAlert, isCriticalArrival } from "../utils/vehicleRules"
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  Truck,
  Fuel,
  Moon,
  Map as MapIcon,
  Building2,
  Wrench,
  TriangleAlert,
  Ambulance,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { createPortal } from "react-dom";
import InlineLoader from "./InlineLoader";
import "../css/Sidebar.css";
import ProfileButton from "./ProfileButton";

interface Vehicle {
  assetName?: string;
  assetRegistration?: string;
  assetType?: string;
  assetGroupName?: string;
  locationGroupName?: string;
  locationName?: string;
  formattedAddress?: string;
  eventType?: string;
  date?: string;
  ServiceDueDate?: string;
  MotDueDate?: string;
  BrakeDueDate?: string;
  TlWeightDueDate?: string;
  TachoDueDate?: string;
  TailDueDate?: string;
  FridgeDueDate?: string;
  RflDueDate?: string;
  LolerDueDate?: string;
  AncillaryOneDueDate?: string;
  AncillaryTwoDueDate?: string;
  NextMaintenanceType?: string;
  NextMaintenanceDueDate?: string;
}

type VehicleWithSince = Vehicle & {
  statusSinceMs?: number;
};

type StatusSince = {
  eventType: string;
  sinceMs: number;
};

type CriticalArrivalItem = {
  signature: string;
  reg: string;
  dueType: "Service" | "Maintenance" | "MOT" | "Brake test" | "Loaded brake test" | "Tacho" | "Tail lift" | "Fridge" | "FGAS" | "LOLER" | "Ancillary 1" | "Ancillary 2";
  depot: string;
};

// For notification tooltip testing - set true
const FORCE_ARRIVALS_TOOLTIP_FOR_STYLING = false;

const DUMMY_ARRIVAL_ITEMS: CriticalArrivalItem[] = [
  {
    signature: "debug:arrival:1",
    reg: "AB12 CDE",
    dueType: "Service",
    depot: "Ellington",
  },
  {
    signature: "debug:arrival:2",
    reg: "XY34 ZZZ",
    dueType: "Brake test",
    depot: "Skelmersdale",
  },
  {
    signature: "debug:arrival:3",
    reg: "MN56 PQR",
    dueType: "LOLER",
    depot: "Coventry",
  },
];

const ARRIVALS_LAST_STATE_KEY = "buffalink:criticalArrivals:lastState";
const ARRIVALS_ACK_KEY = "buffalink:criticalArrivals:ack";

const formatRegistration = (value?: string) => {
  if (!value) return value ?? "";
  const reg = value.trim();
  if (reg.length === 7 && !reg.includes(" ")) return `${reg.slice(0, 4)} ${reg.slice(4)}`;
  return reg;
};

const parseDateSafe = (dateString?: string): Date | null => {
  const raw = (dateString ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
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

function isDueThisISOWeekOrOverdue(dateString?: string): boolean {
  const d = parseDateSafe(dateString);
  if (!d) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isOverdue = d.getTime() < today.getTime();
  const weekDiff = getISOWeekDiffFromToday(d);

  return isOverdue || weekDiff === 0;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const normalizeDepotText = (value: string | null | undefined) =>
  (value ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const getViewportSnapshot = () => {
  if (typeof window === "undefined") {
    return { width: 1920, height: 1080, isPortrait: false };
  }

  const visualViewport = window.visualViewport;

  const width =
    visualViewport?.width ??
    window.innerWidth ??
    document.documentElement.clientWidth;

  const height =
    visualViewport?.height ??
    window.innerHeight ??
    document.documentElement.clientHeight;

  const isPortrait =
    window.matchMedia("(orientation: portrait)").matches ||
    height > width;

  return {
    width: Math.round(width),
    height: Math.round(height),
    isPortrait,
  };
};

type DepotLabel =
  | "Ellington"
  | "Crewe"
  | "Skelmersdale"
  | "Coventry"
  | "Bellshill"
  | "Avonmouth";

const CRITICAL_DEPOT_MATCHERS: Array<{
  label: DepotLabel;
  // tokens that must all be present in the same string (prevents city-only matches)
  allOf: string[];
}> = [
  { label: "Ellington", allOf: ["GROVE LANE", "PE28 0DA"] },
  { label: "Ellington", allOf: ["BUFFALOAD", "ELLINGTON"] },

  { label: "Crewe", allOf: ["14 GATEWAY", "CW1 6YY"] },
  { label: "Crewe", allOf: ["BUFFALOAD", "CREWE"] },

  { label: "Skelmersdale", allOf: ["GILLIBRAND", "WN8 9TA"] },
  { label: "Skelmersdale", allOf: ["EAST GILLIBRAND", "INDUSTRIAL"] },
  { label: "Skelmersdale", allOf: ["BUFFALOAD", "SKELMERSDALE"] },

  { label: "Coventry", allOf: ["CENTRAL BLVD", "CV6 4BX"] },
  { label: "Coventry", allOf: ["CO-OP", "COVENTRY"] },
  { label: "Coventry", allOf: ["COOP", "COVENTRY"] },

  { label: "Bellshill", allOf: ["SHOLTO", "ML4 3LX"] },
  { label: "Bellshill", allOf: ["RIGHEAD", "INDUSTRIAL"] },
  { label: "Bellshill", allOf: ["BUFFALOAD", "BELLSHILL"] },

  { label: "Avonmouth", allOf: ["POPLAR WAY", "BS11 0YW"] },
  { label: "Avonmouth", allOf: ["CO-OP", "AVONMOUTH"] },
  { label: "Avonmouth", allOf: ["COOP", "AVONMOUTH"] },
];

const getCriticalDepotLabel = (v: {
  locationGroupName?: string | null;
  formattedAddress?: string | null;
  locationName?: string | null;
}): DepotLabel | null => {
  // Must be in "Buffaload" group first (keeps behaviour aligned with existing app)
  if ((v.locationGroupName ?? "") !== "Buffaload") return null;

  // Prefer formattedAddress (BlueCrystal accuracy), then fallback to locationName
  const addr = normalizeDepotText(v.formattedAddress);
  const loc = normalizeDepotText(v.locationName);

  const tryMatch = (hay: string) => {
    if (!hay) return null;
    for (const m of CRITICAL_DEPOT_MATCHERS) {
      if (m.allOf.every((t) => hay.includes(normalizeDepotText(t)))) return m.label;
    }
    return null;
  };

  return tryMatch(addr) ?? tryMatch(loc);
};

const Sidebar: React.FC<{
  onFilterChange: (filter: string) => void;
  onDepotChange: (depots: string[]) => void;
  filterOption: string;
  handleLogout: () => void;
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
  isMobileOpen: boolean;
  onMobileRequestClose: () => void;
  isKioskMode: boolean;
}> = ({ onFilterChange, onDepotChange, filterOption, handleLogout, isCollapsed, setIsCollapsed, isMobileOpen, onMobileRequestClose, isKioskMode }) => {
  const [userRole, setUserRole] = useState<string>("");
  const [activeButton, setActiveButton] = useState<string>("HGVs");
  const [selectedDepots, setSelectedDepots] = useState<string[]>([]);
  const [arrivalTooltipOpen, setArrivalTooltipOpen] = useState(false);
  const [arrivalTooltipItems, setArrivalTooltipItems] = useState<CriticalArrivalItem[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false); // Loader icons
  const showDepotSubTabs = filterOption === "Depots";
  const queryClient = useQueryClient();
  const tooltipAnchorRef = React.useRef<HTMLButtonElement | null>(null);
  const statusSinceRef = React.useRef<Map<string, StatusSince>>(new Map());
  const [arrivalTooltipPos, setArrivalTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const SIDEBAR_COLLAPSED_KEY = "buffalink:sidebarCollapsed";
  const SIDEBAR_WIDTH_EXPANDED = 260;
  const SIDEBAR_WIDTH_COLLAPSED = 130;
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const [viewportInfo, setViewportInfo] = useState(() =>
    getViewportSnapshot()
  );

  const isPortraitViewport = viewportInfo.isPortrait;
  const isPortraitKiosk = isKioskMode && isPortraitViewport;

  // Collapsed unless user is hovering (hover temporarily expands)
  const effectiveCollapsed = (isKioskMode ? true : isCollapsed) && !isHoverExpanded;

  // Optional: disable collapsed mode on mobile (recommended)
  const isDesktop = typeof window !== "undefined"
    ? window.matchMedia("(min-width: 769px)").matches
    : true;

  const effectiveCollapsedDesktop = isDesktop ? effectiveCollapsed : false;

  useEffect(() => {
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

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    const root = document.documentElement;

    const widthPx = isPortraitKiosk
      ? 0
      : effectiveCollapsedDesktop
      ? SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_EXPANDED;

    root.style.setProperty("--sidebar-current-width", `${widthPx}px`);

    root.classList.toggle(
      "buffalink-portrait-viewport",
      isPortraitViewport
    );
    root.classList.toggle(
      "buffalink-portrait-kiosk",
      isPortraitKiosk
    );

    return () => {
      root.classList.remove("buffalink-portrait-viewport");
      root.classList.remove("buffalink-portrait-kiosk");
    };
  }, [effectiveCollapsedDesktop, isPortraitViewport, isPortraitKiosk]);

  const handleSidebarMouseEnter = () => {
    if (!isDesktop || isKioskMode) return;
    setIsHoverExpanded(true);
  };

  const handleSidebarMouseLeave = () => {
    if (!isDesktop || isKioskMode) return;
    setIsHoverExpanded(false);
  };

  const computeArrivalTooltipPosition = () => {
    const el = tooltipAnchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 12;

    setArrivalTooltipPos({
      top: r.top + r.height / 2,
      left: r.right + gap,
    });
  };

  useEffect(() => {
    if (!isKioskMode) return;
    if (arrivalTooltipOpen) closeArrivalTooltip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKioskMode]);

  useEffect(() => {
    if (!isKioskMode) {
      // Expand sidebar when exiting kiosk mode
      setIsCollapsed(false);
      setIsHoverExpanded(false);
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "false");
    }
  }, [isKioskMode, setIsCollapsed]);

  const DEPOTS = [
    "Ellington",
    "Crewe",
    "Coventry",
    "Skelmersdale",
    "Bellshill",
    "Avonmouth",
  ];

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      setUserRole(role);
    }
  }, []);

  // Fetch vehicles data
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
      const arr = Array.isArray(data)
        ? data
        : Array.isArray(data?.vehicles)
        ? data.vehicles
        : [];

      // Protect sidebar counts against empty/incomplete payloads
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

  const { 
    data: vehicles = [],
    isLoading,
  } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: 30000,
    staleTime: 60000, // Data is fresh for 1 minute
  });

  useEffect(() => {
    if (!vehicles || vehicles.length === 0) return;

    const ack = safeJsonParse<Record<string, true>>(
      localStorage.getItem(ARRIVALS_ACK_KEY),
      {}
    );

    const lastStateRaw = localStorage.getItem(ARRIVALS_LAST_STATE_KEY);
    const isFirstSnapshot = !lastStateRaw;

    const lastState = safeJsonParse<Record<string, { inDepot: boolean; depot: string }>>(
      lastStateRaw,
      {}
    );

    const currentState: Record<string, { inDepot: boolean; depot: string }> = { ...lastState };
    const newArrivals: CriticalArrivalItem[] = [];

    for (const v of vehicles) {
      const assetKey = (v.assetName ?? v.assetRegistration ?? "").trim();
      if (!assetKey) continue;
      
      const depotLabel = getCriticalDepotLabel(v);
      const inDepot = !!depotLabel;
      const depot = (depotLabel ?? "").trim();

      const dueService = isDueThisISOWeekOrOverdue(v.ServiceDueDate);
      // const dueNextMaintenance = isDueThisISOWeekOrOverdue(v.NextMaintenanceDueDate);
      const isCritical = isCriticalArrival(v);

      // Always update snapshot so transitions work next poll
      currentState[assetKey] = { inDepot, depot };
      if (!inDepot || !isCritical) continue;
      // If first snapshot, never notify (baseline only)
      if (isFirstSnapshot) continue;

      const prev = lastState[assetKey];
      const enteredThisDepot = !!prev && !prev.inDepot && inDepot;

      if (!enteredThisDepot) continue;

      const dueType: CriticalArrivalItem["dueType"] =
        dueService ? "Service" : "Maintenance";

      const signature = `${assetKey}|${depot}|${dueType}`;
      if (ack[signature]) continue;

      const isTrailer = (v.assetType ?? "").toLowerCase() === "trailer";
      const displayId = isTrailer
        ? (v.assetName ?? v.assetRegistration ?? "")
        : (v.assetRegistration ?? v.assetName ?? "");

      newArrivals.push({
        signature,
        reg: formatRegistration(displayId),
        dueType,
        depot,
      });
    }

    localStorage.setItem(ARRIVALS_LAST_STATE_KEY, JSON.stringify(currentState));

    if (newArrivals.length === 0) return;

    // Critical Arrivals notification tooltip
    setArrivalTooltipItems((prev) => {
      const seen = new Set(prev.map((p) => p.signature));
      const merged = [...prev];
      for (const item of newArrivals) {
        if (!seen.has(item.signature)) merged.push(item);
      }
      return merged.slice(0, 6);
    });

    if (!isKioskMode) {
      setArrivalTooltipOpen(true);
    }
  }, [vehicles, isKioskMode]);

  const acknowledgeTooltipItems = (items: CriticalArrivalItem[]) => {
    const ack = safeJsonParse<Record<string, true>>(
      localStorage.getItem(ARRIVALS_ACK_KEY),
      {}
    );
    for (const i of items) {  
      if (i.signature.startsWith("debug:")) continue;
      ack[i.signature] = true;
    }
    localStorage.setItem(ARRIVALS_ACK_KEY, JSON.stringify(ack));
  };

  useLayoutEffect(() => {
    if (!arrivalTooltipOpen) return;

    computeArrivalTooltipPosition();
    // Recalculate after first paint
    const raf1 = requestAnimationFrame(() => computeArrivalTooltipPosition());
    // After second paint (catches font + late layout shifts)
    const raf2 = requestAnimationFrame(() => {
      requestAnimationFrame(() => computeArrivalTooltipPosition());
    });
    // Final safety net: after CSS transitions complete
    const timeout = window.setTimeout(() => {
      computeArrivalTooltipPosition();
    }, 350);

    (document as any).fonts?.ready?.then?.(() => computeArrivalTooltipPosition());

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timeout);
    };
  }, [arrivalTooltipOpen, isMobileOpen, effectiveCollapsedDesktop, isHoverExpanded]);

  // Reposition tooltip when sidebar layout changes (submenu open/close)
  useEffect(() => {
    if (!arrivalTooltipOpen) return;

    // Run after React commits layout
    requestAnimationFrame(() => {
      computeArrivalTooltipPosition();
    });
  }, [
    arrivalTooltipOpen,
    filterOption,
    activeButton,
    showDepotSubTabs,
    selectedDepots.length,
  ]);

  const closeArrivalTooltip = () => {
    acknowledgeTooltipItems(arrivalTooltipItems);
    setArrivalTooltipOpen(false);
    setArrivalTooltipItems([]);
  };

  useEffect(() => {
    if (!FORCE_ARRIVALS_TOOLTIP_FOR_STYLING) return;

    // Only inject dummy content once (so close stays closed while styling)
    setArrivalTooltipItems((prev) => (prev.length ? prev : DUMMY_ARRIVAL_ITEMS));
    if (!isKioskMode) {
      setArrivalTooltipOpen(true);
    }
  }, [isKioskMode]);

  useEffect(() => {
    if (!isLoading && vehicles.length >= 0) {
      setHasLoadedOnce(true);
    }
  }, [isLoading, vehicles.length]);

  const shouldShowInitialLoader = isLoading && !hasLoadedOnce;
  const renderSidebarValue = (value: number) =>
    shouldShowInitialLoader  ? <InlineLoader size={14} color="#ffffff" /> : value;

  const vehiclesWithSince = useMemo<VehicleWithSince[]>(() => {
    const now = Date.now();
    const currentKeys = new Set<string>();

    const enriched = vehicles.map((v) => {
      const key = (v.assetName ?? v.assetRegistration ?? "").trim();
      currentKeys.add(key);

      const currentType = (v.eventType ?? "unknown").toLowerCase();
      const incomingMs = v.date ? adjustedMs(v.date) : NaN;
      const incomingSafeMs = Number.isNaN(incomingMs) ? now : incomingMs;

      const prev = statusSinceRef.current.get(key);
      const sinceMs =
        !prev || prev.eventType !== currentType
          ? incomingSafeMs
          : prev.sinceMs;

      statusSinceRef.current.set(key, {
        eventType: currentType,
        sinceMs,
      });

      return { ...v, statusSinceMs: sinceMs };
    });

    Array.from(statusSinceRef.current.keys()).forEach((k) => {
      if (!currentKeys.has(k)) {
        statusSinceRef.current.delete(k);
      }
    });

    return enriched;
  }, [vehicles]);

  // Calculate counts for badges
  const counts = useMemo(() => {
    const now = Date.now();

    return {
      hgvsCount: countFor(vehiclesWithSince, "HGVs", [], now),
      maintenanceCount: countFor(vehiclesWithSince, "Maintenance", [], now),
      criticalCount: vehiclesWithSince.filter(isCriticalAlert).length,
      arrivalsCount: vehiclesWithSince.filter(isCriticalArrival).length,
      tippersCount: countFor(vehiclesWithSince, "Tippers", [], now),
    };
  }, [vehiclesWithSince]);

  // function for Night-out subtab
  const handleButtonClick = (filter: string) => {
    setActiveButton(filter);
    onFilterChange(filter); // Pass the filter as a string
  };

  const handleSubTabClick = (subTab: string) => {
    setActiveButton(subTab); // keep Parent as active
    onFilterChange(subTab); // Pass the subtab as the active filter
  };

  // function for depots subtab
  const handleDepotClick = (depot: string) => {
    // If empty => treat as ALL selected (default)
    const currentlyAll = selectedDepots.length === 0;

    let updatedDepots: string[];

    if (currentlyAll) {
      // Clicking one when "ALL" is active => start filtering by excluding that depot
      updatedDepots = DEPOTS.filter((d) => d !== depot);
    } else {
      updatedDepots = selectedDepots.includes(depot)
        ? selectedDepots.filter((item) => item !== depot)
        : [...selectedDepots, depot];
    }

    // If user ends up selecting all explicitly, collapse back to [] which means ALL
    if (updatedDepots.length === DEPOTS.length) {
      setSelectedDepots([]);
      onDepotChange([]);
      return;
    }

    setSelectedDepots(updatedDepots);
    onDepotChange(updatedDepots);
  };

  const location = useLocation();

  useEffect(() => {
    // Only close automatically on small viewports
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    if (isMobile && isMobileOpen) {
      onMobileRequestClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const forceScrollToTop = () => {
    // Hard reset
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    // Compensate for dynamic padding / header overlap
    requestAnimationFrame(() => {
      window.scrollBy({ top: -140, left: 0, behavior: "auto" });
    });
  };

  return (
    <>
      <div 
        className={`sidebar   
          ${isMobileOpen ? "open" : ""}   
          ${effectiveCollapsedDesktop ? "is-collapsed" : ""}  
          ${isKioskMode ? "sidebar--kiosk" : ""}  
          ${isPortraitKiosk ? "sidebar--portrait-kiosk-hidden" : ""}
        `}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      >
        <div className="sidebar-header">
          <img
            src={effectiveCollapsedDesktop ? "/fleetpulse-dial.png" : "/fleetpulse-logo.png"}
            alt="FleetPulse"
            className={`sidebar-logo ${effectiveCollapsedDesktop ? "sidebar-logo--dial" : ""}`}
          />
        </div>
        <ul className="sidebar-nav">
          <li className="sidebar-section-heading">FLEET</li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "HGVs" ? "active" : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("HGVs");
              }}
            >
              <span className="sidebar-link-text">
                <Truck className="sidebar-icon" />
                <span className="sidebar-label">HGVs</span>
              </span>
              <span className="sidebar-link-meta sidebar-value--grey">
                {renderSidebarValue(counts.hgvsCount)}
              </span>
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Services" || filterOption === "Night-Out" || filterOption === "Delays"
                  ? "active"
                  : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("Services");
              }}
            >            
              <span className="sidebar-link-text">
                <Fuel className="sidebar-icon" />
                <span className="sidebar-label">Services</span>
              </span>       
              <span className="sidebar-link-meta sidebar-chevron">
                {filterOption === "Services" ? (
                    <ChevronUp size={16} />
                  ) : ( 
                    <ChevronDown size={16} /> 
                  )}
              </span>
            </button>
          </li>
          {/* Sub-tab for "Services" */}
          {!effectiveCollapsedDesktop && (filterOption === "Services" || filterOption === "Night-Out" || filterOption === "Delays") && (
            <div className="depot-grid depot-grid--single">
              <button
                type="button"
                className={`depot-tile ${
                  activeButton === "Night-Out" ? "depot-tile--active" : ""
                }`}
                onClick={() => {
                  forceScrollToTop();
                  handleSubTabClick("Night-Out");
                }}
                aria-pressed={activeButton === "Night-Out"}
              >
                <span className="depot-tile-left">
                  <span className="depot-name">Night-Out</span>
                </span>

                <Moon className="service-right-icon" size={18} />
              </button>

              <button
                type="button"
                className={`depot-tile ${
                  activeButton === "Delays" ? "depot-tile--active" : ""
                }`}
                onClick={() => {
                  forceScrollToTop();
                  handleSubTabClick("Delays");
                }}
                aria-pressed={activeButton === "Delays"}
              >
                <span className="depot-tile-left">
                  <span className="depot-name">Map</span>
                </span>

                <MapIcon className="service-right-icon" size={18} />
              </button>
            </div>
          )}
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Depots" && selectedDepots.length === 0
                  ? "active"
                  : ""
              }`}
              onClick={() => {
                // Clear all subtabs when clicking "Depots"
                forceScrollToTop();
                handleButtonClick("Depots");
                setSelectedDepots([]);
                onDepotChange([]); // Notify parent about cleared depots
              }}
            >      
              <span className="sidebar-link-text">
                <Building2 className="sidebar-icon" />
                <span className="sidebar-label">Depots</span>
              </span>

              <span className="sidebar-link-meta sidebar-chevron">
                {filterOption === "Depots" ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </span>
            </button>
          </li>
          {/* Sub-tab for "Depots" */}
          {!effectiveCollapsedDesktop && showDepotSubTabs && (
            <div className="depot-grid" role="group" aria-label="Depot filter">
              {DEPOTS.map((depot) => {
                // If empty => ALL is selected in the UI
                const effectiveSelected =
                  selectedDepots.length === 0 ? DEPOTS : selectedDepots;

                const checked = effectiveSelected.includes(depot);

                return (
                  <button
                    key={depot}
                    type="button"
                    className="depot-tile"
                    onClick={() => {
                      forceScrollToTop();
                      handleDepotClick(depot);
                    }}
                    aria-pressed={checked}
                  >
                    <span className="depot-tile-left">
                      <span className="depot-name">{depot}</span>
                    </span>

                    <span
                      className={`depot-radio ${checked ? "checked" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          )}
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Maintenance" ? "active" : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("Maintenance");
              }}
            >
              <span className="sidebar-link-text">
                <Wrench className="sidebar-icon" />
                <span className="sidebar-label">Maintenance</span>
              </span>
              <span className="sidebar-link-meta sidebar-value--grey">
                {renderSidebarValue(counts.maintenanceCount)}
              </span>
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Critical" ? "active" : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("Critical");
              }}
            >
              <span className="sidebar-link-text">
                <TriangleAlert className="sidebar-icon" />
                <span className="sidebar-label">Critical Alerts</span>
              </span>
              <span className={`sidebar-link-meta ${counts.criticalCount > 0 ? "sidebar-badge alert-pop--sidebar" : "sidebar-value--grey"}`}>
                {renderSidebarValue(counts.criticalCount)}
              </span>
            </button>
          </li>   
          <li className="sidebar-item sidebar-item--has-popout">
            <button
              ref={tooltipAnchorRef}
              className={`sidebar-link ${
                filterOption === "Critical-Arrivals" ? "active" : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("Critical-Arrivals");
                closeArrivalTooltip(); // closes tooltip when you click it
              }}
            >
              <span className="sidebar-link-text">
                <Ambulance className="sidebar-icon" />
                <span className="sidebar-label">Critical Arrivals</span>
              </span>
              <span className={`sidebar-link-meta ${counts.arrivalsCount > 0 ? "sidebar-badge alert-pop--sidebar" : "sidebar-value--grey"}`}>
                {renderSidebarValue(counts.arrivalsCount)}
              </span>
            </button>

            {/* Tooltip anchored ONLY to Critical Arrivals */}
            {!isKioskMode && arrivalTooltipOpen && arrivalTooltipItems.length > 0 && arrivalTooltipPos && 
              createPortal(
                (() => {
                  const item = arrivalTooltipItems[0]; // keep it compact: show latest only

                  return (
                    <div
                      className="sidebar-dark-tooltip sidebar-dark-tooltip--compact"
                      style={{
                        top: `${arrivalTooltipPos.top}px`,
                        left: `${arrivalTooltipPos.left}px`,
                        transform: "translateY(-50%)",
                      }}
                      role="dialog"
                      aria-label="Critical arrival"
                    >
                      <span className="sidebar-dark-tooltip__alert" aria-hidden="true">!</span>

                      <div className="sidebar-dark-tooltip__text">
                        <div className="sidebar-dark-tooltip__reg">{item.reg}</div>                
                        <div className="sidebar-dark-tooltip__due">{item.dueType}</div>
                        <div className="sidebar-dark-tooltip__location">{item.depot}</div>
                      </div>

                      <button
                        type="button"
                        className="sidebar-dark-tooltip__close"
                        onClick={closeArrivalTooltip}
                        aria-label="Close"
                      >
                        x
                      </button>
                    </div>
                  );
                })(),
                document.body
              )
            }
          </li>
          {userRole === "admin" && (
            <>
              <li className="sidebar-section-heading">CONTRACTS</li>
              <li>
                <button
                  className={`sidebar-link ${
                    filterOption === "Tippers" ? "active" : ""
                  }`}
                  onClick={() => {
                    forceScrollToTop();
                    handleButtonClick("Tippers");
                  }}
                >
                  <span className="sidebar-link-text">
                    <FileText className="sidebar-icon" />
                    <span className="sidebar-label">Tippers</span>
                  </span>
                  <span className="sidebar-link-meta sidebar-value--grey">
                    {renderSidebarValue(counts.tippersCount)}
                  </span>
                </button>
              </li>
            </>
          )}
        </ul>
        {/* Profile Button at bottom of sidebar */}
        <div className={`sidebar-profile ${isKioskMode ? "profile-disabled" : ""}`}>
          <ProfileButton
            username={localStorage.getItem("username") || ""}
            handleLogout={handleLogout}
          />
        </div>
      </div>
    </>
  );
};

export default Sidebar;
