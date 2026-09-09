const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const potensiController = require("../controllers/potensiController");

// List kandidat penawaran & MAP untuk dipilih sales
router.get("/potensi/kandidat", auth, potensiController.getPotensiKandidatList);

// Simpan batch item potensi yang dicentang
router.post("/potensi", auth, potensiController.createPotensiBatch);

// List data potensi utama dengan KPI summary
router.get("/potensi", auth, potensiController.getPotensiList);

// Batalkan potensi dengan alasan wajib
router.post("/potensi/:pot_nomor/batal", auth, potensiController.batalPotensi);

module.exports = router;
