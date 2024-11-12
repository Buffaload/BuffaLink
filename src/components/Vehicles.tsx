import React from "react";
import "../css/Vehicles.css";

// Define the type for a single vehicle object
interface Vehicle {
  id?: string;
  assetName: string;
  assetRegistration?: string;
  locationName?: string;
  formattedAddress?: string;
  eventType: string;
  date: string;
  locationGroupName?: string;
  assetGroupName?: string;
  // New fields from BlueCrystal API
  ServiceDueDate?: string;
  MotDueDate?: string;
  IsVor?: boolean;
  LiveDefects?: boolean;
}

interface VehiclesProps {
  vehicles: Vehicle[];
  filterOption: string;
}

// Helper function to format date from BlueCrystal data
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0"); // Ensures day is always two digits
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Month is zero-based, hence why I add 1
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

// Helper function to check if the date is older than today
const isDatePast = (dateString: string) => {
  if (!dateString) return false;

  const date = new Date(dateString.trim());
  if (isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of today to avoid time issues

  return date < today; // Returns true if the date is in the past
};

const Vehicles: React.FC<VehiclesProps> = ({ vehicles, filterOption }) => {
  // If filterOption is "Debrief", show the form instead of vehicle cards
  if (filterOption === "Debrief") {
    return (
      <div className="debrief-container">
        <iframe
          src="https://forms.office.com/Pages/ResponsePage.aspx?id=KG0LOI9UKUqEzF1Dxrj5ABC_RfvJHCFIpuo_68d2P49UMlUwNkpaNTJXTDlORU9KRklXSFVaVE84My4u&embed=true"
          title="Debrief form"
          width="100%"
          height="700px"
          allowFullScreen
        ></iframe>
      </div>
    );
  }

  const now = Date.now();
  const filteredVehicles = vehicles.filter((vehicle) => {
    const lastUpdate = new Date(vehicle.date).getTime();
    const timeStopped = now - lastUpdate;

    if (filterOption === "HGVs") {
      // HGVs: Show vehicles stopped for more than 1.5 hours in known locations
      return vehicle.locationName && timeStopped > 1.5 * 60 * 60 * 1000;
    } else if (filterOption === "Services") {
      // Services: Show vehicles stopped for more than 5 minutes with no location name
      return !vehicle.locationName && timeStopped > 5 * 60 * 1000;
    } else if (filterOption === "Depots") {
      // Depots: Show vehicles in depot locations
      return vehicle.locationGroupName === "Buffaload";
    } else if (filterOption === "Maintenance") {
      // Maintenance: Show vehicles in Maintenance
      return vehicle.locationGroupName === "Maintenance";
    } else if (filterOption === "Tippers") {
      // Tippers: Filter only tippers for admin
      return vehicle.assetGroupName === "Ely Tipper Operation";
    }
    return true; // Default: show all vehicles if no filter matches
  });

  return (
    <div className="vehicle-container">
      <h1>{filterOption}</h1>
      <ul className="vehicle-list">
        {filteredVehicles.length > 0 ? (
          filteredVehicles.map((vehicle) => (
            <li key={vehicle.id || vehicle.assetName} className="vehicle-card">
              <h2>{vehicle.assetName}</h2>
              <br />
              <p>
                <b>Last Updated:</b>
                <br />
                {new Date(vehicle.date).toLocaleString()}
              </p>
              <p>
                <br />
                <b>{vehicle.eventType}</b>
              </p>
              <br />
              <p
                style={{
                  color: isDatePast(vehicle.ServiceDueDate ?? "")
                    ? "red"
                    : "#555",
                }}
              >
                <b>Service Due:</b>{" "}
                {vehicle.ServiceDueDate
                  ? formatDate(vehicle.ServiceDueDate)
                  : "N/A"}
              </p>
              <br />
              <p
                style={{
                  color: isDatePast(vehicle.MotDueDate ?? "") ? "red" : "#555",
                }}
              >
                <b>Mot Due:</b>{" "}
                {vehicle.MotDueDate ? formatDate(vehicle.MotDueDate) : "N/A"}
              </p>
              <br />
              {/* Conditionally show VOR and Live Defects only if true */}
              {vehicle.IsVor && (
                <p style={{ color: "red" }}>
                  <b>VOR</b>
                </p>
              )}
              {vehicle.LiveDefects && (
                <p style={{ color: "red" }}>
                  <b>Live Defects</b>
                </p>
              )}
              <br />
              <p>
                <b>Location:</b>
                <br />
                {vehicle.locationName ||
                  vehicle.formattedAddress ||
                  "undefined"}
              </p>
              <br />
            </li>
          ))
        ) : (
          <p>No vehicles found for {filterOption}.</p>
        )}
      </ul>
    </div>
  );
};

export default Vehicles;
