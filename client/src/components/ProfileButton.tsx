import { APP_VERSION } from "../config/appMeta";
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShieldUser, 
  LogOut,
  Plus,
  Minus,
  SlidersHorizontal,
  X,
  ChevronLeft,
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

const ProfileButton: React.FC<ProfileButtonProps> = ({
  username,
  handleLogout,
}) => {
  const isAdmin = isUserAdmin();
  const portalTitle = isAdmin ? "Admin portal" : "Portal";

  // Get the first letter of the username
  const displayName = normalizeDisplayName(username);

  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PortalView>("menu");

  const [serviceDays, setServiceDays] = useState(() =>
    getNumber(SERVICE_TIMELINE_DAYS_KEY, 42)
  );
  const [motDays, setMotDays] = useState(() =>
    getNumber(MOT_TIMELINE_DAYS_KEY, 364)
  );

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
                <SlidersHorizontal size={16} />
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
          aria-pressed="true"
        >
          <span className="location-tile-left">
            <span className="location-name">All</span>
          </span>
          <span className="location-radio checked" aria-hidden="true" />
        </button>

        {[
          "Ellington",
          "Crewe",
          "Coventry",
          "Skelmersdale",
          "Bellshill",
          "Avonmouth",
        ].map((location) => (
          <button
            key={location}
            type="button"
            className="location-tile"
            aria-pressed="false"
          >
            <span className="location-tile-left">
              <span className="location-name">{location}</span>
            </span>
            <span className="location-radio" aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="profile-button-container">
      <button
        type="button"
        className="logout-button profile-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <ShieldUser size={16} className="logout-icon" />
        <span>{displayName}</span>
      </button>

      {open && createPortal(
        <div className="admin-menu" role="dialog" aria-label={portalTitle}>
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
