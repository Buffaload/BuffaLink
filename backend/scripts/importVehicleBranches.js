/**
 * Usage:
 *   node scripts/importVehicleBranches.js ./data/vehicle-branches.xlsx
 *   node scripts/importVehicleBranches.js ./data/vehicle-branches.csv
 */
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import VehicleMetadata from "../models/VehicleMetadata.js";

dotenv.config();

/* Helpers */
const normalizeId = (value) =>
    String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

const die = (msg) => {
    console.error(`Error: ${msg}`);
    process.exit(1);
};

const inputFile = process.argv[2];
if (!inputFile) die("No spreadsheet file provided");

if (!fs.existsSync(inputFile)) {
    die(`File not found: ${inputFile}`);
}

if (!process.env.MONGO_URI) {
    die("MONGO_URI not set in environment");
}

/* Connect */
await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB");

/* Load spreadsheet */
const ext = path.extname(inputFile).toLowerCase();
if (ext !== ".csv") {
    die("Only CSV files are supported. Please convert your spreadsheet to CSV UTF-8.");
}

const csvRaw = fs.readFileSync(inputFile, "utf8");

// Basic CSV parsing (safe for simple 2-column sheets)
const lines = csvRaw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

if (lines.length < 2) {
    die("CSV file contains no data rows");
}

const headers = lines[0].split(",").map(h => h.trim());

if (!headers.includes("VehicleID") || !headers.includes("BranchID")) {
    die("CSV headers must be exactly: VehicleID,BranchID");
}

const vehicleIdx = headers.indexOf("VehicleID");
const branchIdx = headers.indexOf("BranchID");

const rows = lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim());
    return {
        VehicleID: cols[vehicleIdx],
        BranchID: cols[branchIdx],
    };
});

console.log(`Loaded ${rows.length} rows from CSV`);

if (rows.length === 0) {
    die("Spreadsheet contains no rows");
}

console.log(`Loaded ${rows.length} rows from spreadsheet`);

/* Import loop */
const DEBUG_LIMIT = 50; // limit console spam
let debugCount = 0;

for (const row of rows) {
    const rawVehicleId = row.VehicleID;
    const rawBranchId = row.BranchID;
    const vehicleId = normalizeId(rawVehicleId);
    const branchId = rawBranchId ? Number(rawBranchId) : null;

    if (!vehicleId) {
        console.warn("Skipping row (no vehicleId):", row);
        skipped++;
        continue;
    }

    if (!branchId) {
        console.warn("Skipping row (no valid branchId):", {
            rawVehicleId,
            rawBranchId,
        });
        skipped++;
        continue;
    }

    // Fetch existing document
    const existing = await VehicleMetadata.findOne({ assetName: vehicleId });
    const action = existing ? "UPDATE" : "INSERT";

    // Prevent overwriting valid branchId with null
    if (existing && existing.branchId != null && branchId == null) {
        console.warn("Skipping overwrite (existing branchId retained):", {
            vehicleId,
            existingBranchId: existing.branchId,
        });
        skipped++;
        continue;
    }

    // Perform upsert
    const result = await VehicleMetadata.updateOne(
    { assetName: vehicleId },
        {
            $set: {
                branchId, // Always set valid branchId
            },
            $setOnInsert: {
                isNightOut: false, // Preserve defaults
            },
        },
        { upsert: true }
    );

    updated++;

    // Debug output (limited)
    if (debugCount < DEBUG_LIMIT) {
        console.log("IMPORT DEBUG", {
            action,
            rawVehicleId,
            normalizedVehicleId: vehicleId,
            branchId,
            before: existing
            ? {
                branchId: existing.branchId,
                isNightOut: existing.isNightOut,
            }
            : null,
        result:
            result.upsertedCount === 1
                ? "NEW DOC CREATED"
                : "UPDATED",
        });
        debugCount++;
    }
}

console.log("Import complete");
console.log(`   Updated / inserted: ${updated}`);
console.log(`   Skipped rows:       ${skipped}`);

/* Cleanup */
await mongoose.disconnect();
console.log("Disconnected from MongoDB");