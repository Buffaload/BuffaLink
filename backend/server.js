import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import auth from "./middleware/auth.js"; // Auth middleware
import checkRole from "./middleware/role.js"; // Role checking middleware
import authRoutes from "./routes/auth.js"; // Auth routes (register/login)
import vehicleRoutes from "./routes/vehicles.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
