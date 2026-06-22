// routes/kiosk.ts
import express from 'express';
import KioskDevice from '../models/KioskDevice';
import { getClientIp } from '../middleware/getClientIp';
import jwt from 'jsonwebtoken';

const router = express.Router();

router.get('/check', async (req, res) => {
    try {
        const ip = getClientIp(req);

        const kiosk = await KioskDevice.findOne({ ip, isActive: true });

        if (!kiosk) {
            return res.json({ isKiosk: false });
        }

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is not defined");
            return res.status(500).json({ msg: "Server configuration error" });
        }

        // Generate auto-login JWT
        const token = jwt.sign(
            {
                userId: kiosk.autoLoginUserId,
                role: 'kiosk',
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.json({
            isKiosk: true,
            token,
        });
    } catch (err) {
        console.error("Kiosk check failed:", err);
        return res.status(500).json({
            msg: "Kiosk detection failed",
        });
    }
});

export default router;