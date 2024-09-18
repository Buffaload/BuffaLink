import React, { useEffect, useState } from "react";
import "../css/Sidebar.css"; // Import the CSS file for styling

const Sidebar = () => {
  const [userRole, setUserRole] = useState("");

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) {
      setUserRole(role);
    }
  }, []);

  return (
    <div className="sidebar">
      <ul className="sidebar-list">
        <li className="sidebar-item">
          <a href="/hgvs">HGVs</a>
        </li>
        <li className="sidebar-item">
          <a href="/services">Services</a>
        </li>
        <li className="sidebar-item">
          <a href="/depots">Depots</a>
        </li>
        <li className="sidebar-item">
          <a href="/maintenance">Maintenance</a>
        </li>
        {userRole === "admin" && (
          <li className="sidebar-item">
            <a href="/tippers">Tippers</a>
          </li>
        )}
      </ul>
    </div>
  );
};

export default Sidebar;
