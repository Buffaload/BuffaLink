import mongoose from "mongoose";

const kioskDeviceSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    ip: {
        type: String,
        required: true,
        unique: true,
    },
    location: {
        type: String,
    },
    autoLoginUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    isActive: {
        type: Boolean,
        default: true,
    },
}, {
    timestamps: true,
});

export default mongoose.model("KioskDevice", kioskDeviceSchema);