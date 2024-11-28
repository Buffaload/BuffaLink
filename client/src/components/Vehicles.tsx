import React, { useState, useEffect } from "react";
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
  assetType?: string;
  // New fields from BlueCrystal API
  ServiceDueDate?: string;
  MotDueDate?: string;
  IsVor?: boolean;
  LiveDefects?: boolean;
  isNightOut?: boolean;
}

interface VehiclesProps {
  vehicles: Vehicle[];
  filterOption: string;
  selectedDepots: string[];
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

// Helper function to calculate duration since last status change
const getTimeSinceUpdate = (lastUpdated: string) => {
  const now = new Date().getTime();
  const lastUpdate = new Date(lastUpdated).getTime();
  const duration = now - lastUpdate;

  const days = Math.floor(duration / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

  let result = "";
  if (days > 0) result += `${days} days, `; // Include days only if > 0
  if (hours > 0) result += `${hours} hours, `; // Include hours only if > 0
  result += `${minutes} minutes ago`;

  return result;
};

const Vehicles: React.FC<VehiclesProps> = ({
  vehicles: initialVehicles,
  filterOption,
  selectedDepots,
}) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  // Merges the backend data with any local updates
  useEffect(() => {
    setVehicles((prevVehicles) => {
      return initialVehicles.map((vehicle) => {
        const localVehicle = prevVehicles.find(
          (v) => v.assetName === vehicle.assetName
        );
        return localVehicle
          ? { ...vehicle, isNightOut: localVehicle.isNightOut }
          : vehicle;
      });
    });
  }, [initialVehicles]);

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
    if (filterOption === "Night-Out") {
      return vehicle.isNightOut;
    }

    const lastUpdate = new Date(vehicle.date).getTime();
    const timeStopped = now - lastUpdate;

    if (filterOption === "HGVs") {
      // HGVs: Show vehicles stopped for more than 1.5 hours in known locations
      return (
        vehicle.assetType === "HGV" &&
        vehicle.locationName && // Must have a known location
        timeStopped > 1.5 * 60 * 60 * 1000 && // Stopped for more than 1.5 hours
        vehicle.locationGroupName !== "Buffaload" && // Exclude depots
        vehicle.locationGroupName !== "Maintenance" && // Exclude maintenance
        vehicle.assetGroupName !== "Ely Tipper Operation" && // Exclude tippers
        vehicle.locationGroupName !== "Services and Truckstops" // Exclude Services
      );
    } else if (filterOption === "Services") {
      // Services: Show vehicles stopped for more than 5 minutes with no location name and in Services and Truck stops
      return (
        vehicle.assetType === "HGV" &&
        (vehicle.locationGroupName === "Services and Truckstops" ||
          !vehicle.locationGroupName) &&
        timeStopped > 5 * 60 * 1000 &&
        vehicle.locationGroupName !== "Buffaload" && //Exclude depots
        vehicle.locationGroupName !== "Maintenance" && //Exclude maintenance
        vehicle.assetGroupName !== "Ely Tipper Operation" && //Exclude tippers
        !vehicle.isNightOut //Exclude Night-Out vehicles
      );
    } else if (filterOption === "Depots") {
      if (selectedDepots.length === 0) {
        // Depots: Show vehicles in depot locations
        return (
          vehicle.locationGroupName === "Buffaload" && // Only vehicles in depots
          vehicle.assetGroupName !== "Ely Tipper Operation" //Exclude tippers
        );
      }

      // show vehicles for the selected depots
      return selectedDepots.some((depot) => {
        switch (depot) {
          case "Ellington":
            return (
              vehicle.locationGroupName === "Buffaload" &&
              vehicle.locationName === "BUFFALOAD ELLINGTON"
            );
          case "Crewe":
            return (
              vehicle.locationGroupName === "Buffaload" &&
              vehicle.locationName === "BUFFALOAD CREWE"
            );
          case "Skelmersdale":
            return (
              vehicle.locationGroupName === "Buffaload" &&
              vehicle.locationName === "BUFFALOAD SKELMERSDALE"
            );
          default:
            return false;
        }
      });
    } else if (filterOption === "Maintenance") {
      // Maintenance: Show vehicles in Maintenance
      return vehicle.locationGroupName === "Maintenance";
    } else if (filterOption === "Tippers") {
      // Tippers: Filter only tippers for admin
      return vehicle.assetGroupName === "Ely Tipper Operation";
    }
    return true; // Default: show all vehicles if no filter matches
  });

  const getBackgroundColour = (timeStopped: number) => {
    if (timeStopped >= 45 * 60 * 1000) return "pastel-red"; // Red for >= 45min
    if (timeStopped >= 30 * 60 * 1000) return "pastel-orange"; // Orange for >= 30min
    if (timeStopped >= 15 * 60 * 1000) return "pastel-yellow"; // Yellow for >= 15min
    return ""; // Default: no special colour
  };

  // Monitor and toggle "Night-Out" status for driving event
  useEffect(() => {
    const toggleOffNightOutForDriving = async () => {
      for (const vehicle of vehicles) {
        if (vehicle.isNightOut && vehicle.eventType === "driving") {
          await toggleNightOut(vehicle); // Automatically toggle off
        }
      }
    };

    toggleOffNightOutForDriving(); // Call the function
  }, [vehicles]);

  // Function to toggle the Night-Out status of a vehicle
  const toggleNightOut = async (vehicle: Vehicle) => {
    const normalisedAssetName = vehicle.assetName.trim().toLowerCase();

    try {
      const response = await fetch(
        `https://buffa-link-backend.vercel.app/api/vehicles/${encodeURIComponent(
          normalisedAssetName
        )}/night-out`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isNightOut: !vehicle.isNightOut }),
        }
      );

      if (response.ok) {
        setVehicles((prevVehicles) =>
          prevVehicles.map((v) =>
            v.assetName === vehicle.assetName
              ? { ...v, isNightOut: !v.isNightOut }
              : v
          )
        );
      } else {
        console.error("Failed to toggle Night-Out status");
      }
    } catch (error) {
      console.error("Error toggling Night-Out status:", error);
    }
  };

  return (
    <div className="vehicle-container">
      {/* <h1>{filterOption}</h1> */}
      <ul className="vehicle-list">
        {filteredVehicles.length > 0 ? (
          filteredVehicles.map((vehicle) => {
            const lastUpdate = new Date(vehicle.date).getTime();
            const timeStopped = now - lastUpdate;

            //Aply conditional formatting only for "Services"
            const BackgroundColourClass =
              filterOption === "Services"
                ? getBackgroundColour(timeStopped)
                : "";

            return (
              <li
                key={vehicle.id || vehicle.assetName}
                className={`vehicle-card ${
                  vehicle.isNightOut ? "night-out" : ""
                } ${BackgroundColourClass}`} //Adding background colour to the className
              >
                <div
                  className={`vehicle-card-header ${
                    filterOption === "Services" || filterOption === "Night-Out"
                      ? "with-toggle"
                      : "centered"
                  }`}
                >
                  <h2>{vehicle.assetName}</h2>
                  {/* <br />
                <p>
                  <b>Last Updated:</b>
                  <br />
                  {new Date(vehicle.date).toLocaleString()}
                </p> */}
                  {filterOption === "Services" ||
                  filterOption === "Night-Out" ? (
                    <label className="toggle-container">
                      <input
                        type="checkbox"
                        checked={!!vehicle.isNightOut}
                        onChange={() => toggleNightOut(vehicle)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  ) : null}
                </div>
                <p>
                  <br />
                  <b>{vehicle.eventType}</b>
                  <br />
                  <span>{getTimeSinceUpdate(vehicle.date)}</span>
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
                    color: isDatePast(vehicle.MotDueDate ?? "")
                      ? "red"
                      : "#555",
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
            );
          })
        ) : (
          <p>No vehicles found in {filterOption}.</p>
        )}
      </ul>
    </div>
  );
};

export default Vehicles;
