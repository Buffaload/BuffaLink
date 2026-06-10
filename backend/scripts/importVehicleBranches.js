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
let updated = 0;
let skipped = 0;

for (const row of rows) {
    const rawAssetName = row.VehicleID;
    const rawBranchId = row.BranchID;

    if (!rawAssetName || !rawBranchId) {
        skipped++;
        continue;
    }

    const assetName = normalizeId(rawAssetName);
    const branchId = Number(rawBranchId);

    if (!assetName || Number.isNaN(branchId)) {
        skipped++;
        continue;
    }

    await VehicleMetadata.updateOne(
        { assetName },
        {
            $set: { branchId },
            $setOnInsert: {
            isNightOut: false,
            },
        },
        { upsert: true }
    );

    updated++;
}

console.log("Import complete");
console.log(`   Updated / inserted: ${updated}`);
console.log(`   Skipped rows:       ${skipped}`);

/* Cleanup */
await mongoose.disconnect();
console.log("Disconnected from MongoDB");