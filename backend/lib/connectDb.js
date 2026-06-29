// backend/lib/connectDb.js
import mongoose from "mongoose";


let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = {
        conn: null,
        promise: null,
    };
}

const connectDb = async () => {
    // Reuse existing healthy connection
    if (cached.conn && mongoose.connection.readyState === 1) {
        console.log("[connectDb] Using existing connection");
        return cached.conn;
    }

    // Validate env
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not defined");
    }

    // Create a new connection promise if none exists
    if (!cached.promise) {
        console.log("[connectDb] Creating new connection...");

        cached.promise = mongoose
        .connect(process.env.MONGO_URI, {
            bufferCommands: false,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 5000,
            maxPoolSize: 10,
        })
        .then((mongooseInstance) => {
            console.log("[connectDb] MongoDB connected");
            return mongooseInstance;
        })
        .catch((err) => {
            console.error("[connectDb] Connection failed:", err.message);

            // CRITICAL FIX: reset promise so future requests can retry
            cached.promise = null;
            throw err;
        });
    } else {
        console.log("[connectDb] Awaiting existing connection promise");
    }

    // Await the connection safely
    try {
        cached.conn = await cached.promise;
    } catch (err) {
        // Ensure bad state doesn't persist
        cached.conn = null;
        cached.promise = null;
        throw err;
    }

    return cached.conn;
};

export default connectDb;
