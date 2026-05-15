import React, { useEffect, useMemo, useState, useRef } from "react";
import { filterVehicles, adjustedMs } from "../utils/vehicleRules";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Building2,
  TriangleAlert,
  ChevronUp,
} from "lucide-react";
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

  const label = isOverdue
    ? `OVERDUE by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? "" : "s"}`
    : daysUntilDue <= 1
    ? "Due within 1 day"
    : `${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} until due`;

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

// Helper function to calculate duration since last status change
const getTimeSinceUpdate = (lastUpdated: string) => {
  const now = Date.now();
  const lastUpdate = adjustedMs(lastUpdated);
  const duration = now - lastUpdate;

  const days = Math.floor(duration / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

  let result = "";
  if (days > 0) result += `${days} days, `; // Include days only if > 0
  if (hours > 0) result += `${hours} hours, `; // Include hours only if > 0
  result += `${minutes} minutes ago`;

  return result;
};

const Vehicles: React.FC<VehiclesProps> = ({
  filterOption,
  selectedDepots,
  isKioskMode,
}) => {
  const queryClient = useQueryClient();
  const [isVorFilterActive, setIsVorFilterActive] = useState(false);
  const [sortOption, setSortOption] = useState<"stoppedTime" | "reg" | "location">("stoppedTime");
  const [searchTerm, setSearchTerm] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  
  useEffect(() => {
    const onScroll = () => {
      const el = scrollRef.current;

      const scrollTop = el
        ? el.scrollTop
        : window.scrollY || document.documentElement.scrollTop || 0;

      setShowBackToTop(scrollTop > 400);
    };

    // Run once on mount
    onScroll();
    const el = scrollRef.current;

    if (el) {
      el.addEventListener("scroll", onScroll, { passive: true });
      return () => el.removeEventListener("scroll", onScroll);
    } else {
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
  }, []);

  const scrollToTop = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Reset scroll position when dashboard view changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const anchor = el.querySelector<HTMLElement>("[data-scroll-top-anchor]");
    if (anchor) {
      anchor.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
      el.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [filterOption]);

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
      return response.data;
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

  const { categoryVehicles, displayVehicles } = useMemo(() => {
    const now = Date.now();

    // 1) Base category list (this is what kiosk pills should match)
    const categoryVehicles = filterVehicles(vehicles, filterOption, selectedDepots, now);

    // 2) Apply client-only filters for display
    let list = categoryVehicles;

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

    // 3) Sort the DISPLAY list only
    const sorted = [...list].sort((a, b) => {
      if (sortOption === "stoppedTime") {
        const aStopped = a.date ? now - adjustedMs(a.date) : 0;
        const bStopped = b.date ? now - adjustedMs(b.date) : 0;
        if (bStopped !== aStopped) return bStopped - aStopped;
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

  // Colours for time stopped
  const getBackgroundColour = (timeStopped: number) => {
    if (timeStopped >= 45 * 60 * 1000) return "pastel-red"; // Red for >= 45min
    if (timeStopped >= 30 * 60 * 1000) return "pastel-orange"; // Orange for >= 30min
    if (timeStopped >= 15 * 60 * 1000) return "pastel-yellow"; // Yellow for >= 15min
    return ""; // Default: no special colour
  };

  // type TipperAlertMode = "breathe" | "flash";
  // const TIPPER_ALERT_MODE: TipperAlertMode = "breathe";

  const getTipperAlertClass = (
    vehicle: {
      eventType?: string | null;
      date?: string | null;
      IsVor?: boolean;
    },
    filterOption: string,
    now: number
  ) => {
    if (vehicle.IsVor) return ""; //no alert if VOR
    if (filterOption !== "Tippers") return "";

    const isDriving = (vehicle.eventType || "").toLowerCase() === "driving";
    const lastMs = vehicle.date
        ? adjustedMs(vehicle.date)
        : NaN;
    const timeStopped = now - lastMs;

    if (isDriving || timeStopped <= 0) return ""; // moving → nothing
    if (timeStopped >= 45 * 60 * 1000)
      // ≥45m → red + faster
      return "pastel-red alert-red alert-critical";
    if (timeStopped >= 15 * 60 * 1000)
      // 15–44m → yellow
      return "pastel-red alert-yellow";

    return "pastel-red"; // <15m → just red card
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
      const response = await fetch(
        `${API_BASE_URL}/vehicles/${encodeURIComponent(
          vehicle.assetName
        )}/night-out`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isNightOut: updatedState }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to toggle Night-Out status");
      }

      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    } catch (error) {
      console.error("Error toggling Night-Out status:", error);

      // rollback
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
  if (isLoading) return <p className="vehicle-placeholder-text">Loading vehicles...</p>;

  // Error state
  if (isError) {
    return <p className="vehicle-placeholder-text">{String(error) || "Failed to fetch vehicles."}</p>;
  }

  return (
    <div className="vehicle-container" ref={scrollRef}>
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
            <span className="wizard-pill-text">VOR only</span>
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
              {highlightFigures.vor} VOR
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
        <p className="vehicle-placeholder-text">
          {categoryVehicles.length === 0
            ? "No stopped vehicles to show."
            : "No vehicles match your current filters (Search/VOR)."}
        </p>
      ) : (
        <ul className={`vehicle-list ${filterOption === "Depots" ? "vehicle-list--depots" : ""} ${filterOption === "Critical" ? "vehicle-list--critical" : ""}`}>
          {displayVehicles.map((vehicle) => {
            const now = Date.now();
            const isVor = !!vehicle.IsVor;
            const lastUpdate = adjustedMs(vehicle.date);
            const timeStopped = now - lastUpdate;

            //Aply conditional formatting only for "Services"
            const BackgroundColourClass =
              !isVor && (filterOption === "Services" || filterOption === "Critical")
                ? getBackgroundColour(timeStopped)
                : "";

            // Apply breathing red effect
            const animationClass = !isVor
              ? getTipperAlertClass(vehicle, filterOption, now)
              : "";

            const vorSkin = isVor ? "vor-muted" : "";
            const serviceProgress = getServiceDueProgress(vehicle.ServiceDueDate ?? "");
            const motProgress = getDueProgress(vehicle.MotDueDate ?? "");

            return (
              // Display Dashboard wizard on all pages other than Map/Kiosk mode

              <li
                key={vehicle.assetName}
                className={`vehicle-card ${vorSkin} ${
                  vehicle.isNightOut ? "night-out" : ""
                } ${BackgroundColourClass}  ${animationClass}`} //Adding background colour to the className
              >
                <span className="vehicle-card-content-header">
                  {/* Ping dot only when alerting */}
                  {!isVor && animationClass && (
                    <span className="alert-ping" aria-hidden="true" />
                  )}

                  <div
                    className={`vehicle-card-header ${
                      filterOption === "Services" || filterOption === "Night-Out"
                        ? "with-toggle"
                        : "centered"
                    }`}
                  >
                    <h2 className="vehicle-reg">{vehicle.assetName}</h2>
                    {filterOption === "Services" ||
                    filterOption === "Night-Out" ? (
                      <label className="toggle-container">
                        <input
                          type="checkbox"
                          checked={!!vehicle.isNightOut}
                          onChange={() => {
                              if (hasAssetName(vehicle)) {
                                toggleNightOut(vehicle);
                              }
                          }}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    ) : null}
                  </div>
                  <p>
                    <br />
                    <b className="vehicle-status">{vehicle.eventType}</b>
                    <br />
                    <span className="vehicle-time-since-update">
                      {vehicle.date ? getTimeSinceUpdate(vehicle.date) : "--- : --- : ---"}
                    </span>
                  </p>
                  <br />
                  <hr></hr>
                </span>
                <span className="vehicle-card-main">
                  <br />
                  {serviceProgress ? (
                    <div className="due-progress-block">
                      <div className="due-progress-row">
                        <span className="due-progress-label">Service health</span>
                        <span className="due-progress-days">
                          {serviceProgress.label}
                        </span>
                      </div>
                      <div className="due-progress-bar">
                        <div
                          className={`due-progress-bar-inner ${serviceProgress.colorClass}`}
                          style={{ width: `${serviceProgress.percentage}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="due-progress-block">
                      <div className="due-progress-row">
                        <span className="due-progress-label">Service health</span>
                        <span className="due-progress-days"></span>
                      </div>
                      <div className="due-progress-bar empty-progress-bar">
                        <div
                          className={`due-progress-bar-inner`}
                          style={{ width: `0` }}
                        />
                      </div>
                    </div>
                  )}
                  {serviceProgress ? (
                    <p className="vehicle-subheading"
                      style={{
                        color: isDatePast(vehicle.ServiceDueDate ?? "")
                          ? "red"
                          : "#555",
                      }}
                    >
                      <span className="vehicle-due-span">Due:</span>{" "}
                      <b className="vehicle-due-dates">
                        {vehicle.ServiceDueDate
                        ? formatDate(vehicle.ServiceDueDate)
                        : "N/A"}
                      </b>
                    </p>
                  ) : (
                    <p className="vehicle-subheading"
                      style={{
                        color: "#555",
                      }}
                    >
                      <span className="vehicle-due-span">Date not available</span>
                    </p>
                  )}
                  <br />
                  {motProgress ? (
                    <div className="due-progress-block">
                      <div className="due-progress-row">
                        <span className="due-progress-label">MOT health</span>
                        <span className="due-progress-days">
                          {motProgress.label}
                        </span>
                      </div>
                      <div className="due-progress-bar">
                        <div
                          className={`due-progress-bar-inner ${motProgress.colorClass}`}
                          style={{ width: `${motProgress.percentage}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="due-progress-block">
                      <div className="due-progress-row">
                        <span className="due-progress-label">MOT health</span>
                        <span className="due-progress-days"></span>
                      </div>
                      <div className="due-progress-bar empty-progress-bar">
                        <div
                          className={`due-progress-bar-inner`}
                          style={{ width: `0` }}
                        />
                      </div>
                    </div>
                  )}
                  {motProgress ? (
                    <p className="vehicle-subheading"
                      style={{
                        color: isDatePast(vehicle.MotDueDate ?? "")
                          ? "red"
                          : "#555",
                      }}
                    >
                      <span className="vehicle-due-span">Due:</span>{" "}
                      <b className="vehicle-due-dates">
                        {vehicle.MotDueDate ? formatDate(vehicle.MotDueDate) : "N/A"}
                      </b>
                    </p>
                  ) : (
                    <p className="vehicle-subheading"
                      style={{
                        color: "#555",
                      }}
                    >
                      <span className="vehicle-due-span">Date not available</span>
                    </p>
                  )}
                  <br />
                  {/* Conditionally show VOR and Live Defects only if true */}
                  {vehicle.LiveDefects && (
                    <p style={{ color: "red" }}>
                      <b>LIVE DEFECTS</b>
                    </p>
                  )}
                  <br />
                </span>
                <span className="vehicle-card-footer">
                  <hr></hr>
                  <br />
                  <p className="vehicle-subheading">
                    Location:{" "}
                    <span className="vehicle-location">
                      {vehicle.locationName ??
                        vehicle.formattedAddress ??
                        "undefined"}
                    </span>
                  </p>
                  <br />
                </span>
              </li>
            );
          })}
        </ul>
      )}
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
      <p className="vehicle-disclaimer">Vehicle data is fetched every 30 seconds.</p>
    </div>
  );
};

export default Vehicles;
