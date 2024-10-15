import React, { useEffect, useState } from "react";
import "../css/Sidebar.css";

// Define props interface for Sidebar
interface SidebarProps {
  onFilterChange: (filter: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onFilterChange }) => {
  const [userRole, setUserRole] = useState<string>("");
  const [activeButton, setActiveButton] = useState<string>("HGVs"); // Default active button
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false); // State to toggle sidebar

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      setUserRole(role);
    }
  }, []);

  const handleButtonClick = (filter: string) => {
    setActiveButton(filter);
    onFilterChange(filter); // Pass the filter as a string
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen); // Toggle sidebar visibility
  };

  return (
    <>
      <button
        className={`hamburger-menu ${isSidebarOpen ? "open" : ""}`}
        onClick={toggleSidebar}
      >
        &#9776;
      </button>

      <div className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>Buffaload Logistics</h2>
        </div>
        <ul className="sidebar-nav">
          <li>
            <button
              className={`sidebar-link ${
                activeButton === "HGVs" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("HGVs")}
            >
              HGVs
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                activeButton === "Services" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("Services")}
            >
              Services
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                activeButton === "Depots" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("Depots")}
            >
              Depots
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                activeButton === "Maintenance" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("Maintenance")}
            >
              Maintenance
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                activeButton === "Debrief" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("Debrief")}
            >
              Debrief
            </button>
          </li>
          {userRole === "admin" && (
            <li>
              <button
                className={`sidebar-link ${
                  activeButton === "Tippers" ? "active" : ""
                }`}
                onClick={() => handleButtonClick("Tippers")}
              >
                Tippers
              </button>
            </li>
          )}
        </ul>
      </div>
    </>
  );
};

export default Sidebar;
