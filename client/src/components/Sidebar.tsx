import API_BASE_URL from "../config";
import React, { useEffect, useMemo, useState } from "react";
import { countFor, isCriticalAlert } from "../utils/vehicleRules"
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import {
  Truck,
  Fuel,
  Moon,
  Map,
  Building,
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parse "YYYY-MM-DD" safely as local midnight, also supports ISO strings
const parseDueMs = (s?: string): number => {
  if (!s) return NaN;
  const t = s.trim();
  if (!t) return NaN;
  const d = t.includes("T") ? new Date(t) : new Date(`${t}T00:00:00`);
  return d.getTime();
};

const daysUntil = (s?: string): number | null => {
  const dueMs = parseDueMs(s);
  if (Number.isNaN(dueMs)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((dueMs - today.getTime()) / MS_PER_DAY);
};

// const isCriticalAlert = (v: Vehicle): boolean => {
//   // "Not in a depot"
//   if (v.locationGroupName === "Buffaload") return false;

//   const serviceDays = daysUntil(v.ServiceDueDate);
//   const motDays = daysUntil(v.MotDueDate);

//   // Critical if due in <= 5 days (includes overdue negatives)
//   const threshold = 5;
//   const serviceCritical = serviceDays !== null && serviceDays <= threshold;
//   const motCritical = motDays !== null && motDays <= threshold;

//   return serviceCritical || motCritical;
// };

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
      return response.data;
    }
    throw new Error("Failed to fetch vehicles");
  };

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: fetchVehicles,
    refetchInterval: 30000, // Poll every 30 sec
    staleTime: 60000, // Data is fresh for 1 minute
  });

  // Helper function to parse timestamps with BST fix
  const adjustedMs = (s: string): number => {
    if (!s) return NaN;
    const naive = !/Z$|[+-]\d\d:?\d\d$/.test(s);
    const BST_OFFSET_MS = 60 * 60 * 1000; // 1 hour for BST
    return new Date(s).getTime() + (naive ? BST_OFFSET_MS : 0);
  };

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
          <img
              src="/buffaload-logo.png"
              alt="Buffaload Logistics"
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
              onClick={() => handleButtonClick("HGVs")}
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
              onClick={() => handleButtonClick("Services")}
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
                  onClick={() => handleSubTabClick("Night-Out")}
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
                  onClick={() => handleSubTabClick("Delays")}
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
                  onClick={() => handleDepotClick("Crewe")}
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
                  onClick={() => handleDepotClick("Skelmersdale")}
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
          )}
          <li>
            <button
              className={`sidebar-link ${
                filterOption === "Maintenance" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("Maintenance")}
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
              onClick={() => handleButtonClick("Critical")}
            >
              <span className="sidebar-link-text"><TriangleAlert className="sidebar-icon" />Critical Alerts</span>
              <span className={`sidebar-link-meta ${counts.criticalCount > 0 ? "sidebar-badge alert-pop--sidebar" : "sidebar-value--grey"}`}>{counts.criticalCount}</span>
            </button>
          </li>
          {/* <li>
            <button
              className={`sidebar-link ${
                filterOption === "Debrief" ? "active" : ""
              }`}
              onClick={() => handleButtonClick("Debrief")}
            >
              Debrief
            </button>
          </li> */}
          {userRole === "admin" && (
            <>
              <li className="sidebar-section-heading">CONTRACTS</li>
              <li>
                <button
                  className={`sidebar-link ${
                    filterOption === "Tippers" ? "active" : ""
                  }`}
                  onClick={() => handleButtonClick("Tippers")}
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
