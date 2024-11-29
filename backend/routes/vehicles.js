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
    // Fetching credentials from environment variables
    const apiUrl = process.env.API_URL;
    const apiUsername = process.env.API_USERNAME;
    const apiPassword = process.env.API_PASSWORD;

    const blueCrystalApiUrl = process.env.BLUECRYSTAL_API_URL;
    const blueCrystalApiKey = process.env.BLUECRYSTAL_API_KEY;

    // Axios to make the request to the external API
    const [vehicleResponse, blueCrystalResponse, nightOutMetadata] =
      await Promise.allSettled([
        // Fetch data from Michelin
        axios.get(apiUrl, {
          auth: {
            username: apiUsername,
            password: apiPassword,
          },
        }),

        // Fetch data from BlueCrystal
        axios.get(blueCrystalApiUrl, {
          headers: {
            "x-api-key": blueCrystalApiKey,
            "x-end-point": "public.v1",
          },
        }),

        VehicleMetadata.find({}),
      ]);

    if (vehicleResponse.status !== "fulfilled") {
      throw new Error("Failed to fetch vehicles data");
    }
    if (blueCrystalResponse.status !== "fulfilled") {
      throw new Error("Failed to fetch BlueCrystal data");
    }
    if (nightOutMetadata.status !== "fulfilled") {
      throw new Error("Failed to fetch Night-Out metadata from MongoDB");
    }

    // Data normalization
    const vehicles = vehicleResponse.value.data;
    const maintenanceDetails = blueCrystalResponse.value.data;
    const nightOutMap = nightOutMetadata.value.reduce((acc, item) => {
      acc[item.assetName.trim().toUpperCase()] = true; // if assetName exits, its a Night-Out
      return acc;
    }, {});

    // Merge data
    const mergedVehicles = vehicles.map((vehicle) => {
      const normalisedAssetName = vehicle.assetName
        .replace(/\s+/g, "")
        .toUpperCase();

      // Match BlueCrystal data
      const maintenance = maintenanceDetails.find(
        (m) =>
          m.VehicleId.replace(/\s+/g, "").toUpperCase() === normalisedAssetName
      );

      return {
        ...vehicle,
        ServiceDueDate: maintenance?.ServiceDueDate || "N/A",
        MotDueDate: maintenance?.MotDueDate || "N/A",
        IsVor: maintenance?.IsVor ?? false,
        LiveDefects: maintenance?.LiveDefects ?? false,
        isNightOut: !!nightOutMap[normalisedAssetName],
      };
    });

    const user = req.user;
    const filteredVehicles =
      user.role === "admin"
        ? mergedVehicles // admin sees all vehicles
        : mergedVehicles.filter((vehicle) =>
            depotVisibilityRules[user.depot]?.includes(vehicle.assetGroupName)
          );

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
