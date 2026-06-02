import { APP_VERSION } from "../config/appMeta";
import React, { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShieldUser, 
  LogOut,
  Plus,
  Minus,
  SlidersHorizontal,
  X,
  ChevronLeft,
  Settings,
  MapPin,
} from "lucide-react";
import { createPortal } from "react-dom";
import "../css/ProfileButton.css";
interface ProfileButtonProps {
  username: string;
  handleLogout: () => void;
}

const getNumber = (key: string, fallback: number) =>
  Number(localStorage.getItem(key)) || fallback;


const getRoleFromToken = (): string | null => {
  const token = localStorage.getItem("token");
  if (!token) return null;

  try {
    const base64 = token.split(".")[1];
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);

    // Support multiple common claim shapes
    return (
      payload?.role ??
      payload?.Role ??
      payload?.user?.role ??
      payload?.user?.Role ??
      (Array.isArray(payload?.roles) ? payload.roles[0] : null)
    );
  } catch {
    return null;
  }
};

const isUserAdmin = (): boolean => {
  const storedRole = localStorage.getItem("role");
  const role = (storedRole ?? getRoleFromToken() ?? "").toLowerCase();
  return role === "admin";
};

type PortalView = "menu" | "settings" | "location";

const normalizeDisplayName = (username: string): string => {
  if (!username) return "User";

  const base = username.includes(".")
    ? username.split(".")[0]
    : username;

  return base.charAt(0).toUpperCase() + base.slice(1);
};

const SERVICE_TIMELINE_DAYS_KEY = "buffalink:serviceTimelineDays";
const MOT_TIMELINE_DAYS_KEY = "buffalink:motTimelineDays";
const LOCATION_DEPOTS_KEY = "buffalink:locationSelectedDepots";
const LOCATION_DEPOTS_EVENT = "buffalink:locationDepotsChanged";

const ProfileButton: React.FC<ProfileButtonProps> = ({
  username,
  handleLogout,
}) => {
  const isAdmin = isUserAdmin();
  const portalTitle = isAdmin ? "Admin portal" : "Portal";

  // Get the first letter of the username
  const displayName = normalizeDisplayName(username);

  const queryClient = useQueryClient();

  const portalRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PortalView>("menu");

  const [serviceDays, setServiceDays] = useState(() =>
    getNumber(SERVICE_TIMELINE_DAYS_KEY, 42)
  );
  const [motDays, setMotDays] = useState(() =>
    getNumber(MOT_TIMELINE_DAYS_KEY, 364)
  );

  const DEPOTS = [
    "Ellington",
    "Crewe",
    "Coventry",
    "Skelmersdale",
    "Bellshill",
    "Avonmouth",
  ] as const;

  type Depot = (typeof DEPOTS)[number];

  // UI-only selection state (default = ALL selected)
  const [selectedDepots, setSelectedDepots] = useState<Set<Depot>>(
    () => new Set(DEPOTS)
  );

  const allSelected = selectedDepots.size === DEPOTS.length;

  useEffect(() => {
    // Persist as an array of depot names (e.g. ["Ellington", "Crewe"])
    const arr = Array.from(selectedDepots);
    localStorage.setItem(LOCATION_DEPOTS_KEY, JSON.stringify(arr));
    // Notify listeners (Dashboard header) to refresh immediately
    window.dispatchEvent(new Event(LOCATION_DEPOTS_EVENT));
  }, [selectedDepots]);

  const setAll = () => {
    // "All" cannot be deselected; clicking it when already selected does nothing.
    if (allSelected) return;
    setSelectedDepots(new Set(DEPOTS));
  };

  const toggleDepot = (depot: Depot) => {
    setSelectedDepots((prev) => {
      const next = new Set(prev);
      const isChecked = next.has(depot);

      if (isChecked) {
        // Prevent removing the final remaining option
        if (next.size === 1) return prev;
        // If ALL is currently selected, clicking a depot removes just that one
        next.delete(depot);
        return next;
      }

      // Reselect depot
      next.add(depot);
      return next;
    });
  };

  const updateValue = (
    setter: React.Dispatch<React.SetStateAction<number>>,
    key: string,
    value: number
  ) => {
    if (!Number.isInteger(value) || value <= 0) return;
    setter(value);
    localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event("buffalink:timelineChanged"));
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
  };

  const renderMenu = () => (
    <>
      <div className="admin-menu-divider admin-menu-divider--menu" />

      <div className="admin-menu-body admin-menu-body--menu">
        {isAdmin && (
          <>
            <button
              type="button"
              className="admin-setting-tile admin-setting-tile--menu"
              onClick={() => setView("settings")}
            >
              <span className="admin-setting-left">
                <Settings size={16} />
                <span className="admin-setting-label">Settings</span>
              </span>
            </button>

            <button
              type="button"
              className="admin-setting-tile admin-setting-tile--menu"
              onClick={() => setView("location")}
            >
              <span className="admin-setting-left">
                <MapPin size={16} />
                <span className="admin-setting-label">Location</span>
              </span>
            </button>
          </>
        )}

        <button
          type="button"
          className="admin-setting-tile admin-setting-tile--menu"
          onClick={handleLogout}
        >
          <span className="admin-setting-left">
            <LogOut size={16} />
            <span className="admin-setting-label">Logout</span>
          </span>
        </button>
      </div>
    </>
  );

  const renderSettings = () => (
    <>
      <div className="admin-menu-divider" />
      {/* Settings tiles */}
      <div className="admin-menu-body">
        {/* Service timeline */}
        <div className="admin-setting-tile">
          <div className="admin-setting-text">
            <div className="admin-setting-label">Service</div>
            <div className="admin-setting-hint">Days</div>
          </div>

          <div className="admin-stepper" role="group" aria-label="Service timeline days">
            <button
              type="button"
              className="step-btn"
              onClick={() =>
                updateValue(
                  setServiceDays,
                  SERVICE_TIMELINE_DAYS_KEY,
                  serviceDays - 1
                )
              }
              aria-label="Decrease service timeline"
            >
              <Minus size={16} />
            </button>

            <input
              className="step-input"
              type="number"
              value={serviceDays}
              onChange={(e) =>
                updateValue(
                  setServiceDays,
                  SERVICE_TIMELINE_DAYS_KEY,
                  parseInt(e.target.value, 10)
                )
              }
              aria-label="Service timeline value"
            />

            <button
              type="button"
              className="step-btn"
              onClick={() =>
                updateValue(
                  setServiceDays,
                  SERVICE_TIMELINE_DAYS_KEY,
                  serviceDays + 1
                )
              }
              aria-label="Increase service timeline"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* MOT timeline */}
        <div className="admin-setting-tile">
          <div className="admin-setting-text">
            <div className="admin-setting-label">MOT</div>
            <div className="admin-setting-hint">Days</div>
          </div>

          <div className="admin-stepper" role="group" aria-label="MOT timeline days">
            <button
              type="button"
              className="step-btn"
              onClick={() =>
                updateValue(setMotDays, MOT_TIMELINE_DAYS_KEY, motDays - 1)
              }
              aria-label="Decrease MOT timeline"
            >
              <Minus size={16} />
            </button>

            <input
              className="step-input"
              type="number"
              value={motDays}
              onChange={(e) =>
                updateValue(
                  setMotDays,
                  MOT_TIMELINE_DAYS_KEY,
                  parseInt(e.target.value, 10)
                )
              }
              aria-label="MOT timeline value"
            />

            <button
              type="button"
              className="step-btn"
              onClick={() =>
                updateValue(setMotDays, MOT_TIMELINE_DAYS_KEY, motDays + 1)
              }
              aria-label="Increase MOT timeline"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const renderLocation = () => (
    <>
      <div className="admin-menu-divider" />

      <div className="location-grid" role="group" aria-label="Location selection">
        {/* ALL — spans full width */}
        <button
          type="button"
          className="location-tile location-tile--all"
          onClick={setAll}
          aria-pressed={allSelected}
        >
          <span className="location-tile-left">
            <span className="location-name">All</span>
          </span>
          <span
            className={`location-radio ${allSelected ? "checked" : ""}`}
            aria-hidden="true"
          />
        </button>

        {DEPOTS.map((depot) => {
          const checked = selectedDepots.has(depot);

          return (
            <button
              key={depot}
              type="button"
              className="location-tile"
              onClick={() => toggleDepot(depot)}
              aria-pressed={checked}
            >
              <span className="location-tile-left">
                <span className="location-name">{depot}</span>
              </span>
              <span
                className={`location-radio ${checked ? "checked" : ""}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </>
  );

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // If click is inside the portal or the trigger button, ignore
      if (
        portalRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }

      // Otherwise close the portal and reset view
      setOpen(false);
      setView("menu");
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, setView]);

  return (
    <div className="profile-button-container">
      <button
        ref={triggerRef}
        type="button"
        className="logout-button profile-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <ShieldUser size={16} className="logout-icon" />
        <span>{displayName}</span>
      </button>

      {open && createPortal(
        <div 
          ref={portalRef}
          className="admin-menu"
          role="dialog"
          aria-label={portalTitle}
        >
          {/* Header */}
          <div className="admin-portal-header">
              <div className="admin-portal-title">
                {view !== "menu" ? (
                  <button
                    type="button"
                    className="admin-portal-back"
                    onClick={() => setView("menu")}
                    aria-label="Back"
                  >
                    <ChevronLeft size={18} />
                  </button>
                ) : (
                <span className="admin-menu-title-icon" aria-hidden="true">
                  <SlidersHorizontal size={16} />
                </span>
                )}
                <div className="admin-portal-title-block">
                  <span>{view === "menu" ? portalTitle : view === "settings" ? "Settings" : "Location"}</span>
                  <div className="admin-portal-version">{APP_VERSION}</div>
                </div>
              </div>
            <button
              type="button"
              className="admin-portal-close"
              onClick={() => setOpen(false)}
              aria-label="Close admin portal"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          {view === "menu" && renderMenu()}
          {view === "settings" && renderSettings()}
          {view === "location" && renderLocation()}
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProfileButton;
