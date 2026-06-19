import mongoose from "mongoose";
import fs from "fs";
import dotenv from "dotenv";
import { parse } from "csv-parse/sync";
import VehicleMetadata from "../models/VehicleMetadata.js";

dotenv.config();

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
    columns: (headers) => headers.map((h) => h.replace(/^\uFEFF/, "").trim()),
    skip_empty_lines: true,
});

const TRACE_IDS = new Set([
    "BV72NZZ",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected to MongoDB");
console.log("CONNECTED DB:", mongoose.connection.name);
console.log("CONNECTED HOST:", mongoose.connection.host);

const failed = [];
let processedRows = 0;
let skippedRows = 0;
let upsertedRows = 0;
let successfulWrites = 0;

for (const row of records) {
    const rawVehicleId = row.VehicleID;
    const rawBranchId = row.BranchID;

    const vehicleId =
        rawVehicleId !== undefined && rawVehicleId !== null
            ? String(rawVehicleId).trim()
            : "";

    const cleanedBranchId =
        rawBranchId !== undefined && rawBranchId !== null
            ? String(rawBranchId).trim()
            : "";

    const parsedBranchId =
        cleanedBranchId !== "" && !Number.isNaN(Number(cleanedBranchId))
            ? Number(cleanedBranchId)
            : null;

    const shouldTrace =
        TRACE_IDS.has(vehicleId) ||
        TRACE_IDS.has(
            String(rawVehicleId ?? "")
                .replace(/\s+/g, "")
                .toUpperCase()
        );

    if (shouldTrace) {
        console.log("TRACE RAW ROW:", {
            rawVehicleId,
            rawBranchId,
            vehicleId,
            cleanedBranchId,
            parsedBranchId,
            rowKeys: Object.keys(row),
        });

        console.log("TRACE VEHICLE CODEPOINTS:", [...vehicleId].map((c) => ({
            char: c,
            code: c.charCodeAt(0),
        })));
    }

    if (!vehicleId) {
        if (shouldTrace) {
            console.log("TRACE SKIP: empty vehicleId");
        }
        skippedRows++;
        continue;
    }

    if (parsedBranchId === null) {
        if (shouldTrace) {
            console.log("TRACE SKIP: invalid branchId");
        }
        skippedRows++;
        continue;
    }

    try {
        const result = await VehicleMetadata.updateOne(
            { assetName: vehicleId },
            {
                $set: {
                    assetName: vehicleId,
                    branchId: parsedBranchId,
                },
                $setOnInsert: {
                    isNightOut: false,
                    lastEventType: null,
                },
            },
            { upsert: true }
        );

        if (shouldTrace) {
            console.log("TRACE UPSERT RESULT:", {
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
                upsertedCount: result.upsertedCount,
                upsertedId: result.upsertedId ?? null,
            });

            const verify = await VehicleMetadata.findOne({ assetName: vehicleId })
                .select("assetName branchId")
                .lean();

            console.log("TRACE VERIFY AFTER UPSERT:", verify);
        }

        successfulWrites++;
    } catch (err) {
        failed.push({
            vehicleId,
            branchId: parsedBranchId,
            error: err.message,
        });

        if (shouldTrace) {
            console.error("TRACE UPSERT FAILED:", err);
        } else {
            console.error("UPSERT FAILED:", vehicleId, err.message);
        }
    }

    processedRows++;

    if (processedRows % 250 === 0) {
        console.log(`Progress: ${processedRows}/${records.length}`);
        await sleep(10);
    }
}

console.log("IMPORT COMPLETE");
console.log("Total parsed rows:", records.length);
console.log("Processed rows:", processedRows);
console.log("Skipped rows:", skippedRows);
console.log("Successful upserts:", upsertedRows);
console.log("Failed count:", failed.length);

if (failed.length > 0) {
    console.log("FAILED SAMPLE:", failed.slice(0, 10));
}

await mongoose.disconnect();
console.log("Disconnected from MongoDB");
