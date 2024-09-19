import React, { useEffect, useState } from "react";
import "../css/Dashboard.css";
import Sidebar from "./Sidebar";
import ProfileButton from "./ProfileButton";
import Vehicles from "./Vehicles";
import axios from "axios";

const Dashboard = () => {
  const [username, setUsername] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [filterOption, setFilterOption] = useState("HGVs");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch vehicles once when the component mounts

  useEffect(() => {
    const storedUsername = localStorage.getItem("username");
    if (storedUsername) {
      setUsername(storedUsername);
    }

    fetchVehicles();

    const intervalId = setInterval(() => {
      fetchVehicles();
    }, 30000);
    return () => clearInterval(intervalId);
  }, []);

  const fetchVehicles = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No token found. Please log in.");
      }

      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      const res = await axios.get("http://localhost:5050/api/vehicles", config);
      if (Array.isArray(res.data)) {
        setVehicles(res.data);
      } else {
        throw new Error("Unexpected response format");
      }
      setLoading(false);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        // If 401 unauthorised, log the user out
        handleLogout();
      } else {
        setError("Failed to fetch vehicle data");
        setLoading(false);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("username");
    localStorage.removeItem("token");
    window.location.href = "/login"; // redirect to login page
  };

  // Handle filter changes
  const handleFilterChange = (newFilter) => {
    setFilterOption(newFilter); //Update the filter option
  };

  if (loading) return <p>Loading...</p>;
  if (error) return <p>{error}</p>;

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
