import React, { useEffect, useState } from "react";
import axios from "axios";
import "../css/Vehicles.css";

const Vehicles = () => {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Function to fetch vehicle data
  const fetchVehicles = async () => {
    try {
      // Get the token from localStorage
      const token = localStorage.getItem("token");

      // Set the authorization header
      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      // Make the API request
      const res = await axios.get("http://localhost:5050/api/vehicles", config);

      setVehicles(res.data);
      setLoading(false);
    } catch (err) {
      setError("Failed to fetch vehicle data");
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch vehicles immediately when the component mounts
    fetchVehicles();

    // Set up polling to fetch vehicles every 30 seconds
    const intervalId = setInterval(() => {
      fetchVehicles();
    }, 30000); // 30 seconds

    // Cleanup the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, []); // Empty dependency array ensures this effect runs once

  // Loading and error states
  if (loading) return <p>Loading...</p>;
  if (error) return <p>{error}</p>;

  return (
    <div className="vehicle-container">
      <h1>Vehicles</h1>
      <ul className="vehicle-list">
        {vehicles.map((vehicle) => (
          <li key={vehicle.id} className="vehicle-card">
            <h2>{vehicle.assetRegistration}</h2>
            <p>Location: {vehicle.locationName}</p>
            <p>Event Type: {vehicle.eventType}</p>
            <p>Last Updated: {new Date(vehicle.localDate).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Vehicles;
