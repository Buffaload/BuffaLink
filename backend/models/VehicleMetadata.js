import mongoose from "mongoose";

const vehicleMetadataSchema = new mongoose.Schema({
  assetName: { type: String, required: true, unique: true },
  branchId: { type: Number, index: true, default: null },
  isNightOut: { type: Boolean, default: false }, // Default to false for new entries
  lastEventType: { type: String }, // Track last eventType to automate status change
});

export default mongoose.model("VehicleMetadata", vehicleMetadataSchema);
