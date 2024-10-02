import React, { useState } from "react";
import "../css/Dashboard.css";
import Sidebar from "./Sidebar";
import ProfileButton from "./ProfileButton";
import Vehicles from "./Vehicles";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";

const Dashboard = () => {
  const [username, setUsername] = useState(
    localStorage.getItem("username") || ""
  );
  const [filterOption, setFilterOption] = useState("HGVs");

  const fetchVehicles = async () => {
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
      return res.data;
    } else {
      throw new Error("Unexpected response format");
    }
  };

  const {
    data: vehicles,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: 30000, // Poll every 30 sec
    staleTime: 60000, // Data is considered fresh for 1 minute
    cacheTime: 300000, // Cahce data for 5 minutes
    refetchOnWindowFocus: false, // Disable refetch when window gains focus
  });

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("username");
    localStorage.removeItem("token");
    window.location.href = "/login"; // Redirect to login page
  };

  // Handle filter changes
  const handleFilterChange = (newFilter) => {
    setFilterOption(newFilter); // Update the filter option
  };

  // Loading state
  if (isLoading) return <p>Loading...</p>;

  // Error state
  if (isError) return <p>{error.message}</p>;

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
