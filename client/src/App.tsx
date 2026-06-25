import React, { useState, useEffect, useMemo } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import Login from "./components/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./components/Dashboard";
import Vehicles from "./components/Vehicles";
import api from "./api/client";

// Kiosk helpers
const KIOSK_QUERY_PARAM = "kiosk";

const isKioskEntryRequest = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get(KIOSK_QUERY_PARAM) === "1";
};

const clearKioskSession = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("depot");
  localStorage.removeItem("isKioskSession");
  localStorage.removeItem("kioskLocation");
  localStorage.removeItem("kioskDeviceName");
  delete api.defaults.headers.common.Authorization;
};

const persistKioskSession = (payload: {
  token: string;
  role?: string;
  depot?: string;
  kioskLocation?: string | null;
  kioskDeviceName?: string | null;
}) => {
  localStorage.setItem("token", payload.token);
  localStorage.setItem("role", payload.role ?? "kiosk");
  localStorage.setItem("depot", payload.depot ?? "");
  localStorage.setItem("isKioskSession", "1");

  if (payload.kioskLocation) {
    localStorage.setItem("kioskLocation", payload.kioskLocation);
  } else {
    localStorage.removeItem("kioskLocation");
  }

  if (payload.kioskDeviceName) {
    localStorage.setItem("kioskDeviceName", payload.kioskDeviceName);
  } else {
    localStorage.removeItem("kioskDeviceName");
  }
};

function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [selectedDepots] = useState<string[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const kioskEntryRequested = useMemo(() => isKioskEntryRequest(), []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        for (let registration of registrations) {
          registration.unregister(); // Unregister the service worker
        }
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrapKiosk = async () => {
      // Non-kiosk visits should never see kiosk boot UI
      if (!kioskEntryRequested) {
        return;
      }

      // Already authenticated - no need to re-bootstrap
      const existingToken = localStorage.getItem("token");
      if (existingToken) {
        setToken(existingToken);
        return;
      }

      setIsBootstrapping(true);

      try {
        const response = await api.get("/auth/kiosk-check");
        const data = response.data;
        console.log("[kiosk bootstrap] response:", data);

        if (!data?.isKiosk || !data?.token) {
          clearKioskSession();
          if (!cancelled) {
            setToken(null);
          }
          if (!cancelled) {
            setIsBootstrapping(false);
          }
          return;
        }

        persistKioskSession({
          token: data.token,
          role: data.role,
          depot: data.depot,
          kioskLocation: data.kioskLocation,
          kioskDeviceName: data.kioskDeviceName,
        });

        api.defaults.headers.common.Authorization = `Bearer ${data.token}`;

        if (!cancelled) {
          setToken(data.token);
        }
      } catch (error) {
        console.error("[kiosk bootstrap] failed:", error);
        clearKioskSession();

        if (!cancelled) {
          setToken(null);
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    bootstrapKiosk();

    return () => {
      cancelled = true;
    };
  }, [kioskEntryRequested]);

  useEffect(() => {
    if (!kioskEntryRequested) {
      setIsBootstrapping(false);
    }
  }, [kioskEntryRequested]);

  const handleLogin = (userToken: string) => {
    setToken(userToken);
    localStorage.setItem("token", userToken);
  };

  const handleLogout = () => {
      setToken(null);
      clearKioskSession();
  };

  if (isBootstrapping) {
    return <div style={{ padding: "2rem" }}>Starting kiosk session...</div>;
  }

  return (
    <Router>
      <div className="App">
        <Routes>
          {/* Public Route */}
          <Route
            path="/login"
            element={
              !token ? (
                <Login setToken={handleLogin} />
              ) : (
                <Navigate to="/dashboard" />
              )
            }
          />

          {/* Protected Route */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute token={token}>
                <Dashboard handleLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          {/* Protected Route for Vehicles */}
          <Route
            path="/vehicles"
            element={
              <ProtectedRoute token={token}>
                <Vehicles
                  filterOption={""}
                  selectedDepots={selectedDepots} // Pass the selected depots state
                  isKioskMode={false} // Pass the kiosk mode state
                />
              </ProtectedRoute>
            }
          />

          {/* Default redirect if route not found */}
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;

