import mongoose from "mongoose";
import fs from "fs";
import dotenv from "dotenv";
import VehicleMetadata from "../models/VehicleMetadata.js";

dotenv.config();

const normalizeId = (value) =>
    String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

const DEBUG_ALL = false;      // true = print every processed row
const DEBUG_LIMIT = 100;      // limit console spam when DEBUG_ALL = true
const TARGETS = new Set([
    "AV74VGD",
    "AY19TZP",
    "AY20TVA",
    "BV72NVY",
    "D347",
]);

const inputFile = process.argv[2];

if (!inputFile) {
    console.error("No CSV file provided.");
    process.exit(1);
}

if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing.");
    process.exit(1);
}

const csv = fs.readFileSync(inputFile, "utf8");
const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

if (lines.length < 2) {
    console.error("CSV contains no data rows.");
    process.exit(1);
}

const headers = lines[0].split(",").map((h) => h.trim());
const vehicleIdIndex = headers.indexOf("VehicleID");
const branchIdIndex = headers.indexOf("BranchID");

if (vehicleIdIndex === -1 || branchIdIndex === -1) {
    console.error("CSV headers must include VehicleID and BranchID.");
    process.exit(1);
}

const rows = lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return {
        VehicleID: cols[vehicleIdIndex],
        BranchID: cols[branchIdIndex],
    };
});

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB");
console.log(`Loaded ${rows.length} rows from CSV`);

// Preload all metadata docs once
const existingDocs = await VehicleMetadata.find({}).lean();
console.log(`Loaded ${existingDocs.length} existing VehicleMetadata docs`);

// Group existing docs by normalized assetName
const existingByNormalizedKey = new Map();

for (const doc of existingDocs) {
    const key = normalizeId(doc.assetName);
    if (!key) continue;

    if (!existingByNormalizedKey.has(key)) {
        existingByNormalizedKey.set(key, []);
    }

    existingByNormalizedKey.get(key).push(doc);
}

let processed = 0;
let inserted = 0;
let updated = 0;
let deduped = 0;
let skipped = 0;
let debugPrinted = 0;

// Optional: dedupe CSV rows first so the last non-null branch wins
const csvByNormalizedKey = new Map();

for (const row of rows) {
    const normalizedVehicleId = normalizeId(row.VehicleID);
    const parsedBranchId =
        row.BranchID !== undefined && row.BranchID !== ""
            ? Number(row.BranchID)
            : null;

    if (!normalizedVehicleId || parsedBranchId == null || Number.isNaN(parsedBranchId)) {
        skipped++;
        continue;
    }

    csvByNormalizedKey.set(normalizedVehicleId, {
        rawVehicleId: row.VehicleID,
        normalizedVehicleId,
        branchId: parsedBranchId,
    });
}

for (const [vehicleId, csvEntry] of csvByNormalizedKey.entries()) {
    const matchingDocs = existingByNormalizedKey.get(vehicleId) ?? [];

    const canonicalDoc =
        matchingDocs.find((d) => normalizeId(d.assetName) === d.assetName) ||
        matchingDocs[0] ||
        null;

    const merged = {
        assetName: vehicleId, // canonical normalized storage
        branchId: csvEntry.branchId, // CSV should win
        isNightOut: matchingDocs.some((d) => Boolean(d.isNightOut)),
        lastEventType:
            matchingDocs.find((d) => d.lastEventType)?.lastEventType ?? null,
    };

    const shouldLog =
        TARGETS.has(vehicleId) ||
        (DEBUG_ALL && debugPrinted < DEBUG_LIMIT);

    if (shouldLog) {
        console.log("🔍 IMPORT STEP", {
            rawVehicleId: csvEntry.rawVehicleId,
            normalizedVehicleId: vehicleId,
            csvBranchId: csvEntry.branchId,
                existingMatches: matchingDocs.map((d) => ({
                    id: String(d._id),
                    assetName: d.assetName,
                    branchId: d.branchId ?? null,
                    isNightOut: Boolean(d.isNightOut),
                    lastEventType: d.lastEventType ?? null,
            })),
            merged,
        });
        debugPrinted++;
    }

    if (!canonicalDoc) {
        await VehicleMetadata.create(merged);
        inserted++;
    } else {
        await VehicleMetadata.updateOne(
        { _id: canonicalDoc._id },
        { $set: merged }
        );
        updated++;
    }

    // Delete all duplicates except the chosen canonical doc
    const duplicateIds = matchingDocs
        .filter((d) => !canonicalDoc || String(d._id) !== String(canonicalDoc._id))
        .map((d) => d._id);

    if (duplicateIds.length > 0) {
        await VehicleMetadata.deleteMany({ _id: { $in: duplicateIds } });
        deduped += duplicateIds.length;
    }

    processed++;
}

// Final validation snapshot
const finalDocs = await VehicleMetadata.find({
    branchId: { $ne: null },
})
    .select("assetName branchId isNightOut lastEventType")
    .limit(20)
    .lean();

console.log("IMPORT COMPLETE", {
    processed,
    inserted,
    updated,
    deduped,
    skipped,
});

console.log("FINAL SAMPLE WITH BRANCH", finalDocs);
console.log("SCRIPT MONGO", process.env.MONGO_URI);

await mongoose.disconnect();
console.log("Disconnected from MongoDB");
