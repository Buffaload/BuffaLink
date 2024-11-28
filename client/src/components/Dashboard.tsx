import React, { useState } from "react";
import "../css/Dashboard.css";
import Sidebar from "./Sidebar";
import ProfileButton from "./ProfileButton";
import Vehicles from "./Vehicles";

interface DashboardProps {
  handleLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ handleLogout }) => {
  const [filterOption, setFilterOption] = useState<string>("HGVs");
  const username = localStorage.getItem("username") || "";
  const token = localStorage.getItem("token");
  const [selectedDepots, setSelectedDepots] = useState<string[]>([]);

  // Map filter options to their respective titles
  const filterTitles: { [key: string]: string } = {
    HGVs: "HGVs stopped for more than 1.5 hours in known locations",
    Services:
      "Vehicles stopped in Services and Truckstops as well as Unknown locations",
    "Night-Out": "Vehicles flagged as Night-Out",
    Depots: "Vehicles located in Depots",
    Maintenance: "Vehicles in Maintenance locations",
    Tippers: "Vehicles from the Ely Tipper Operation",
    Debrief: "Driver Debrief form",
    default: "Dashboard", // Default title if filterOption is not recognised
  };

  const getTitle = () => filterTitles[filterOption] || filterTitles.default;

  // If no token, redirect to login immediately
  if (!token) {
    handleLogout();
    return null; // Prevent rendering of the component
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>{getTitle()}</h2>
        <ProfileButton username={username} handleLogout={handleLogout} />
      </div>
      <Sidebar
        onFilterChange={setFilterOption}
        onDepotChange={setSelectedDepots}
        filterOption={filterOption}
      />
      <div className="dashboard-content">
        <Vehicles filterOption={filterOption} selectedDepots={selectedDepots} />
      </div>
    </div>
  );
};

export default Dashboard;
