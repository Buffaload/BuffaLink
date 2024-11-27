import React, { useEffect, useState } from "react";
import "../css/Sidebar.css";

const Sidebar: React.FC<{
  onFilterChange: (filter: string) => void;
  onDepotChange: (depots: string[]) => void;
  filterOption: string;
}> = ({ onFilterChange, onDepotChange, filterOption }) => {
  const [userRole, setUserRole] = useState<string>("");
  const [activeButton, setActiveButton] = useState<string>("HGVs"); // Default active button
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false); // State to toggle sidebar
  const [selectedDepots, setSelectedDepots] = useState<string[]>([]);

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      setUserRole(role);
    }
  }, []);

  // function for Night-out subtab
  const handleButtonClick = (filter: string) => {
    setActiveButton(filter);
    onFilterChange(filter); // Pass the filter as a string
  };

  const handleSubTabClick = (subTab: string) => {
    setActiveButton(subTab); // keep Parent as active
    onFilterChange(subTab); // Pass the subtab as the active filter
  };

  // function for depots subtab
  const handleDepotClick = (depot: string) => {
    const updatedDepots = selectedDepots.includes(depot)
      ? selectedDepots.filter((item) => item !== depot)
      : [...selectedDepots, depot];

    setSelectedDepots(updatedDepots); // Update local state
    onDepotChange(updatedDepots); // Pass updated depots to parent
  };

  const showDepotSubTabs = filterOption === "Depots";

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
                filterOption === "HGVs" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("HGVs")}
            >
              HGVs
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Services" || filterOption === "Night-Out"
                  ? "active"
                  : ""
              }`}
              onClick={() => handleButtonClick("Services")}
            >
              Services
            </button>
          </li>
          {/* Sub-tab for "Services" */}
          {(filterOption === "Services" || filterOption === "Night-Out") && (
            <ul className="sidebar-nav">
              <li>
                <button
                  className={`sidebar-link ${
                    activeButton === "Night-Out" ? "active" : ""
                  }`}
                  onClick={() => handleSubTabClick("Night-Out")}
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
                filterOption === "Depots" && selectedDepots.length === 0
                  ? "active"
                  : ""
              }`}
              onClick={() => {
                // Clear all subtabs when clicking "Depots"
                handleButtonClick("Depots");
                setSelectedDepots([]);
                onDepotChange([]); // Notify parent about cleared depots
              }}
            >
              Depots
            </button>
          </li>
          {/* Sub-tab for "Depots" */}
          {showDepotSubTabs && (
            <ul className="sidebar-nav">
              <li>
                <button
                  className={`sidebar-link ${
                    selectedDepots.includes("Ellington") ? "active" : ""
                  }`}
                  onClick={() => handleDepotClick("Ellington")}
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
                  Ellington
                </button>
              </li>
              <li>
                <button
                  className={`sidebar-link ${
                    selectedDepots.includes("Crewe") ? "active" : ""
                  }`}
                  onClick={() => handleDepotClick("Crewe")}
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
                  Crewe
                </button>
              </li>
              <li>
                <button
                  className={`sidebar-link ${
                    selectedDepots.includes("Skelmersdale") ? "active" : ""
                  }`}
                  onClick={() => handleDepotClick("Skelmersdale")}
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
                  Skelmersdale
                </button>
              </li>
            </ul>
          )}
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Maintenance" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("Maintenance")}
            >
              Maintenance
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Debrief" ? "active" : ""
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
                  filterOption === "Tippers" ? "active" : ""
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
