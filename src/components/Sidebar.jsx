import React, { useEffect, useState } from "react";
import "../css/Sidebar.css";

const Sidebar = ({ onFilterChange }) => {
  const [userRole, setUserRole] = useState("");
  const [activeButton, setActiveButton] = useState("HGVs"); // Default active button
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // State to toggle sidebar

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      setUserRole(role);
    }
  }, []);

  const handleButtonClick = (filter) => {
    setActiveButton(filter);
    onFilterChange(filter);
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
        <div className="sidebar-footer">
          <a href="" className="contact-button">
            Contacts
          </a>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
