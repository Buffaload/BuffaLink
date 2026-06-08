import React, { useState } from "react";
import axios from "axios";
import API_BASE_URL from "../config";
import "../css/Login.css";

const Login = ({ setToken }: { setToken: (token: string) => void }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const togglePasswordVisibility = () => {
    setShowPassword((prev) => !prev);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${API_BASE_URL}/auth/login`,
        {
          username,
          password,
        }
      );

      const token = res.data.token;

      let expiryTime;
      try {
        const payload = JSON.parse(atob(token.split(".")[1])); // Decode JWT payload
        console.log("Decoded Payload:", payload); // Log to check structure
        //expiryTime = payload.exp ? payload.exp * 1000 : null; // Convert to milliseconds
        // TEMP: disable auto‑logout by setting expiry far in the future
        expiryTime = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000; // ~100 years
      } catch (err) {
        console.error("Error decoding token:", err);
        throw new Error("Invalid token format.");
      }

      if (!expiryTime) {
        throw new Error("Token does not contain an expiry time.");
      }

      setToken(token); // Update token state in app

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("tokenExpiry", expiryTime.toString());
      localStorage.setItem("username", username);
      localStorage.setItem("role", res.data.role);

      setError(null);
      window.location.href = "/dashboard";
    } catch (err) {
      setError("Invalid credentials");
    }
  };

  return ( 
    <div className="login-root">
      {/* LEFT PANEL */}
      <div className="login-left">
        <form className="login-form" onSubmit={handleSubmit}>
          <img
            src="/fleetpulse-logo.png"
            alt="FleetPulse"
            className="login-logo"
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <div className="password-wrapper">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-label="Password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={togglePasswordVisibility}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                // Eye-off icon
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5 0-9.27-3-11-8a10.94 10.94 0 0 1 5.17-5.17" />
                  <path d="M1 1l22 22" />
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                </svg>
              ) : (
                // Eye icon
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-button">
            Login
          </button>
        </form>
      </div>

      {/* RIGHT PANEL */}
      <div className="login-right">
        <div className="image-grid">
          <img src="/login1.png" alt="Buffaload HGV left view" />
          <img src="/login2.png" alt="Buffaload HGV right view" />
          <img src="/login3.png" alt="HQ buffalo statue" />
          <img src="/login4.png" alt="Buffaload HGV and vans" />
        </div>
      </div>
    </div>
  );
};

export default Login;
