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
console.log(`Loaded ${rows.length} rows from CSV`);

console.log("SCRIPT MONGO URI SUMMARY", describeMongoUri(process.env.MONGO_URI));
console.log("SCRIPT MONGOOSE DB NAME", mongoose.connection?.name);
console.log("SCRIPT VEHICLEMETADATA COLLECTION", VehicleMetadata.collection?.name);

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
        continue;
    }

    csvByNormalizedKey.set(normalizedVehicleId, {
        rawVehicleId: row.VehicleID,
        normalizedVehicleId,
        branchId: parsedBranchId,
    });
}

for (const [vehicleId, csvEntry] of csvByNormalizedKey.entries()) {
    const matchingDocs = await VehicleMetadata.find({
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
    });

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

    if (!canonicalDoc) {
        await VehicleMetadata.create(merged);
    } else {
        await VehicleMetadata.updateOne(
            { _id: canonicalDoc._id },
            { $set: merged }
        );
    }

    // Delete all duplicates except the chosen canonical doc
    const duplicateIds = matchingDocs
        .filter(d => String(d._id) !== String(canonicalDoc?._id))
        .map(d => d._id);

    if (duplicateIds.length > 0) {
        await VehicleMetadata.deleteMany({ _id: { $in: duplicateIds } });
    }
}

// Final validation snapshot
const finalDocs = await VehicleMetadata.find({
    branchId: { $ne: null },
})
    .select("assetName branchId isNightOut lastEventType")
    .limit(20)
    .lean();

const d347After = await VehicleMetadata.findOne({ assetName: "D347" }).lean();
console.log("SCRIPT CHECK D347 AFTER", d347After);

await mongoose.disconnect();
console.log("Disconnected from MongoDB");
