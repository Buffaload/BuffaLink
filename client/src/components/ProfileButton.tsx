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

const SERVICE_TIMELINE_DAYS_KEY = "buffalink:serviceTimelineDays";
const MOT_TIMELINE_DAYS_KEY = "buffalink:motTimelineDays";

const ProfileButton: React.FC<ProfileButtonProps> = ({
  username,
  handleLogout,
}) => {
  // Get the first letter of the username
  const userInitial = username ? username.charAt(0).toUpperCase() : "U";
  const isAdmin = isUserAdmin();

  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);

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

  return (
    <div className="profile-button-container">
      <button
        className={isAdmin ? "profile-button profile-button--admin" : "profile-button"}
        onClick={() => setOpen((v) => !v)}
        aria-label="Admin menu"
      >
        <span className="profile-initial">
          {isAdmin ? <ShieldUser size={16} /> : userInitial}
        </span>
      </button>

      <button className="logout-button" onClick={handleLogout}>
        <LogOut size={16} className="logout-icon" />
        <span>Logout</span>
      </button>

      {open && isAdmin && createPortal(
        <div className="admin-menu" role="dialog" aria-label="Admin portal">
          {/* Header */}
          <div className="admin-portal-header">
              <div className="admin-portal-title">
                <span className="admin-menu-title-icon" aria-hidden="true">
                  <SlidersHorizontal size={16} />
                </span>
                <div className="admin-portal-title-block">
                  <span>Settings</span>
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
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProfileButton;
