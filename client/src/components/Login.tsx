import React, { useState } from "react";
import axios from "axios";
import API_BASE_URL from "../config";
import "../css/Login.css";

const Login = ({ setToken }: { setToken: (token: string) => void }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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
        expiryTime = payload.exp ? payload.exp * 1000 : null; // Convert to milliseconds
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
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <img src="/logo.svg" alt="Logo" className="login-logo" />
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" className="login-button">
          LOGIN
        </button>
      </form>
    </div>
  );
};

export default Login;
