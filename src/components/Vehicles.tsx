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
}

interface VehiclesProps {
  vehicles: Vehicle[];
  filterOption: string;
}

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
            <li
              key={vehicle.id || vehicle.assetRegistration}
              className="vehicle-card"
            >
              <h2>{vehicle.assetName}</h2>
              <p>
                Location:
                <br />
                {vehicle.locationName ||
                  vehicle.formattedAddress ||
                  "undefined"}
              </p>
              <br />
              <p>
                Event:
                <br />
                {vehicle.eventType}
              </p>
              <br />
              <p>
                Last Updated:
                <br />
                {new Date(vehicle.date).toLocaleString()}
              </p>
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
