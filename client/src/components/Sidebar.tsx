import API_BASE_URL from "../config";
import React, { useEffect, useMemo, useState } from "react";
import { countFor, isCriticalAlert } from "../utils/vehicleRules"
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  Truck,
  Fuel,
  Moon,
  Map,
  Building2,
  Wrench,
  TriangleAlert,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import "../css/Sidebar.css";
import ProfileButton from "./ProfileButton";

interface Vehicle {
  assetName?: string;
  assetType?: string;
  assetGroupName?: string;
  locationGroupName?: string;
  locationName?: string;
  date?: string;
  ServiceDueDate?: string;
  MotDueDate?: string;
}

const Sidebar: React.FC<{
  onFilterChange: (filter: string) => void;
  onDepotChange: (depots: string[]) => void;
  filterOption: string;
  handleLogout: () => void;
}> = ({ onFilterChange, onDepotChange, filterOption, handleLogout }) => {
  const [userRole, setUserRole] = useState<string>("");
  const [activeButton, setActiveButton] = useState<string>("HGVs"); // Default active button
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false); // State to toggle sidebar
  const [selectedDepots, setSelectedDepots] = useState<string[]>([]);
  const showDepotSubTabs = filterOption === "Depots";

  const DEPOTS = [
    "Ellington",
    "Crewe",
    "Coventry",
    "Skelmersdale",
    "Belshill",
    "Avonmouth",
  ];

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      setUserRole(role);
    }
  }, []);

  // Fetch vehicles data
  const fetchVehicles = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("No token found. Please log in.");
    }
    const response = await axios.get(`${API_BASE_URL}/vehicles`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 200) {
      const data = response.data;
      
      if (Array.isArray(data)) {
        return data;
      }

      if (Array.isArray(data?.vehicles)) {
        return data.vehicles;
      }

      return [];
    }
    throw new Error("Failed to fetch vehicles");
  };

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: false, // Poll every 30 sec
    staleTime: 60000, // Data is fresh for 1 minute
  });

  // Calculate counts for badges
  const counts = useMemo(() => {
    const now = Date.now();
    return {
      hgvsCount: countFor(vehicles, "HGVs", [], now),
      maintenanceCount: countFor(vehicles, "Maintenance", [], now),
      criticalCount: vehicles.filter(isCriticalAlert).length,
      tippersCount: countFor(vehicles, "Tippers", [], now),
    };
  }, [vehicles]);

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
    // If empty => treat as ALL selected (default)
    const currentlyAll = selectedDepots.length === 0;

    let updatedDepots: string[];

    if (currentlyAll) {
      // Clicking one when "ALL" is active => start filtering by excluding that depot
      updatedDepots = DEPOTS.filter((d) => d !== depot);
    } else {
      updatedDepots = selectedDepots.includes(depot)
        ? selectedDepots.filter((item) => item !== depot)
        : [...selectedDepots, depot];
    }

    // If user ends up selecting all explicitly, collapse back to [] which means ALL
    if (updatedDepots.length === DEPOTS.length) {
      setSelectedDepots([]);
      onDepotChange([]);
      return;
    }

    setSelectedDepots(updatedDepots);
    onDepotChange(updatedDepots);
  };

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  const location = useLocation();

  useEffect(() => {
    // Only close automatically on small viewports
    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    if (isMobile && isSidebarOpen) {
      setIsSidebarOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const forceScrollToTop = () => {
    // Hard reset
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    // Compensate for dynamic padding / header overlap
    requestAnimationFrame(() => {
      window.scrollBy({ top: -140, left: 0, behavior: "auto" });
    });
  };

  return (
    <>
      <button
        className={`hamburger-menu ${isSidebarOpen ? "open" : ""}`}
        onClick={toggleSidebar}
        aria-label={isSidebarOpen ? "Close menu" : "Open menu"}
        aria-expanded={isSidebarOpen}
      >
        <span />
        <span />
        <span />
      </button>

      <div className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <img
              src="/fleetpulse-logo.png"
              alt="FleetPulse"
              className="sidebar-logo"
            />
        </div>
        <ul className="sidebar-nav">
          <li className="sidebar-section-heading">FLEET</li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "HGVs" ? "active" : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("HGVs");
              }}
            >
              <span className="sidebar-link-text"><Truck className="sidebar-icon" />HGVs</span>
              <span className="sidebar-link-meta sidebar-value--grey">{counts.hgvsCount}</span>
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Services" || filterOption === "Night-Out" || filterOption === "Delays"
                  ? "active"
                  : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("Services");
              }}
            >            
              <span className="sidebar-link-text">
                <Fuel className="sidebar-icon" />
                Services
              </span>       
              <span className="sidebar-link-meta sidebar-chevron">
                {filterOption === "Services" ? (
                    <ChevronUp size={16} />
                  ) : ( 
                    <ChevronDown size={16} /> 
                  )}
              </span>
            </button>
          </li>
          {/* Sub-tab for "Services" */}
          {(filterOption === "Services" || filterOption === "Night-Out" || filterOption === "Delays") && (
            <ul className="sidebar-nav">
              <li>
                <button
                  className={`sidebar-link ${
                    activeButton === "Night-Out" ? "active" : ""
                  }`}            
                  onClick={() => {
                    forceScrollToTop();
                    handleSubTabClick("Night-Out");
                  }}
                  style={{
                    fontSize: "14px", // Smaller font size
                    paddingLeft: "50px", // Left indentation
                  }}
                >
                  <span className="sidebar-nav--submenu"> 
                    <span
                      style={{
                        display: "inline-block",
                        transform: "scaleX(-1)", // Flip horizontally
                        marginRight: "8px",
                      }}
                    >
                      ↩
                    </span>
                    <Moon className="sidebar-icon" />
                    Night-Out
                  </span> 
                </button>
              </li>
              <li className="map-sidebar-link">
                <button
                  className={`sidebar-link ${
                    activeButton === "Delays" ? "active" : ""
                  }`}
                  onClick={() => {
                    forceScrollToTop();
                    handleSubTabClick("Delays");
                  }}
                  style={{
                    fontSize: "14px", // Smaller font size
                    paddingLeft: "50px", // Left indentation
                  }}
                >
                  <span className="sidebar-nav--submenu"> 
                    <span
                      style={{
                        display: "inline-block",
                        transform: "scaleX(-1)", // Flip horizontally
                        marginRight: "8px",
                      }}
                    >
                      ↩
                    </span>
                    <Map className="sidebar-icon" />
                    Map
                  </span>
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
                forceScrollToTop();
                handleButtonClick("Depots");
                setSelectedDepots([]);
                onDepotChange([]); // Notify parent about cleared depots
              }}
            >      
              <span className="sidebar-link-text">
                <Building2 className="sidebar-icon" />
                Depots
              </span>

              <span className="sidebar-link-meta sidebar-chevron">
                {filterOption === "Depots" ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </span>
            </button>
          </li>
          {/* Sub-tab for "Depots" */}
          {showDepotSubTabs && (
            <div className="depot-grid" role="group" aria-label="Depot filter">
              {DEPOTS.map((depot) => {
                // If empty => ALL is selected in the UI
                const effectiveSelected =
                  selectedDepots.length === 0 ? DEPOTS : selectedDepots;

                const checked = effectiveSelected.includes(depot);

                return (
                  <button
                    key={depot}
                    type="button"
                    className="depot-tile"
                    onClick={() => {
                      forceScrollToTop();
                      handleDepotClick(depot);
                    }}
                    aria-pressed={checked}
                  >
                    <span className="depot-tile-left">
                      <span className="depot-name">{depot}</span>
                    </span>

                    <span
                      className={`depot-radio ${checked ? "checked" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          )}
              {/* <li>
                <button
                  className={`sidebar-link ${
                    selectedDepots.includes("Ellington") ? "active" : ""
                  }`}
                  onClick={() => {
                    forceScrollToTop();
                    handleDepotClick("Ellington");
                  }}
                  style={{
                    fontSize: "14px", // Smaller font size
                    paddingLeft: "50px", // Left indentation
                  }}
                >
                  <span className="sidebar-nav--submenu">
                    <span
                      style={{
                        display: "inline-block",
                        transform: "scaleX(-1)", // Flip horizontally
                        marginRight: "8px",
                      }}
                    >
                      ↩
                    </span>
                    <Building className="sidebar-icon" />
                    Ellington
                  </span>
                </button>
              </li>
              <li>
                <button
                  className={`sidebar-link ${
                    selectedDepots.includes("Crewe") ? "active" : ""
                  }`}
                  onClick={() => {
                    forceScrollToTop();
                    handleDepotClick("Crewe");
                  }}
                  style={{
                    fontSize: "14px", // Smaller font size
                    paddingLeft: "50px", // Left indentation
                  }}
                >
                  <span className="sidebar-nav--submenu">
                    <span
                      style={{
                        display: "inline-block",
                        transform: "scaleX(-1)", // Flip horizontally
                        marginRight: "8px",
                      }}
                    >
                      ↩
                    </span>
                    <Building className="sidebar-icon" />
                    Crewe
                  </span>
                </button>
              </li>
              <li>
                <button
                  className={`sidebar-link ${
                    selectedDepots.includes("Skelmersdale") ? "active" : ""
                  }`}
                  onClick={() => {
                    forceScrollToTop();
                    handleDepotClick("Skelmersdale");
                  }}
                  style={{
                    fontSize: "14px", // Smaller font size
                    paddingLeft: "50px", // Left indentation
                  }}
                >
                  <span className="sidebar-nav--submenu">
                    <span
                      style={{
                        display: "inline-block",
                        transform: "scaleX(-1)", // Flip horizontally
                        marginRight: "8px",
                      }}
                    >
                      ↩
                    </span>
                    <Building className="sidebar-icon" />
                    Skelmersdale
                  </span>
                </button>
              </li>
            </ul>
          )} */}
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Maintenance" ? "active" : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("Maintenance");
              }}
            >
              <span className="sidebar-link-text"><Wrench className="sidebar-icon" />Maintenance</span>
              <span className="sidebar-link-meta sidebar-value--grey">{counts.maintenanceCount}</span>
            </button>
          </li>
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Critical" ? "active" : ""
              }`}
              onClick={() => {
                forceScrollToTop();
                handleButtonClick("Critical");
              }}
            >
              <span className="sidebar-link-text"><TriangleAlert className="sidebar-icon" />Critical Alerts</span>
              <span className={`sidebar-link-meta ${counts.criticalCount > 0 ? "sidebar-badge alert-pop--sidebar" : "sidebar-value--grey"}`}>{counts.criticalCount}</span>
            </button>
          </li>
          {userRole === "admin" && (
            <>
              <li className="sidebar-section-heading">CONTRACTS</li>
              <li>
                <button
                  className={`sidebar-link ${
                    filterOption === "Tippers" ? "active" : ""
                  }`}
                  onClick={() => {
                    forceScrollToTop();
                    handleButtonClick("Tippers");
                  }}
                >
                  <span className="sidebar-link-text"><FileText className="sidebar-icon" />Tippers</span>
                  <span className="sidebar-link-meta sidebar-value--grey">{counts.tippersCount}</span>
                </button>
              </li>
            </>
          )}
        </ul>

        {/* Profile Button at bottom of sidebar */}
        <div className="sidebar-profile">
          <ProfileButton
            username={localStorage.getItem("username") || ""}
            handleLogout={handleLogout}
          />
        </div>
      </div>
    </>
  );
};

export default Sidebar;
