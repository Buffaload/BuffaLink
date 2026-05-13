import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import auth from "./middleware/auth.js"; // Auth middleware
import checkRole from "./middleware/role.js"; // Role checking middleware
import authRoutes from "./routes/auth.js"; // Auth routes (register/login)
import vehicleRoutes from "./routes/vehicles.js";

dotenv.config();

const allowedOrigins = [
  "https://buffalink.vercel.app",
  "http://localhost:3000",
  "http://localhost:5050",
];

// Regex to allow all Vercel preview URLs for BuffaLink Staging
const vercelPreviewRegex = /^https:\/\/buffalink(-[a-z0-9-]+)?\.vercel\.app$/i;
const app = express();

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

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("Failed to connect to MongoDB:", err));

//Test route
app.get("/api/test", (req, res) => {
  res.send("Test route works");
});

// Public routes
app.use("/api/auth", authRoutes);
app.use("/api/vehicles", vehicleRoutes);

// Protected route (for admin role)
app.get("/api/admin", auth, checkRole("admin"), (req, res) => {
  res.send("Admin content");
});

// Protected route (for all authenticated users)
app.get("/api/user", auth, (req, res) => {
  res.send("User content");
});

// Start the server
export default app;
