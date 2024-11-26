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
    const [vehicleResponse, blueCrystalResponse] = await Promise.all([
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
    ]);

    // console.log("Vehicle Data:", vehicleResponse.data);
    // console.log("BlueCrystal Data:", blueCrystalResponse.data);

    const user = req.user;
    console.log("Authenticated request from user:", user);

    //Determin which assetGroupNames the user can access
    let allowedAssetGroups = []; // Default: no access

    if (user.role === "admin") {
      //Admin has access to all vehicles
      allowedAssetGroups = null; // Null means no filter is applied
    } else if (depotVisibilityRules[user.depot]) {
      allowedAssetGroups = depotVisibilityRules[user.depot];
    } else {
      return res
        .status(403)
        .json({ message: "You are not authorised to view these vehicles." });
    }

    // Extract vehicle data and maintenance details from responses
    const vehicles = vehicleResponse.data;
    const maintenanceDetails = blueCrystalResponse.data;

    const mergedVehicles = vehicles.map((vehicle) => {
      const normalisedAssetName = vehicle.assetName
        .replace(/\s+/g, "")
        .toLowerCase();
      const details = maintenanceDetails.find(
        (detail) =>
          detail.VehicleId.replace(/\s+/g, "").toLowerCase() ===
          normalisedAssetName
      );

      return {
        ...vehicle,
        ServiceDueDate: details?.ServiceDueDate || "N/A",
        MotDueDate: details?.MotDueDate || "N/A",
        IsVor: details?.IsVor ?? false,
        LiveDefects: details?.LiveDefects ?? false,
      };
    });

    const filteredVehicles =
      allowedAssetGroups === null // Admin case
        ? mergedVehicles // No filter for admin
        : mergedVehicles.filter((vehicle) =>
            allowedAssetGroups.includes(vehicle.assetGroupName)
          );

    // Get assetNames to fetch Night-Out status from MongoDB
    const assetNames = filteredVehicles.map((vehicle) => vehicle.assetName);
    const metadata = await VehicleMetadata.find({
      assetName: { $in: assetNames },
    });

    console.log("Fetched Night-Out metadata from MongoDB:", metadata); // Log the fetched metadata

    // Create a Lookup map for Night-Out metadata
    const metadataMap = metadata.reduce((acc, item) => {
      acc[item.assetName] = item.isNightOut; // Store isNightOut directly
      return acc;
    }, {});

    console.log("Constructed metadataMap:", metadataMap); // Log the constructed metadata map

    //Add Night-Out status to the merged vehicle data
    const finalVehicles = filteredVehicles.map((vehicle) => ({
      ...vehicle,
      isNightOut: metadataMap[vehicle.assetName] || false, // Retrieve from metadataMap
    }));

    console.log("Final vehicles with isNightOut:", finalVehicles); // Log final merged data

    // Return the final merged vehicle data to the frontend
    res.json(finalVehicles);
  } catch (err) {
    console.error(err.message);
    res
      .status(500)
      .json({ message: "Failed to fetch vehicle data from external API" });
  }
});

router.patch("/:assetName/night-out", async (req, res) => {
  const { assetName } = req.params;
  const { isNightOut } = req.body;

  console.log("Asset Name received:", assetName);
  console.log("Request body received:", req.body);

  try {
    //Update or insert document with new Night-Out status
    const normalisedAssetName = assetName.trim().toLowerCase();
    if (isNightOut) {
      const result = await VehicleMetadata.updateOne(
        { assetName: normalisedAssetName },
        { $set: { assetName: normalisedAssetName, isNightOut: true } },
        { upsert: true } // Create a new document if it doesn't exist
      );

      console.log("Toggle On result:", result);
      res
        .status(200)
        .json({ message: `Night-Out status updated for ${assetName}` });
    } else {
      const result = await VehicleMetadata.deleteOne({
        assetName: normalisedAssetName,
      });

      console.log("Toggle Off result:", result);
      if (result.deletedCount > 0) {
        res
          .status(200)
          .json({ message: `Night-Out status removed for ${assetName}` });
      } else {
        res.status(404).json({ message: "Vehicle not found" });
      }
    }
  } catch (err) {
    console.error("Error updating Night-Out status:", err);
    res.status(500).json({ message: "Failed to update Night-Out status" });
  }
});

export default router;
