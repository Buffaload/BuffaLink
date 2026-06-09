/**
 * Usage:
 *   node scripts/importVehicleBranches.js ./data/vehicle-branches.xlsx
 *   node scripts/importVehicleBranches.js ./data/vehicle-branches.csv
 */
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
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
let rows = [];

if (ext === ".xlsx" || ext === ".xls") {
    const workbook = xlsx.readFile(inputFile);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
} else if (ext === ".csv") {
    const workbook = xlsx.readFile(inputFile, { type: "file" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
} else {
    die("Unsupported file type (use .xlsx or .csv)");
}

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