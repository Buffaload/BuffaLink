import express from "express";
import jwt from "jsonwebtoken";
import KioskDevice from "../models/KioskDevice.js";
import getClientIp from "../middleware/getClientIp.js";
import connectDb from "../lib/connectDb.js";

const router = express.Router();

router.get("/check", async (req, res) => {
    try {
        await connectDb();

        const ip = getClientIp(req);
        console.log("Kiosk check request from IP:", ip);

        const kiosk = await KioskDevice.findOne({
            ip,
            isActive: true,
        }).lean();

        if (!kiosk) {
            return res.json({ isKiosk: false });
        }

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is not defined");
            return res.status(500).json({ msg: "Server configuration error" });
        }

        const token = jwt.sign(
            {
                userId: kiosk.autoLoginUserId,
                role: "kiosk",
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        return res.json({
            isKiosk: true,
            token,
        });
    } catch (err) {
        console.error("Kiosk check failed:", err);
        return res.status(500).json({
            msg: "Kiosk detection failed",
            error: err.message,
        });
    }
});

export default router;