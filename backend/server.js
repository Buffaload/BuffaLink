import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import auth from "./middleware/auth.js"; // Auth middleware
import checkRole from "./middleware/role.js"; // Role checking middleware
import authRoutes from "./routes/auth.js"; // Auth routes (register/login)
import vehicleRoutes from "./routes/vehicles.js";
import kioskRoutes from "./routes/kiosk.js";
import User from "./models/User.js";
import vehicleSnapshotRoutes from "./routes/vehicleSnapshots.js";

dotenv.config();

const allowedOrigins = [
  "https://buffalink.vercel.app",
  "http://localhost:3000",
  "http://localhost:5050",
];

// Regex to allow all Vercel preview URLs for BuffaLink Staging
const vercelPreviewRegex = /^https:\/\/buffalink(-[a-z0-9-]+)?\.vercel\.app$/i;
const app = express();

app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (vercelPreviewRegex.test(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Debug-Key",
    "X-Request-Id",
    "Cache-Control",
    "Pragma",
  ],
  exposedHeaders: [
    "X-Debug-Enabled",
    "X-Debug-Query",
    "X-BuffaLink-Build",
    "X-BuffaLink-Ref",
    "X-BuffaLink-Env",
    "X-Request-Id",
  ],
  credentials: true,
};

// Build/instance fingerprint
app.use((req, res, next) => {
  res.set("X-BuffaLink-Build", process.env.VERCEL_GIT_COMMIT_SHA || "local");
  res.set("X-BuffaLink-Ref", process.env.VERCEL_GIT_COMMIT_REF || "");
  res.set("X-BuffaLink-Env", process.env.NODE_ENV || "");
  next();
});

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

//Test route
app.get("/api/test", (req, res) => {
  res.status(200).json({
    message: "BACKEND_NEW_BUILD_CONFIRMED",
    time: new Date().toISOString(),
  });
});

// Public routes
app.use("/api/auth", authRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/kiosk", kioskRoutes);
app.use("/api/vehicles", vehicleSnapshotRoutes);

// Protected route (for admin role)
app.get("/api/admin", auth, checkRole("admin"), (req, res) => {
  res.send("Admin content");
});

// Protected route (for all authenticated users)
app.get("/api/user", auth, (req, res) => {
  res.send("User content");
});

// TEMP: User logging
app.get("/api/debug/users", auth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ msg: "Forbidden" });
    }

    const users = await User.find({}, { username: 1, role: 1, depot: 1, _id: 0 })
      .sort({ username: 1 })
      .lean();

    console.log("=== CURRENT USERS ===");
    console.log(`Total users: ${users.length}`);
    users.forEach((u, i) => {
      console.log(`${i + 1}. ${u.username} | role: ${u.role} | depot: ${u.depot}`);
    });
    console.log("=====================");

    // Return in response too
    return res.json({ count: users.length, users });
  } catch (err) {
    console.error("Failed to fetch users:", err);
    return res.status(500).json({ msg: "Failed to fetch users" });
  }
});

// Start the server
export default function handler(req, res) {
  return app(req, res);
}
