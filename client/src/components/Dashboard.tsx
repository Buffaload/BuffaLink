import React, { useState, useEffect } from "react";
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

const Dashboard: React.FC<DashboardProps> = ({ handleLogout }) => {
  const [filterOption, setFilterOption] = useState<string>("HGVs");
  const [isKioskMode, setIsKioskMode] = useState<boolean>(false);
  const [isoWeek, setIsoWeek] = useState<number>(() => getISOWeek());
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
    const update = () => setIsoWeek(getISOWeek());
    // Set immediately on mount
    update();
    // Schedule the next update just after local midnight
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 5, 0); // 00:00:05 to avoid edge timing
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    const timeoutId = window.setTimeout(() => {
      update();
      // Then update every 24 hours
      const intervalId = window.setInterval(update, 24 * 60 * 60 * 1000);
      (window as any).__isoWeekIntervalId = intervalId;
    }, msUntilMidnight);

    return () => {
      window.clearTimeout(timeoutId);
      const intervalId = (window as any).__isoWeekIntervalId;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

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
          <div className="iso-week-banner" title="ISO week (Monday-Sunday)">
            <span className="iso-week-banner__label">ISO Week</span>
            <span className="iso-week-banner__value">{isoWeek}</span>
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
    </div>
  );
};

export default Dashboard;
