const fs = require("fs");
const path = require("path");
const multer = require("multer");

// Path folder gambar minta harga — sentralisasi sama dengan Manksi (/mnt/image/mintaharga)
const DEFAULT_UPLOAD_DIR =
    process.platform === "win32"
        ? path.join(process.cwd(), "image", "mintaharga")
        : "/mnt/image/mintaharga";

let UPLOAD_DIR = String(
    process.env.IMAGE_UPLOAD_DIR || DEFAULT_UPLOAD_DIR,
).trim();

// Auto-convert Linux /mnt/ path to Windows path if running on Windows
if (process.platform === "win32" && UPLOAD_DIR.startsWith("/mnt/")) {
    UPLOAD_DIR = path.join(process.cwd(), "image", "mintaharga");
}

// Buat direktori jika belum ada
if (!fs.existsSync(UPLOAD_DIR)) {
    try {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    } catch (mkdirErr) {
        console.error("[UploadPermintaanHarga][Init] Gagal membuat UPLOAD_DIR:", {
            uploadDir: UPLOAD_DIR,
            message: mkdirErr.message,
        });
    }
}

console.log("[UploadPermintaanHarga][Init]", {
    rawUploadDir: process.env.IMAGE_UPLOAD_DIR,
    resolvedUploadDir: UPLOAD_DIR,
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.access(UPLOAD_DIR, fs.constants.W_OK, (err) => {
            if (err) {
                console.error("[UploadPermintaanHarga][Destination][ERROR]", {
                    uploadDir: UPLOAD_DIR,
                    code: err.code,
                    message: err.message,
                });
                return cb(
                    new Error(
                        `Folder upload tidak bisa ditulis: ${UPLOAD_DIR} (${err.code || "UNKNOWN"})`,
                    ),
                );
            }
            return cb(null, UPLOAD_DIR);
        });
    },
    filename: (req, file, cb) => {
        const nomor = String(req.params.nomor || "")
            .trim()
            .replace(/[^A-Z0-9.\-_]/gi, "_");
        const slot = String(req.params.slot || "1").trim();
        const suffix = slot === "2" ? "-2" : "";
        cb(null, `${nomor}${suffix}.jpg`);
    },
});

const uploadPermintaanHarga = multer({
    storage,
    fileFilter: (req, file, cb) => {
        console.log("[UploadPermintaanHarga][FileFilter]", {
            originalname: file?.originalname,
            mimetype: file?.mimetype,
            uploadDir: UPLOAD_DIR,
        });
        const allowed = new Set(["image/jpeg", "image/jpg", "image/png"]);
        if (!allowed.has(String(file.mimetype || "").toLowerCase())) {
            console.error("[UploadPermintaanHarga][FileFilter][REJECT]", {
                originalname: file?.originalname,
                mimetype: file?.mimetype,
            });
            return cb(new Error("Format file harus JPG atau PNG"));
        }
        return cb(null, true);
    },
    limits: {
        fileSize: 1 * 1024 * 1024, // 1MB
    },
});

module.exports = { uploadPermintaanHarga, UPLOAD_DIR };
