import mongoose from "mongoose";
import fs from "fs";
import dotenv from "dotenv";
import { parse } from "csv-parse/sync";
import VehicleMetadata from "../models/VehicleMetadata.js";

dotenv.config();

const normalizeId = (value) => {
    if (!value) return "";
    return String(value)
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/[^A-Z0-9]/g, "");
};

const isValidVehicleId = (value) => {
    if (!value) return false;

    const cleaned = String(value)
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/[^A-Z0-9]/g, "");

    // Only allow real vehicle-like IDs (7–8 chars max)
    return cleaned.length > 0 && cleaned.length <= 8;
};

const DEBUG_ALL = false;      // true = print every processed row
const DEBUG_LIMIT = 100;      // limit console spam when DEBUG_ALL = true

const inputFile = process.argv[2];

if (!inputFile) {
    console.error("No CSV file provided.");
    process.exit(1);
}

if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing.");
    process.exit(1);
}

const csv = fs.readFileSync(inputFile, "utf8").replace(/^\uFEFF/, "");

const records = parse(csv, {
    columns: (headers) => 
        headers.map((h) => h.replace(/^\uFEFF/, "").trim()),
    skip_empty_lines: true
});

const describeMongoUri = (uri) => {
    try {
        const u = new URL(uri);
        return {
            host: u.hostname,
            dbFromUri: u.pathname.replace("/", "") || "(none)",
        };
    } catch {
        return { host: "invalid", dbFromUri: "invalid" };
    }
};

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB");

console.log("CONNECTED DB:", mongoose.connection.name);
console.log("CONNECTED HOST:", mongoose.connection.host);

let debugPrinted = 0;

// Optional: dedupe CSV rows first so the last non-null branch wins
const csvByNormalizedKey = new Map();

for (const row of records) {
    const rawVehicleId = row.VehicleID;
    const rawBranchId = row.BranchID;

    const cleanedBranchId =
        rawBranchId !== undefined && rawBranchId !== null
            ? String(rawBranchId).trim()
            : "";

    const parsedBranchId =
        cleanedBranchId !== "" && !isNaN(cleanedBranchId)
            ? Number(cleanedBranchId)
            : null;

    if (!isValidVehicleId(rawVehicleId) || parsedBranchId === null) {
        continue;
    }

    const normalizedVehicleId = normalizeId(rawVehicleId);

    csvByNormalizedKey.set(normalizedVehicleId, {
        rawVehicleId,
        normalizedVehicleId,
        branchId: parsedBranchId,
    });
}

for (const [vehicleId, csvEntry] of csvByNormalizedKey.entries()) {
    const existingDoc = await VehicleMetadata.findOne({
        $expr: {
            $eq: [
                {
                    $replaceAll: {
                        input: { $toUpper: "$assetName" },
                        find: " ",
                        replacement: ""
                    }
                },
                vehicleId
            ]
        }
    }).lean();

    if (vehicleId === "EX24VOF" || vehicleId === "EX24VOY") {
        console.log("INSERT DEBUG:", {
            vehicleId,
            branchId: csvEntry.branchId
        });
    }

    if (existingDoc) {
        await VehicleMetadata.updateOne(
            { _id: existingDoc._id },
            {
                $set: {
                    assetName: vehicleId,
                    branchId: csvEntry.branchId
                }
            }
        );
    } else {
        try {
            await VehicleMetadata.create({
                assetName: vehicleId,
                branchId: csvEntry.branchId,
                isNightOut: false,
                lastEventType: null
            });
        } catch (err) {
            console.error("CREATE FAILED:", vehicleId, err.message);
        }
    }
}

// Final validation snapshot
const finalDocs = await VehicleMetadata.find({
    branchId: { $ne: null },
})
    .select("assetName branchId isNightOut lastEventType")
    .limit(20)
    .lean();

console.log("Total parsed rows:", records.length);
console.log("Valid vehicles:", csvByNormalizedKey.size);

await mongoose.disconnect();
console.log("Disconnected from MongoDB");
