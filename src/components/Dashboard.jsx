import React, { useEffect, useState } from "react";
import "../css/Dashboard.css";
import Sidebar from "./Sidebar";
import ProfileButton from "./ProfileButton";
import Vehicles from "./Vehicles";

const Dashboard = () => {
  const [username, setUsername] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [filterOption, setFilterOption] = useState("HGVs");

  // Fetch vehicles once when the component mounts

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const response = await fetch("http://localhost:5050/api/vehicles");
        const data = await response.json();
        setVehicles(data); //Stores fetched vehicles
      } catch (err) {
        console.error("Failed to fetch vehicles:", err);
      }
    };

    fetchVehicles(); //Fetches vehicles
  }, []);

  useEffect(() => {
    const storedUsername = localStorage.getItem("username");
    if (storedUsername) {
      setUsername(storedUsername);
    }
  }, []);

  // Handle filter changes
  const handleFilterChange = (option) => {
    setFilterOption(option); //Update the filter option
  };

  const handleLogout = () => {
    localStorage.removeItem("username");
    localStorage.removeItem("token");
    window.location.reload();
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <ProfileButton username={username} handleLogout={handleLogout} />
      </div>
      <Sidebar onFilterChange={handleFilterChange} />
      <div className="dashboard-content">
        <Vehicles vehicles={vehicles} filterOption={filterOption} />
      </div>
    </div>
  );
};

export default Dashboard;
