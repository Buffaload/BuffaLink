import React, { useState } from "react";
import axios from "axios";
import "../css/Login.css";

const Login = ({ setToken }: { setToken: (token: string) => void }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post("http://localhost:5050/api/auth/login", {
        username,
        password,
      });

      setToken(res.data.token);
      localStorage.setItem("token", res.data.token);
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
          Login
        </button>
      </form>
    </div>
  );
};

export default Login;
