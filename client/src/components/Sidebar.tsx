import React, { useEffect, useState } from "react";
import "../css/Sidebar.css";

const Sidebar: React.FC<{ onFilterChange: (filter: string) => void }> = ({
  onFilterChange,
}) => {
  const [userRole, setUserRole] = useState<string>("");
  const [activeButton, setActiveButton] = useState<string>("HGVs"); // Default active button
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false); // State to toggle sidebar
  const [showSubTabs, setShowSubTabs] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      setUserRole(role);
    }
  }, []);

  const handleButtonClick = (filter: string) => {
    setActiveButton(filter);
    onFilterChange(filter); // Pass the filter as a string

    // Show sub tab only for Services
    setShowSubTabs(filter === "Services" || filter === "Night-Out");
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
                activeButton === "Services" || activeButton === "Night-Out"
                  ? "active"
                  : ""
              }`}
              onClick={() => handleButtonClick("Services")}
            >
              Services
            </button>
          </li>
          {/* Sub-tab for "Services" */}
          {showSubTabs && (
            <ul className="sidebar-nav">
              <li>
                <button
                  className={`sidebar-link ${
                    activeButton === "Night-Out" ? "active" : ""
                  }`}
                  onClick={() => handleButtonClick("Night-Out")}
                  style={{
                    fontSize: "14px", // Smaller font size
                    paddingLeft: "50px", // Left indentation
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      transform: "scaleX(-1)", // Flip horizontally
                      marginRight: "8px",
                    }}
                  >
                    ↩
                  </span>
                  Night-Out
                </button>
              </li>
            </ul>
          )}
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
