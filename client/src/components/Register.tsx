import React, { useState } from "react";
import axios from "axios";
import "../css/Login.css"; // Assuming you want the same styles as the login

const Register = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user"); // Default role is user
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        "https://buffalink.vercel.app/api/auth/register",
        {
          username,
          password,
          role, // Include role in the registration
        }
      );

      setSuccess("User registered successfully!");
      setError(null);
      setUsername("");
      setPassword("");
      setRole("user"); // Reset to default role
    } catch (err) {
      setError("Failed to register user. Try again.");
      setSuccess(null);
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
        <select value={role} onChange={(e) => setRole(e.target.value)} required>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        {error && <p style={{ color: "red" }}>{error}</p>}
        {success && <p style={{ color: "green" }}>{success}</p>}
        <button type="submit" className="login-button">
          Register
        </button>
      </form>
    </div>
  );
};

export default Register;
