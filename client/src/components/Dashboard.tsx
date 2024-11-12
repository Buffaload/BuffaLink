import React, { useState } from "react";
import "../css/Dashboard.css";
import Sidebar from "./Sidebar";
import ProfileButton from "./ProfileButton";
import Vehicles from "./Vehicles";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";

interface DashboardProps {
  handleLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ handleLogout }) => {
  const [filterOption, setFilterOption] = useState<string>("HGVs");
  const username = localStorage.getItem("username") || "";
  const token = localStorage.getItem("token");

  // Hook to fetch vehicles
  const fetchVehicles = async () => {
    if (!token) {
      handleLogout();
      throw new Error("No token found. Please log in.");
    }

    try {
      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      const res = await axios.get(
        "https://buffalink.vercel.app/api/vehicles",
        config
      );

      if (res.status === 200 && Array.isArray(res.data)) {
        return res.data;
      } else {
        throw new Error("Unexpected response format");
      }
    } catch (error) {
      // Narrow down the error type to be AxiosError
      if (axios.isAxiosError(error)) {
        if (error.response && error.response.status === 401) {
          handleLogout(); // Log the user out and redirect to login
          throw new Error("Unauthorized. Redirecting to login.");
        }
        throw new Error(
          error.response?.data?.msg || "Failed to fetch vehicle data"
        );
      }
      throw new Error("An unknown error occurred");
    }
  };

  // useQuery hook for fetching vehicles
  const {
    data: vehicles,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: 30000, // Poll every 30 sec
    staleTime: 60000, // Data is fresh for 1 minute
  });

  // If no token, redirect to login immediately
  if (!token) {
    handleLogout();
    return null; // Prevent rendering of the component
  }

  // Handle filter changes
  const handleFilterChange = (newFilter: string) => {
    setFilterOption(newFilter); // Update the filter option
  };

  // Loading state
  if (isLoading) return <p>Loading...</p>;

  // Error state
  if (isError) return <p>{(error as Error).message}</p>;

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <ProfileButton username={username} handleLogout={handleLogout} />
      </div>
      <Sidebar onFilterChange={handleFilterChange} />
      <div className="dashboard-content">
        <Vehicles vehicles={vehicles ?? []} filterOption={filterOption} />
      </div>
    </div>
  );
};

export default Dashboard;
