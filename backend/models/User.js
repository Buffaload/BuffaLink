import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "user", enum: ["user", "admin"] }, // Default to 'user', role could be 'admin'
  depot: { type: String, required: true },
});

// Prevent recompilation in dev/serverless
export default mongoose.models.User ||
    mongoose.model("User", userSchema);