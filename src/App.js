import React, { useState } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom"; // Use 'Routes' and 'Navigate'
import Login from "./components/Login"; // Ensure this is correctly imported
import ProtectedRoute from "./components/ProtectedRoute"; // Ensure this is correctly imported
import Dashboard from "./components/Dashboard"; // Ensure this exists or comment it out if not ready

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
              <ProtectedRoute
                component={Dashboard}
                token={token}
                handleLogout={handleLogout}
              />
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
