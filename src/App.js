import React, { useState } from "react";
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

  const handleLogin = (userToken) => {
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
                <Vehicles />
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
