import express from "express";
import jwt from "jsonwebtoken";
import KioskDevice from "../models/KioskDevice.js";
import getClientIp from "../middleware/getClientIp.js";
import connectDb from "../lib/connectDb.js";

const router = express.Router();

const normalizeIp = (value = "") =>
    String(value)
        .trim()
        .replace(/^::ffff:/i, "")
        .replace(/^\[|\]$/g, "");

router.get("/check", async (req, res) => {
    try {
        await connectDb();

        const rawIp = getClientIp(req);
        const ip = normalizeIp(rawIp);

        console.log("Kiosk check request from IP:", { rawIp, ip });

        const kiosk = await KioskDevice.findOne({
            ip,
            isActive: true,
        }).lean();

        if (!kiosk) {
            return res.status(200).json({ isKiosk: false });
        }

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is not defined");
            return res.status(500).json({ msg: "Server configuration error" });
        }

        const role = "kiosk";
        const depot = String(kiosk.location ?? "").trim().toLowerCase();

        const payload = {
            user: {
                id: String(kiosk.autoLoginUserId ?? kiosk._id),
                role,
                depot,
            },
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, {
            expiresIn: "7d",
        });

        return res.status(200).json({
            isKiosk: true,
            token,
            role,
            depot,
            kioskLocation: kiosk.location ?? null,
            kioskDeviceName: kiosk.name ?? null,
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
