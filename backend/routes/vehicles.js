import express from "express";
import axios from "axios";
import auth from "../middleware/auth.js";
import VehicleMetadata from "../models/VehicleMetadata.js";
import { depotVisibilityRules } from "../config/visibilityRules.js";

const router = express.Router();

// Fetch vehicles from external API
router.get("/", auth, async (req, res) => {
  console.log("Authenticated request from user:", req.user);

  try {
    // Environment detection: Use NODE_ENV or check for dummy URLs
    const useMockData = process.env.NODE_ENV !== 'production' ||
                       process.env.API_URL?.includes('dummy') ||
                       process.env.BLUECRYSTAL_API_URL?.includes('dummy');

    let vehicles = [];
    let existingVehicles = [];
    let maintenanceDetails = [];
    let volvoVehicles = [];
    let volvoPositions = [];
    let nightOutMetadata = [];

    if (useMockData) {
      // DEVELOPMENT MODE: Return mock data for local development
      console.log("Using mock data for development");

      vehicles = [
        {
          assetName: "HGV001",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: "High Street",
          locationGroupName: "Unknown", // Will show in HGVs filter (not excluded)
          date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          status: "Available"
        },
        {
          assetName: "HGV002",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: "Industrial Estate",
          locationGroupName: "Unknown",
          date: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
          status: "In Transit"
        },
        {
          assetName: "SERVICE001",
          assetType: "HGV",
          assetGroupName: "Services",
          eventType: "stopped",
          locationName: "Moto Service Station, M6 Junction 16",
          locationGroupName: "Services and Truckstops",
          date: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(), // 2.5 hours ago (meets >1.5h criteria)
          latitude: 52.1234,
          longitude: -1.5678,
          formattedAddress: "Moto Service Station, M6 Junction 16, Northamptonshire",
          temperature: 18.5,
          status: "Available"
        },
        {
          assetName: "SERVICE002",
          assetType: "HGV",
          assetGroupName: "Services",
          eventType: "stopped",
          locationName: "Welcome Break, M1 Junction 15a",
          locationGroupName: "Services and Truckstops",
          date: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
          latitude: 52.3456,
          longitude: -1.2345,
          formattedAddress: "Welcome Break Services, M1 Junction 15a, Northamptonshire",
          temperature: 22.3,
          status: "Available"
        },
        {
          assetName: "SERVICE003",
          assetType: "HGV",
          assetGroupName: "Services",
          eventType: "stopped",
          locationName: "Eurotunnel Truckstop",
          locationGroupName: "Services and Truckstops",
          date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
          latitude: 51.0987,
          longitude: 1.3456,
          formattedAddress: "Eurotunnel Freight Services, Folkestone, Kent",
          temperature: 15.7,
          status: "Available"
        },
        {
          assetName: "UNKNOWN001",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: null,
          locationGroupName: null, // Unknown location
          date: new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString(), // 3.5 hours ago
          latitude: 53.4567,
          longitude: -2.7890,
          formattedAddress: "Unknown Location - Manchester Area",
          temperature: 19.8,
          status: "Available"
        },
        {
          assetName: "UNKNOWN002",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: null,
          locationGroupName: null, // Unknown location
          date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
          latitude: 51.6789,
          longitude: -0.1234,
          formattedAddress: "Unknown Location - London Area",
          temperature: 21.2,
          status: "Available"
        },
        {
          assetName: "DEPOT001",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: "BUFFALOAD ELLINGTON",
          locationGroupName: "Buffaload",
          date: new Date().toISOString(),
          latitude: 52.3355,
          longitude: -0.2945,
          formattedAddress: "Buffaload Ellington, Ellington, Huntingdon, Cambridgeshire",
          temperature: 24.0,
          status: "Available"
        },
        {
          assetName: "TIPPER001",
          assetType: "Tipper",
          assetGroupName: "TFP Tipper Operation",
          eventType: "stopped",
          locationName: "Site B",
          locationGroupName: "Buffaload",
          date: new Date().toISOString(),
          latitude: 52.3773,
          longitude: -0.0240,
          formattedAddress: "Mick George, Somersham, Cambridgeshire",
          temperature: 24.0,
          status: "Available"
        },
        {
          assetName: "MAINT001",
          assetType: "HGV",
          assetGroupName: "Maintenance",
          eventType: "stopped",
          locationName: "Maintenance Bay",
          locationGroupName: "Maintenance",
          date: new Date().toISOString(),
          latitude: 52.3355,
          longitude: -0.2945,
          formattedAddress: "Buffaload Ellington, Ellington, Huntingdon, Cambridgeshire",
          temperature: 24.0,
          status: "Under Maintenance"
        }
      ];

      maintenanceDetails = [
        {
          VehicleId: "HGV001",
          ServiceDueDate: "2026-06-15",
          MotDueDate: "2026-08-20",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "HGV002",
          ServiceDueDate: "2027-03-10",
          MotDueDate: "2027-02-15",
          IsVor: true,
          LiveDefects: false
        },
        {
          VehicleId: "SERVICE001",
          ServiceDueDate: "2026-04-30",
          MotDueDate: "2026-06-25",
          IsVor: false,
          LiveDefects: true
        },
        {
          VehicleId: "SERVICE002",
          ServiceDueDate: "2026-07-15",
          MotDueDate: "2026-09-10",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "SERVICE003",
          ServiceDueDate: "2026-05-20",
          MotDueDate: "2026-07-30",
          IsVor: true,
          LiveDefects: true
        },
        {
          VehicleId: "UNKNOWN001",
          ServiceDueDate: "2026-08-01",
          MotDueDate: "2026-10-15",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "UNKNOWN002",
          ServiceDueDate: "2026-06-30",
          MotDueDate: "2026-08-25",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "DEPOT001",
          ServiceDueDate: "2026-07-01",
          MotDueDate: "2026-09-01",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "TIPPER001",
          ServiceDueDate: "2026-07-01",
          MotDueDate: "2026-09-01",
          IsVor: false,
          LiveDefects: false
        },
        {
          VehicleId: "MAINT001",
          ServiceDueDate: "2026-05-15",
          MotDueDate: "2026-07-20",
          IsVor: false,
          LiveDefects: false
        }
      ];

      // Get night-out metadata from MongoDB
      nightOutMetadata = await VehicleMetadata.find({});
    } else {
      // PRODUCTION MODE: Use real external APIs
      console.log("Using real external APIs for production");

      const apiUrl = process.env.API_URL;
      const apiUsername = process.env.API_USERNAME;
      const apiPassword = process.env.API_PASSWORD;
      const blueCrystalApiUrl = process.env.BLUECRYSTAL_API_URL;
      const blueCrystalApiKey = process.env.BLUECRYSTAL_API_KEY;
      const volvoBaseUrl = "https://api.volvotrucks.com/vehicle";
      const volvoUsername = process.env.VOLVO_USERNAME;
      const volvoPassword = process.env.VOLVO_PASSWORD;

      const [vehicleResponse, blueCrystalResponse, volvoVehiclesResponse, volvoPositionsResponse, nightOutMetadataResult] =
        await Promise.allSettled([
          axios.get(apiUrl, {
            auth: {
              username: apiUsername,
              password: apiPassword,
            },
          }),
          axios.get(blueCrystalApiUrl, {
            headers: {
              "x-api-key": blueCrystalApiKey,
              "x-end-point": "public.v1",
            },
          }),
          axios.get(`${volvoBaseUrl}/vehicles`, {
            auth: {
              username: volvoUsername,
              password: volvoPassword,
            },
          }),
          axios.get(`${volvoBaseUrl}/vehiclepositions`, {
            auth: {
              username: volvoUsername,
              password: volvoPassword,
            },
          }),
          VehicleMetadata.find({}),
        ]);

      console.log("=== VOLVO RAW RESPONSES ===");
      console.log("Volvo vehicles status:", volvoVehiclesResponse.status);
      console.log("Volvo positions status:", volvoPositionsResponse.status);

      // Safe extraction check
      console.log(
        "Volvo vehicles length:",
        volvoVehiclesResponse.status === "fulfilled" && volvoVehiclesResponse.value.data
          ? volvoVehiclesResponse.value.data.length
          : "NO DATA"
      );

      console.log(
        "Volvo positions length:",
        volvoPositionsResponse.status === "fulfilled" && volvoPositionsResponse.value.data
          ? volvoPositionsResponse.value.data.length
          : "NO DATA"
      );

      if (vehicleResponse.status !== "fulfilled") {
        console.warn("Primary vehicle API failed — continuing");
        existingVehicles = [];
      } else {
        existingVehicles = vehicleResponse.value.data;
      }
      if (blueCrystalResponse.status !== "fulfilled") {
        console.warn("BlueCrystal API failed — continuing");
        maintenanceDetails = [];
      } else {
        maintenanceDetails = blueCrystalResponse.value.data;
      }
      if (volvoVehiclesResponse.status === "fulfilled" && Array.isArray(volvoVehiclesResponse.value?.data)) {
        volvoVehicles = volvoVehiclesResponse.value.data;
      } else {
        console.warn("Volvo vehicles API failed — continuing");
        volvoVehicles = [];
      }
      if (volvoPositionsResponse.status === "fulfilled" && Array.isArray(volvoPositionsResponse.value?.data)) {
        volvoPositions = volvoPositionsResponse.value.data;
      } else {
        console.warn("Volvo positions API failed — continuing");
        volvoPositions = [];
      }
      if (nightOutMetadataResult.status !== "fulfilled") {
        console.warn("Night-Out metadata from MongoDB API failed — continuing");
        nightOutMetadata = [];
      } else {
        nightOutMetadata = nightOutMetadataResult.value.data;
      }
      
      console.log("=== VOLVO SAMPLE DATA ===");
      console.log("Volvo Vehicle sample:", volvoVehicles[0]);
      console.log("Volvo Position sample:", volvoPositions[0]);

      const mapVolvoVehicles = (volvoVehicles, volvoPositions) => {
        return volvoVehicles.map((v, index) => {
          const position = volvoPositions.find(
            p =>
              p.vehicleId === v.vehicleId ||
              p.id === v.vehicleId ||
              p.id === v.id
          );

          // If no position, skip the vehicle entirely
          if (!position) return null;
          // Extract coordinates (handle nested structure safely)
          const latitude = position.latitude || position.position?.latitude;
          const longitude = position.longitude || position.position?.longitude;
          // If no real coordinates, skip
          if (latitude === undefined || longitude === undefined) {
            return null;
          }

          return {
            assetName: `[VOLVO] ${v.registrationNumber || v.vehicleId || index}`,
            assetType: "HGV",
            assetGroupName: "HGVs",
            eventType: position?.speed > 0 ? "driving" : "stopped",
            locationName: position?.address || "Unknown Location",
            locationGroupName: position?.address ? "Services and Truckstops" : null,
            latitude,
            longitude,
            date: position?.timestamp || new Date().toISOString(),
            status: position?.speed > 0 ? "In Transit" : "Available",
          };
        })
        .filter(Boolean); // Remove null entries
      };

      const volvoMapped = mapVolvoVehicles(volvoVehicles, volvoPositions);

      console.log("=== VOLVO MAPPED ===");
      console.log("Mapped count:", volvoMapped.length);
      console.log("Mapped sample:", volvoMapped.slice(0, 3));

      vehicles = [
        ...existingVehicles,
        ...volvoMapped
      ];

      // === TEMP DEBUG ===
      if (volvoMapped.length > 0) {
        vehicles.push({
          assetName: "[VOLVO TEST]",
          assetType: "HGV",
          assetGroupName: "HGVs",
          eventType: "stopped",
          locationName: "Test Location",
          latitude: 52.3355,
          longitude: -0.2945,
          date: new Date().toISOString(),
          status: "Available",
        });
      }

      console.log("=== VEHICLE MERGE CHECK ===");
      console.log("Total vehicles after merge:", vehicles.length);
    }

    // Data normalization
    const nightOutMap = nightOutMetadata.reduce((acc, item) => {
      acc[item.assetName.trim().toUpperCase()] = true; // if assetName exits, its a Night-Out
      return acc;
    }, {});

    // Merge data
    const mergedVehicles = await Promise.all(
      vehicles.map(async (vehicle) => {
        const normalisedAssetName = vehicle.assetName
          .replace(/\s+/g, "")
          .toUpperCase();

        // Match BlueCrystal data
        const maintenance = maintenanceDetails.find(
          (m) =>
            m.VehicleId.replace(/\s+/g, "").toUpperCase() ===
            normalisedAssetName
        );

        // Check if the vehicle is "driving"
        if (
          vehicle.eventType === "driving" &&
          nightOutMap[normalisedAssetName]
        ) {
          // Remove Night-Out status in MongoDB
          await VehicleMetadata.deleteOne({ assetName: normalisedAssetName });
          nightOutMap[normalisedAssetName] = false; // Update in-memory map
        }

        return {
          ...vehicle,
          ServiceDueDate: maintenance?.ServiceDueDate || "N/A",
          MotDueDate: maintenance?.MotDueDate || "N/A",
          IsVor: maintenance?.IsVor ?? false,
          LiveDefects: maintenance?.LiveDefects ?? false,
          isNightOut: !!nightOutMap[normalisedAssetName],
        };
      })
    );

    // const user = req.user;
    // const filteredVehicles =
    //   user.role === "admin"
    //     ? mergedVehicles // admin sees all vehicles
    //     : mergedVehicles.filter((vehicle) =>
    //         depotVisibilityRules[user.depot]?.includes(vehicle.assetGroupName)
    //       );

    const filteredVehicles = mergedVehicles; // All users see all vehicles

    console.log("=== FINAL FILTERED OUTPUT ===");
    console.log("Final vehicle count:", filteredVehicles.length);

    res.json(filteredVehicles);
  } catch (err) {
    console.error("Error fetching vehicles:", err.message);
    res.status(500).json({ message: "Failed to fetch vehicle data." });
  }
});

router.patch("/:assetName/night-out", async (req, res) => {
  const { assetName } = req.params;
  const { isNightOut } = req.body;

  try {
    const normalisedAssetName = assetName.trim().toUpperCase();

    if (isNightOut) {
      const result = await VehicleMetadata.updateOne(
        { assetName: normalisedAssetName },
        { $set: { assetName: normalisedAssetName, isNightOut: true } },
        { upsert: true } // Create a new document if it doesn't exist
      );

      console.log("Night-Out enabled:", result);
      res
        .status(200)
        .json({ message: `Night-Out status set for ${assetName}.` });
    } else {
      const result = await VehicleMetadata.deleteOne({
        assetName: normalisedAssetName,
      });

      if (result.deletedCount > 0) {
        console.log("Night-Out disabled:", result);
        res
          .status(200)
          .json({ message: `Night-Out status removed for ${assetName}` });
      } else {
        res.status(404).json({ message: "Vehicle not found" });
      }
    }
  } catch (error) {
    console.error("Error updating Night-Out status:", error);
    res.status(500).json({ message: "Failed to update Night-Out status." });
  }
});

export default router;
