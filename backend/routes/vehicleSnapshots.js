import express from "express";
import auth from "../middleware/auth.js";
import checkRole from "../middleware/role.js";
import connectDb from "../lib/connectDb.js";
import SourceSnapshot from "../models/SourceSnapshot.js";
import { getCombinedVehicleCache } from "./vehicles.js";

const router = express.Router();

// POST /api/vehicles/snapshot-refresh
router.post("/snapshot-refresh", auth, checkRole("admin"), async (req, res) => {
    try {
        await connectDb();

        const combinedCache = getCombinedVehicleCache();

        if (!combinedCache?.data?.length) {
            return res.status(400).json({
                message: "No in-memory combined vehicle cache available to persist.",
            });
        }

        await SourceSnapshot.updateOne(
            { key: "combined" },
            {
                $set: {
                    key: "combined",
                    data: combinedCache.data,
                    count: combinedCache.data.length,
                    updatedAtMs: Date.now(),
                },
            },
            { upsert: true }
        );

        return res.status(200).json({
            message: "Vehicle snapshot refreshed successfully.",
            count: combinedCache.data.length,
            updatedAtMs: Date.now(),
        });
    } catch (err) {
        console.error("[snapshot-refresh] failed:", err.message);
        return res.status(500).json({
            message: "Failed to refresh vehicle snapshot.",
            error: err.message,
        });
    }
});

export default router;
