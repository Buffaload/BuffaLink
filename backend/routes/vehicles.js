import express from "express";
import axios from "axios";
import auth from "../middleware/auth.js";

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

    // Return the merged vehicle data to the frontend
    res.json(mergedVehicles);
  } catch (err) {
    console.error(err.message);
    res
      .status(500)
      .json({ message: "Failed to fetch vehicle data from external API" });
  }
});

export default router;
