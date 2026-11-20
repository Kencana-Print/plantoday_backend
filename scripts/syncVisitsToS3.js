/**
 * Script untuk sinkronisasi foto kunjungan lama ke S3 NEO NOS
 *
 * Cara pakai:
 * 1. Mode upload file lokal ke S3 & update database:
 *    node scripts/syncVisitsToS3.js
 *
 * 2. Mode upload dari folder custom (misal folder uploads di server):
 *    node scripts/syncVisitsToS3.js --dir=/var/www/plantoday/uploads/visits
 *
 * 3. Mode update database saja (jika file sudah diupload manual via WinSCP ke S3):
 *    node scripts/syncVisitsToS3.js --db-only
 *
 * 4. Mode simulasi (tanpa mengubah apapun):
 *    node scripts/syncVisitsToS3.js --dry-run
 */
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const db = require("../config/dbMain");
const { uploadToS3, getS3PublicUrl } = require("../utils/s3Helper");

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes("--dry-run");
    const isDbOnly = args.includes("--db-only");
    const dirArg = args.find((a) => a.startsWith("--dir="));
    const uploadDir = dirArg
        ? dirArg.replace("--dir=", "")
        : path.join(process.cwd(), "uploads", "visits");

    console.log("=== SINKRONISASI FOTO VISIT KE S3 ===");
    console.log("Mode Dry-run :", isDryRun ? "YA (simulasi)" : "TIDAK");
    console.log("Mode DB-Only :", isDbOnly ? "YA (hanya update DB)" : "TIDAK");
    console.log("Folder Lokal :", uploadDir);
    console.log("-------------------------------------");

    // Ambil data kunjungan yang masih berformat lokal /uploads/visits/
    const [rows] = await db.query(
        `SELECT id, CAST(foto AS CHAR(255)) AS foto
         FROM tkunjungan
         WHERE foto LIKE '/uploads/visits/%'
         ORDER BY id ASC`,
    );

    console.log(`Ditemukan ${rows.length} data kunjungan dengan path lokal.`);

    if (rows.length === 0) {
        console.log("Semua data kunjungan sudah menggunakan format S3 / http.");
        process.exit(0);
    }

    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
        const localPath = row.foto; // Cth: /uploads/visits/3075-1793871861139.jpg
        const filename = path.basename(localPath);
        const s3Key = `images/visits/${filename}`;
        const s3Url = getS3PublicUrl(s3Key);

        if (isDbOnly) {
            // Hanya update DB ke URL S3
            if (!isDryRun) {
                await db.query(`UPDATE tkunjungan SET foto = ? WHERE id = ?`, [
                    s3Url,
                    row.id,
                ]);
            }
            console.log(`[DB-ONLY] [OK] ID ${row.id} -> ${s3Url}`);
            successCount++;
            continue;
        }

        // Cari file di folder lokal
        const fullLocalPath = path.join(uploadDir, filename);
        if (!fs.existsSync(fullLocalPath)) {
            console.warn(
                `[MISSING] ID ${row.id}: File tidak ditemukan di lokal: ${fullLocalPath}`,
            );
            skippedCount++;
            continue;
        }

        try {
            const buffer = await fs.promises.readFile(fullLocalPath);
            const ext = path.extname(filename).toLowerCase();
            const mimeMap = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
            };
            const contentType = mimeMap[ext] || "image/jpeg";

            if (!isDryRun) {
                await uploadToS3({
                    buffer,
                    key: s3Key,
                    contentType,
                });
                await db.query(`UPDATE tkunjungan SET foto = ? WHERE id = ?`, [
                    s3Url,
                    row.id,
                ]);
            }

            console.log(`[UPLOADED] ID ${row.id}: ${filename} -> ${s3Url}`);
            successCount++;
        } catch (err) {
            console.error(`[ERROR] ID ${row.id} (${filename}):`, err.message);
            failedCount++;
        }
    }

    console.log("-------------------------------------");
    console.log("HASIL SINKRONISASI:");
    console.log(`- Berhasil diproses : ${successCount}`);
    console.log(`- Dilewati (file tidak ada): ${skippedCount}`);
    console.log(`- Gagal            : ${failedCount}`);
    console.log("Selesai.");
    process.exit(0);
}

main().catch((e) => {
    console.error("FATAL ERROR:", e);
    process.exit(1);
});
