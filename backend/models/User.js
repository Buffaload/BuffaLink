import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "user", enum: ["user", "admin"] }, // Default to 'user', role could be 'admin'
});

export default mongoose.model("User", userSchema);
