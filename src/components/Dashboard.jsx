import React, { useEffect, useState } from "react";
import "../css/Dashboard.css";
import Sidebar from "./Sidebar";
import ProfileButton from "./ProfileButton";

const Dashboard = () => {
  const [username, setUsername] = useState("");

  useEffect(() => {
    const storedUsername = localStorage.getItem("username");
    if (storedUsername) {
      setUsername(storedUsername);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("username");
    localStorage.removeItem("token");
    window.location.reload();
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <ProfileButton username={username} handleLogout={handleLogout} />
      </div>
      <Sidebar />
      <div className="dashboard-content">
        <h1>Welcome to the Dashboard</h1>
        {/* Dashboard content here */}
      </div>
    </div>
  );
};

export default Dashboard;
