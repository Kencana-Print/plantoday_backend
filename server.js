require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const requestLogger = require(path.join(__dirname, "middleware", "log"));
const clientPlatformGuard = require("./middleware/clientPlatformGuard");
const { UPLOAD_DIR } = require("./middleware/uploadPermintaanHarga");

const app = express();

app.set("trust proxy", true);

app.use(cors());

// Static /uploads route (foto visit, dll)
app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"), {
        setHeaders: (res) => {
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Cross-Origin-Resource-Policy", "cross-origin");
        },
    }),
);

app.use(
    "/api/uploads",
    express.static(path.join(__dirname, "uploads"), {
        setHeaders: (res) => {
            res.set("Access-Control-Allow-Origin", "*");
            res.set("Cross-Origin-Resource-Policy", "cross-origin");
        },
    }),
);

const serveMintaHargaImages = express.static(UPLOAD_DIR, {
    setHeaders: (res) => {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cross-Origin-Resource-Policy", "cross-origin");
    },
});

// Routing gambar spesifik mintaharga langsung ke UPLOAD_DIR
app.use("/file-gambar/mintaharga", serveMintaHargaImages);
app.use("/api/file-gambar/mintaharga", serveMintaHargaImages);
app.use("/image/mintaharga", serveMintaHargaImages);
app.use("/images/mintaharga", serveMintaHargaImages);

// Static /file-gambar (identik Manksi: mengarah ke mount /mnt/image)
const IMAGE_MOUNT_DIR =
    process.env.IMAGE_MOUNT_DIR ||
    (process.platform === "win32"
        ? path.join(process.cwd(), "image")
        : "/mnt/image");

const serveMountImages = express.static(IMAGE_MOUNT_DIR, {
    setHeaders: (res) => {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cross-Origin-Resource-Policy", "cross-origin");
    },
});

app.use("/file-gambar", serveMountImages);
app.use("/api/file-gambar", serveMountImages);

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true, limit: "3mb" }));

app.use((req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (ct.includes("multipart/form-data")) return next();
    return requestLogger(req, res, next);
});

app.use(clientPlatformGuard);

app.get("/api-plantoday", (req, res) => {
    res.send("PlanToday Backend Running");
});

app.use("/api", require("./routes/achRoute"));
app.use("/api", require("./routes/authRoute"));
app.use("/api", require("./routes/homeRoute"));
app.use("/api", require("./routes/kurirRoute"));
app.use("/api", require("./routes/penawaranRoute"));
app.use("/api", require("./routes/trackingPenawaranRoute"));
app.use("/api", require("./routes/trackingMapRoute"));
app.use("/api", require("./routes/trackingSpkRoute"));
app.use("/api", require("./routes/permintaanHargaRoute"));
app.use("/api", require("./routes/potensiRoute"));
app.use("/api", require("./routes/inkasoRoute"));
app.use("/lookups", require("./routes/permintaanHargaRoute"));

const HOST = process.env.HOST || "0.0.0.0";
app.listen(process.env.PORT, HOST, () => {
    console.log(`Server PlanToday running in: ${HOST}:${process.env.PORT}`);
});
