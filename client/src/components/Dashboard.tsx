import React, { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import "../css/Dashboard.css";
import Sidebar from "./Sidebar";
import Vehicles from "./Vehicles";
import DelaysMap from "./DelaysMap";

interface DashboardProps {
  handleLogout: () => void;
}

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

const formatRegistration = (value?: string) => {
  if (!value) return value;
  const reg = value.trim();
  if (reg.length === 7 && !reg.includes(" ")) {
    return `${reg.slice(0, 4)} ${reg.slice(4)}`;
  }
  return reg;
};

const LOCATION_DEPOTS_KEY = "buffalink:locationSelectedDepots";
const LOCATION_DEPOTS_EVENT = "buffalink:locationDepotsChanged";

const DEPOT_CODE: Record<string, string> = {
  ellington: "ELL",
  crewe: "CRE",
  coventry: "COV",
  skelmersdale: "SKE",
  bellshill: "BEL",
  avonmouth: "AVO",
};

const DEPOT_ORDER = ["Ellington", "Crewe", "Coventry", "Skelmersdale", "Bellshill", "Avonmouth"];

const getUserClaims = () => {
  const token = localStorage.getItem("token");

  try {
    if (!token) throw new Error("No token");

    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );

    return {
      role: String(
        payload?.role ??
        payload?.Role ??
        payload?.user?.role ??
        payload?.user?.Role ??
        localStorage.getItem("role") ??
        ""
      ).toLowerCase(),
      depot: String(
        payload?.depot ??
        payload?.Depot ??
        payload?.user?.depot ??
        payload?.user?.Depot ??
        localStorage.getItem("depot") ??
        ""
      ).toLowerCase(),
    };
  } catch {
    return {
      role: String(localStorage.getItem("role") ?? "").toLowerCase(),
      depot: String(localStorage.getItem("depot") ?? "").toLowerCase(),
    };
  }
};

const renderStatusIcon = (rawType?: string) => {
  const type = (rawType ?? "unknown").toLowerCase();

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

const Dashboard: React.FC<DashboardProps> = ({ handleLogout }) => {
  const [filterOption, setFilterOption] = useState<string>("HGVs");
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("buffalink:sidebarCollapsed") === "true";
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isKioskMode, setIsKioskMode] = useState<boolean>(false);
  const [isoWeek, setIsoWeek] = useState(() => getISOWeek());
  const [isoWeekYear, setIsoWeekYear] = useState(() => getISOWeekYear());
  const [weekTooltipOpen, setWeekTooltipOpen] = useState(false);
  const weekBtnRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [tooltipArrowX, setTooltipArrowX] = useState(24);
  const [locationTick, setLocationTick] = useState(0);
  const token = localStorage.getItem("token");
  const [selectedDepots, setSelectedDepots] = useState<string[]>([]);
  type SortOrder = "asc" | "desc";
  type KioskStats = { total: number; red: number; orange: number; yellow: number; green: number };
  const [kioskStats, setKioskStats] = useState<KioskStats>({ total: 0, red: 0, orange: 0, yellow: 0, green: 0 });
  const SERVICES_SORT_KEY = "servicesDueSortOrder";
  const [servicesSortOrder, setServicesSortOrder] = useState<SortOrder>(() => {
    const saved = localStorage.getItem(SERVICES_SORT_KEY);
    return saved === "desc" ? "desc" : "asc";
  });

  const toggleServicesSortOrder = () => {
    setServicesSortOrder((prev) => {
      const next: SortOrder = prev === "asc" ? "desc" : "asc";
      localStorage.setItem(SERVICES_SORT_KEY, next);
      return next;
    });
  };

  // Map filter options to their respective titles
  type DashboardTitle = {
    prefix: string;
    suffix?: string;
  };

  const filterTitles: Record<string, DashboardTitle> = {
    HGVs: {
      prefix: "HGVs ",
      suffix: "- stopped >1 hr",
    },
    Services: {
      prefix: "Services ",
      suffix: "- stopped vehicles",
    },
    "Night-Out": {
      prefix: "Night-Out ",
      suffix: "- flagged as Night-Out",
    },
    Delays: {
      prefix: "Map ",
      suffix: "- stopped vehicles",
    },
    Depots: {
      prefix: "Depots ",
      suffix: "- vehicles located",
    },
    Maintenance: {
      prefix: "Maintenance ",
      suffix: "- vehicles in maintenance",
    }, 
    Critical: {
      prefix: "Critical Alerts ",
      suffix: "- immediate attention vehicles",
    },
    "Critical-Arrivals": {
      prefix: "Critical Arrivals ",
      suffix: "- critical vehicles in depots",
    },
    Tippers: {
      prefix: "Tippers ",
      suffix: "- TFP Tipper operation",
    },
    Debrief: {
      prefix: "Debrief ",
      suffix: "- driver debrief form",
    },
    default: {
      prefix: "Dashboard",
    },
  };

  const toggleKioskMode = () => {
    setIsKioskMode((prevMode) => {
      const next = !prevMode;
      if (next) {
        setIsCollapsed(true);
        setIsMobileSidebarOpen(false);
      }
      return next;
    });
  };


  const [isMobile, setIsMobile] = useState(
    window.matchMedia("(max-width: 768px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = () => setIsMobile(mq.matches);

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleSidebarToggle = () => {
    if (isMobile) {
      // Mobile: fully show/hide sidebar (no collapsed rail)
      setIsMobileSidebarOpen(v => !v);
      return;
    }
    // Desktop: collapse/expand rail
    setIsCollapsed(v => !v);
  };

  useEffect(() => {
    // If no token, redirect to login immediately
    if (!token) {
      handleLogout();
    }
  }, [token, handleLogout]);

  const HEADER_HEIGHT = 120;

  const contentOverlayStyle: React.CSSProperties = {
    position: "fixed",
    top: HEADER_HEIGHT,
    left: "var(--sidebar-current-width)",
    right: 0,
    bottom: 0,
  };

  const [isWideEnoughForKiosk, setIsWideEnoughForKiosk] = useState(
    window.innerWidth > 510
  );

  useEffect(() => {
    const onResize = () => {
      setIsWideEnoughForKiosk(window.innerWidth > 510);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isWideEnoughForKiosk && isKioskMode) {
      toggleKioskMode();
    }
  }, [isWideEnoughForKiosk, isKioskMode]);

  useEffect(() => {
    // next tick + after layout changes
    const t1 = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    const t2 = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 150);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isKioskMode]);

  useEffect(() => {
    const update = () => {
      setIsoWeek(getISOWeek());
      setIsoWeekYear(getISOWeekYear());
    };
    update();

    // update just after local midnight so it stays correct without refresh
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 5, 0);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    const timeoutId = window.setTimeout(() => {
      update();
      const intervalId = window.setInterval(update, 24 * 60 * 60 * 1000);
      (window as any).__isoWeekIntervalId = intervalId;
    }, msUntilMidnight);

    return () => {
      window.clearTimeout(timeoutId);
      const intervalId = (window as any).__isoWeekIntervalId;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  useLayoutEffect(() => {
    if (!weekTooltipOpen) return;
    const btn = weekBtnRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const margin = 10;

    // tooltip width is capped by CSS at 520px
    const tooltipMaxWidth = Math.min(520, window.innerWidth - 24);
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - tooltipMaxWidth - margin));
    const top = rect.bottom + 10;

    setTooltipPos({ top, left });
  }, [weekTooltipOpen]);

  useEffect(() => {
    if (!weekTooltipOpen) return;

    const handler = () => {
      const btn = weekBtnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const margin = 10;
      const tooltipMaxWidth = Math.min(520, window.innerWidth - 24);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - tooltipMaxWidth - margin));
      const top = rect.bottom + 10;
      setTooltipPos({ top, left });
    };

    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [weekTooltipOpen]);

  useLayoutEffect(() => {
    if (!weekTooltipOpen) return;

    const btn = weekBtnRef.current;
    if (!btn) return;

    const btnRect = btn.getBoundingClientRect();
    const bannerCenterX = btnRect.left + btnRect.width / 2;

    // tooltipPos.left is fixed-position left
    const arrowX = bannerCenterX - tooltipPos.left;

    // Clamp arrow within tooltip bounds so it never goes outside rounded corners
    const min = 22;
    const max = 520 - 22; // matches tooltip max width in CSS
    setTooltipArrowX(Math.max(min, Math.min(arrowX, max)));
  }, [weekTooltipOpen, tooltipPos.left]);

  useEffect(() => {
    if (!weekTooltipOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      const btn = weekBtnRef.current;
      const tip = tooltipRef.current;

      if (btn?.contains(t)) return;
      if (tip?.contains(t)) return;

      setWeekTooltipOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [weekTooltipOpen]);

  useEffect(() => {
    const onChange = () => setLocationTick(t => t + 1);
    window.addEventListener(LOCATION_DEPOTS_EVENT, onChange);
    return () => window.removeEventListener(LOCATION_DEPOTS_EVENT, onChange);
  }, []);

  const depotHeaderLabel = useMemo(() => {
    void locationTick;

    const claims = getUserClaims();
    const isAdmin = claims?.role === "admin";

    // Non-Admin → show their depot, not ALL
    if (!isAdmin) {
      const depot = claims?.depot;

      return depot
        ? (DEPOT_CODE[depot] ?? depot.slice(0, 3).toUpperCase())
        : "";
    }

    // Admin → existing behaviour unchanged
    let selected: string[] = [];
    try {
      const raw = localStorage.getItem(LOCATION_DEPOTS_KEY);
      selected = raw ? JSON.parse(raw) : [];
    } catch {
      selected = [];
    }

    if (!selected || selected.length === 0) return "ALL";

    const normalized = DEPOT_ORDER.filter(d => selected.includes(d));

    if (normalized.length === DEPOT_ORDER.length) return "ALL";

    const codes = normalized.map(
      d => DEPOT_CODE[d] ?? d.slice(0, 3).toUpperCase()
    );

    return codes.join(", ");
  }, [locationTick]);

  type VehicleForWeekTooltip = {
    assetName: string;
    assetRegistration?: string;
    eventType: string;
    locationName?: string;
    formattedAddress?: string;
    ServiceDueDate?: string;
  };

  const queryClient = useQueryClient();

  // Keep a live snapshot of the cached vehicles query so the tooltip stays updated
  const [vehiclesSnapshot, setVehiclesSnapshot] = useState<VehicleForWeekTooltip[]>(
    () => (queryClient.getQueryData<VehicleForWeekTooltip[]>(["vehicles"]) ?? [])
  );

  useEffect(() => {
    // Subscribe to react-query cache changes and refresh our snapshot when "vehicles" updates
    const cache = queryClient.getQueryCache();

    const unsubscribe = cache.subscribe((event) => {
      const key = event?.query?.queryKey;
      if (!key || key[0] !== "vehicles") return;

      const latest = queryClient.getQueryData<VehicleForWeekTooltip[]>(["vehicles"]) ?? [];
      setVehiclesSnapshot(latest);
    });

    // Also sync once on mount (in case query already exists)
    const initial = queryClient.getQueryData<VehicleForWeekTooltip[]>(["vehicles"]) ?? [];
    setVehiclesSnapshot(initial);

    return unsubscribe;
  }, [queryClient]);

  // Vehicles due a service in the CURRENT ISO week/year
  const vehiclesDueThisISOWeek = useMemo(() => {
    const parseServiceDue = (v: VehicleForWeekTooltip): Date | null => {
      const raw = v.ServiceDueDate?.trim();
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    const collator = new Intl.Collator(undefined, {
        sensitivity: "base",
        numeric: true,
      });

    const sorted = vehiclesSnapshot
      .filter((v) => {
        const dueDate = parseServiceDue(v);
        if (!dueDate) return false;
        return getISOWeek(dueDate) === isoWeek && getISOWeekYear(dueDate) === isoWeekYear;
      })
      .map((v) => {
        const regRaw = (v.assetRegistration ?? v.assetName ?? "").trim();
        const actionRaw = (v.eventType ?? "unknown").toLowerCase().trim();
        const locationText = (v.locationName ?? v.formattedAddress ?? "UNKNOWN LOCATION").trim();

        return {
          reg: regRaw,
          actionRaw,
          actionLabel: actionRaw.toUpperCase(),
          locationText,
        };
      })
      .sort((a, b) => collator.compare(a.reg, b.reg));
    
    return servicesSortOrder === "asc" ? sorted : sorted.reverse();
  }, [vehiclesSnapshot, isoWeek, isoWeekYear, servicesSortOrder]);

  if (!token) {
    return null;
  }

  const title = filterTitles[filterOption] ?? filterTitles.default;

  return (
    <div className={`dashboard-container ${isKioskMode ? "kiosk-mode" : ""}`}>
      <div className="app-header" />
      <div className={`dashboard-header ${isKioskMode ? "header-on" : "header-off"}`}>
        <div className={`dashboard-title ${isKioskMode ? "dashboard-title--kiosk" : ""}`}>
          <>
            <h2>
              <span className="dashboard-title-prefix">
                {isKioskMode ? "Stopped Vehicles Leaderboard" : title.prefix}
              </span>
              <span className="dashboard-title-suffix">
                {isKioskMode
                  ? " - stopped vehicles outside of a depot/maintenance site"
                  : (title.suffix ?? "")}
              </span>
              {(
                filterOption === "Services" ||
                filterOption === "Night-Out"
              ) && (
                <div className="dashboard-depots-indicator">
                  {!isKioskMode && depotHeaderLabel && ` (${depotHeaderLabel})`}
                </div>
              )}
            </h2>

            {isKioskMode && (
              <div className="highlight-figures kiosk-title-stats" aria-label="Leaderboard timing bands">
                <span className="figure-pill figure-pill--red">
                  <span className="figure-dot figure-dot--red" aria-hidden="true" />
                  {kioskStats.red}: 4 Hours+
                </span>
                <span className="figure-pill figure-pill--orange">
                  <span className="figure-dot figure-dot--orange" aria-hidden="true" />
                  {kioskStats.orange}: 2-4 Hours
                </span>
                <span className="figure-pill figure-pill--yellow">
                  <span className="figure-dot figure-dot--yellow" aria-hidden="true" />
                  {kioskStats.yellow}: 1-2 Hours
                </span>
                <span className="figure-pill figure-pill--green">
                  <span className="figure-dot figure-dot--green" aria-hidden="true" />
                  {kioskStats.green}: Under 1 Hour
                </span>
              </div>
            )}
          </>
        </div>     
        <div className="dashboard-header-right">
          <div
            ref={weekBtnRef}
            className="iso-week-banner"
            role="button"
            tabIndex={0}
            aria-label={`ISO Week ${isoWeek}`}
            aria-expanded={weekTooltipOpen}
            onClick={() => setWeekTooltipOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setWeekTooltipOpen((v) => !v);
              if (e.key === "Escape") setWeekTooltipOpen(false);
            }}
          >
            <div className="iso-week-banner__label">ISO Week</div>
            <div className="iso-week-banner__value">{isoWeek}</div>
          </div>
          {isWideEnoughForKiosk && (
            <div className="kiosk-toggle">
              <div className={`kiosk-toggle-wrapper ${isKioskMode ? "wrapper-on" : "wrapper-off"}`}>
                <span className="kiosk-toggle-label">Kiosk Mode</span>
                <button
                  className={`kiosk-toggle ${isKioskMode ? "on" : "off"}`}
                  onClick={toggleKioskMode}
                  aria-pressed={isKioskMode}
                  type="button"
                >
                  <span className="sr-only">Toggle Kiosk Mode</span>
                  <span className="kiosk-slider">
                    <span className="kiosk-thumb" />
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <>
        <Sidebar
          onFilterChange={setFilterOption}
          onDepotChange={setSelectedDepots}
          filterOption={filterOption}
          handleLogout={handleLogout}  
          isCollapsed={isKioskMode ? true : isCollapsed}
          setIsCollapsed={setIsCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          onMobileRequestClose={() => setIsMobileSidebarOpen(false)}
          isKioskMode={isKioskMode}
        />

        <button
          type="button"
          className={[
            "sidebar-collapse-toggle",
            isKioskMode ? "is-disabled" : "",
            isMobile
              ? (isMobileSidebarOpen ? "is-mobile-open" : "is-mobile-closed")
              : (isCollapsed ? "is-collapsed" : ""),
          ].join(" ").trim()}
          onClick={() => {
            if (isKioskMode) return;
            handleSidebarToggle();
          }}
          aria-label={
            isKioskMode
              ? "Exit kiosk mode to expand Sidebar"
              : (isMobile
                ? (isMobileSidebarOpen ? "Close sidebar" : "Open sidebar")
                : (isCollapsed ? "Expand sidebar" : "Collapse sidebar"))
          }
          aria-disabled={isKioskMode}
          disabled={isKioskMode}
        >
          <span className="sidebar-collapse-icon" aria-hidden="true" />
        </button>
      </>

      <div className={`dashboard-content ${isKioskMode ? "dashboard-content--kiosk" : ""}`}>
        {isKioskMode ? (
          <Vehicles
            filterOption="Kiosk-Leaderboard"
            selectedDepots={[]}
            isKioskMode={true}
            onKioskStatsChange={setKioskStats}
          />
        ) : filterOption === "Delays" ? (
          <DelaysMap 
            filterOption={filterOption} 
            isKioskMode={false} 
          />
        ) : (
          <Vehicles
            filterOption={filterOption}
            selectedDepots={selectedDepots}
            isKioskMode={false}
          />
        )}
      </div>
      {weekTooltipOpen &&
      createPortal(
        <>
          {/* Frost overlay (clicking it closes) */}         
          <div
            className="iso-week-overlay iso-week-overlay--open"
            style={contentOverlayStyle}
            onClick={() => setWeekTooltipOpen(false)}
          />

          {/* Tooltip */}
          <div
            ref={tooltipRef}
            className="iso-week-tooltip iso-week-tooltip--open"
            style={{ 
              top: tooltipPos.top,
              left: tooltipPos.left,
              ["--arrow-x" as any]: `${tooltipArrowX}px`, 
            }}
          >
            <div className="iso-week-tooltip__panel">
              <div className="iso-week-tooltip__header">
                <div className="iso-week-tooltip__header-left">
                  <div className="iso-week-tooltip__title">Services due this ISO week</div>
                  <div className="iso-week-tooltip__subtitle">
                    Week {isoWeek} • {vehiclesDueThisISOWeek.length} vehicle{vehiclesDueThisISOWeek.length === 1 ? "" : "s"}
                  </div>
                </div>

                <button
                  type="button"
                  className="iso-week-tooltip__sort-toggle"
                  onClick={toggleServicesSortOrder}
                  aria-label={`Sort ${servicesSortOrder === "asc" ? "descending" : "ascending"}`}
                  title={`Sort ${servicesSortOrder === "asc" ? "Z-A" : "A-Z"}`}
                >   
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                    className={`iso-week-tooltip__sort-icon ${
                      servicesSortOrder === "asc" ? "asc" : "desc"
                    }`}
                  >
                    {/* Up arrow */}
                    <path
                      d="M12 4l-5 5h10l-5-5Z"
                      fill="currentColor"
                      opacity={servicesSortOrder === "asc" ? 1 : 0.35}
                    />
                    {/* Down arrow */}
                    <path
                      d="M12 20l5-5H7l5 5Z"
                      fill="currentColor"
                      opacity={servicesSortOrder === "desc" ? 1 : 0.35}
                    />
                  </svg>
                </button>
              </div>

              <div className="iso-week-tooltip__list">
                {vehiclesDueThisISOWeek.length === 0 ? (
                  <div style={{ padding: 10, opacity: 0.8, fontSize: 13 }}>
                    No vehicles due a service in this ISO week.
                  </div>
                ) : (
                  vehiclesDueThisISOWeek.map((v) => (
                    <div className="iso-week-tooltip__item" key={v.reg}>
                      <div className="iso-week-tooltip__row">
                        <div className="iso-week-tooltip__reg">{formatRegistration(v.reg)}</div>
                        <div className="iso-week-tooltip__meta">
                          <span className={`status-pill status-pill--${(v.actionRaw ?? "unknown").toLowerCase()}`}>
                            <span className="status-pill__icon">{renderStatusIcon(v.actionRaw)}</span>
                            <span className="status-pill__text">{(v.actionRaw ?? "UNKNOWN").toUpperCase()}</span>
                          </span>
                          <div className="iso-week-tooltip__loc">{v.locationText ?? "-"}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default Dashboard;
