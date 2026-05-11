import React, { useState, useEffect } from "react";
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

function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [selectedDepots] = useState<string[]>([]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        for (let registration of registrations) {
          registration.unregister(); // Unregister the service worker
        }
      });
    }
  }, []);

  const handleLogin = (userToken: string) => {
    setToken(userToken);
    localStorage.setItem("token", userToken);
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem("token");
  };

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
