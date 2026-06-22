const mongoose = require('mongoose');

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

module.exports = mongoose.model('KioskDevice', kioskDeviceSchema);