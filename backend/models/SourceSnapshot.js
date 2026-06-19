import mongoose from "mongoose";

const SourceSnapshotSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true }, // michelin | blueCrystal | combined
        data: { type: Array, default: [] },
        count: { type: Number, default: 0 },
        updatedAtMs: { type: Number, default: Date.now },
        integrity: { type: Object, default: {} },
    },
    { timestamps: true }
);

// Prevent recompilation in dev/serverless
export default mongoose.models.SourceSnapshot ||
    mongoose.model("SourceSnapshot", SourceSnapshotSchema);