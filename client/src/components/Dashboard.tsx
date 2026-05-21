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

const Dashboard: React.FC<DashboardProps> = ({ handleLogout }) => {
  const [filterOption, setFilterOption] = useState<string>("HGVs");
  const [isKioskMode, setIsKioskMode] = useState<boolean>(false);
  const [isoWeek, setIsoWeek] = useState(() => getISOWeek());
  const [isoWeekYear, setIsoWeekYear] = useState(() => getISOWeekYear());
  const [weekTooltipOpen, setWeekTooltipOpen] = useState(false);
  const weekBtnRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const token = localStorage.getItem("token");
  const [selectedDepots, setSelectedDepots] = useState<string[]>([]);

  // Map filter options to their respective titles
  type DashboardTitle = {
    prefix: string;
    suffix?: string;
  };

  const filterTitles: Record<string, DashboardTitle> = {
    HGVs: {
      prefix: "HGVs ",
      suffix: "- stopped >1.5 hrs",
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
      suffix: "- stopped vehicles (past 30 days)",
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
    setIsKioskMode((prevMode) => !prevMode);
  };

  useEffect(() => {
    // If no token, redirect to login immediately
    if (!token) {
      handleLogout();
    }
  }, [token, handleLogout]);

  
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

  // Helper: parse service due date safely (ServiceDueDate comes from BlueCrystal API)
  const parseServiceDue = (v: VehicleForWeekTooltip): Date | null => {
    const raw = v.ServiceDueDate?.trim();
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };

  // Vehicles due a service in the CURRENT ISO week/year
  const vehiclesDueThisISOWeek = useMemo(() => {
    return vehiclesSnapshot
      .filter((v) => {
        const dueDate = parseServiceDue(v);
        if (!dueDate) return false;
        return getISOWeek(dueDate) === isoWeek && getISOWeekYear(dueDate) === isoWeekYear;
      })
      .map((v) => ({
        reg: (v.assetRegistration ?? v.assetName).trim(),
        action: (v.eventType ?? "UNKNOWN").toUpperCase(),
        locationText: (v.locationName ?? v.formattedAddress ?? "UNKNOWN LOCATION").trim(),
      }));
  }, [vehiclesSnapshot, isoWeek, isoWeekYear]);

  if (!token) {
    return null;
  }

  const title = filterTitles[filterOption] ?? filterTitles.default;
  
  return (
    <div className={`dashboard-container ${isKioskMode ? "kiosk-mode" : ""}`}>
      <div className={`app-header ${isKioskMode ? "app-header-on" : "app-header-off"}`} />
      <div className={`dashboard-header ${isKioskMode ? "header-on" : "header-off"}`}>
        <div className="dashboard-title">
          {isKioskMode ? (
            <img src="/fleetpulse-logo-black.png" alt="Logo" className="kiosk-logo" />
          ) : (
            <h2>
              <>
              <span className="dashboard-title-prefix">{title.prefix}</span>
              {title.suffix && (
                <span className="dashboard-title-suffix">
                  {title.suffix}
                </span>
              )}
              </>
            </h2>
          )}
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
        </div>
      </div>

      {!isKioskMode && (
        <Sidebar
          onFilterChange={setFilterOption}
          onDepotChange={setSelectedDepots}
          filterOption={filterOption}
          handleLogout={handleLogout}
        />
      )}

      <div className={`dashboard-content ${isKioskMode ? "dashboard-content--kiosk" : ""}`}>
        {isKioskMode ? (
          <div className="kiosk-layout">
            <div className="kiosk-main">
              <DelaysMap 
                key={`delays-map-${isKioskMode ? "kiosk" : "normal"}`}
                filterOption="Delays" 
                isKioskMode={true} 
              />
            </div>
          </div>
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
            onClick={() => setWeekTooltipOpen(false)}
          />

          {/* Tooltip */}
          <div
            ref={tooltipRef}
            className="iso-week-tooltip iso-week-tooltip--open"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
          >
            <div className="iso-week-tooltip__header">
              <div className="iso-week-tooltip__title">Services due this ISO week</div>
              <div className="iso-week-tooltip__subtitle">
                Week {isoWeek} • {vehiclesDueThisISOWeek.length} vehicle{vehiclesDueThisISOWeek.length === 1 ? "" : "s"}
              </div>
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
                      <div className="iso-week-tooltip__reg">{v.reg}</div>
                      <div className="iso-week-tooltip__meta">
                        <div className="iso-week-tooltip__status">{v.action ?? "-"}</div>
                        <div className="iso-week-tooltip__loc">{v.locationText ?? "-"}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default Dashboard;
