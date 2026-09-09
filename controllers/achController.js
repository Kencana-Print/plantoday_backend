const achService = require("../services/achService");

const parseYear = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const parseIntOrNull = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const parseYmToInt = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    const match = s.match(/^(\d{4})-(\d{1,2})$/);
    if (!match) {
        if (/^\d{6}$/.test(s)) return parseInt(s, 10);
        return null;
    }
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    return year * 100 + month;
};

const normalizeRange = (fromYear, fromMonth, toYear, toMonth) => {
    const now = new Date();
    let fy = fromYear ?? now.getFullYear();
    let fm = fromMonth ?? now.getMonth() + 1;
    let ty = toYear ?? fy;
    let tm = toMonth ?? fm;

    fm = clamp(fm, 1, 12);
    tm = clamp(tm, 1, 12);

    const a = fy * 12 + (fm - 1);
    const b = ty * 12 + (tm - 1);

    if (a > b) {
        [fy, ty] = [ty, fy];
        [fm, tm] = [tm, fm];
    }

    return { fy, fm, ty, tm };
};

const getAchievementRange = async (req, res) => {
    try {
        const fromYear = parseIntOrNull(req.query.fromYear);
        const fromMonth = parseIntOrNull(req.query.fromMonth);
        const toYear = parseIntOrNull(req.query.toYear);
        const toMonth = parseIntOrNull(req.query.toMonth);

        const q = String(req.query.q || "").trim();
        const jabatan = String(req.query.jabatan || "").trim();

        const { fy, fm, ty, tm } = normalizeRange(
            fromYear,
            fromMonth,
            toYear,
            toMonth,
        );

        const role = String(req.user?.jabatan || "").toUpperCase();
        const isManager = role === "MANAGER";

        const result = await achService.getAchievementRange({
            fromYear: fy,
            fromMonth: fm,
            toYear: ty,
            toMonth: tm,
            q,
            jabatan,
            isManager,
            userKode: req.user?.kode,
            userNama: req.user?.nama,
        });

        if (result.notFound) {
            return res.status(404).json({
                success: false,
                message: result.message,
            });
        }

        return res.status(200).json({
            success: true,
            meta: {
                fromYear: fy,
                fromMonth: fm,
                toYear: ty,
                toMonth: tm,
                q,
                jabatan,
                selfKode: result.selfKode,
            },
            data: result.rows,
        });
    } catch (err) {
        console.error("GET ACHIEVEMENT RANGE:", err);
        return res.status(500).json({
            success: false,
            message: err?.message || "Gagal mengambil achievement range",
        });
    }
};

const allData = async (req, res) => {
    try {
        const rows = await achService.getAllData();
        return res.status(200).json({
            success: true,
            data: rows,
        });
    } catch (err) {
        console.error("GET ACHIEVEMENT OMSET ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err?.message || "Gagal mengambil achievement omset",
        });
    }
};

const getOmsetByMonth = async (req, res) => {
    try {
        const kode = String(req.params.id || req.user?.kode || "").trim();

        if (!kode) {
            return res.status(400).json({
                success: false,
                message: "kode tidak terdeteksi",
            });
        }

        const year = parseYear(req.query.year);
        const fromInt = parseYmToInt(req.query.from);
        const toInt = parseYmToInt(req.query.to);

        const result = await achService.getOmsetByMonth({
            kode,
            year,
            fromInt,
            toInt,
        });

        return res.status(200).json({
            success: true,
            nama: result.nama,
            group: "month",
            data: result.data,
        });
    } catch (err) {
        console.error("GET OMSET BY MONTH:", err);
        return res.status(500).json({
            success: false,
            message: err?.message || "Gagal mengambil omset per bulan",
        });
    }
};

const getOmsetByYear = async (req, res) => {
    try {
        const kode = String(req.params.id || req.user?.kode || "").trim();

        if (!kode) {
            return res.status(400).json({
                success: false,
                message: "kode tidak terdeteksi",
            });
        }

        const result = await achService.getOmsetByYear({ kode });

        return res.status(200).json({
            success: true,
            nama: result.nama,
            group: "years",
            data: result.rows,
        });
    } catch (err) {
        console.error("GET OMSET BY YEAR ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err?.message || "Gagal mengambil omset per tahun",
        });
    }
};

const getAchievementOmset = async (req, res) => {
    try {
        const now = new Date();
        const tahun = parseInt(
            req.query.tahun || String(now.getFullYear()),
            10,
        );
        const bulan = parseInt(
            req.query.bulan || String(now.getMonth() + 1),
            10,
        );

        const nik = String(req.query.nik || "").trim();
        const jabatan = String(req.query.jabatan || "").trim();
        const search = String(req.query.search || "").trim();

        let limit = parseInt(req.query.limit || "50", 10);
        if (Number.isNaN(limit) || limit <= 0) limit = 50;
        if (limit > 200) limit = 200;

        const result = await achService.getAchievementOmset({
            tahun,
            bulan,
            nik,
            jabatan,
            search,
            limit,
        });

        return res.json({
            success: true,
            filter: {
                tahun,
                bulan,
                nik: nik || null,
                jabatan: jabatan || null,
                search: search || null,
                limit,
            },
            summary: result.summary,
            data: result.rows,
        });
    } catch (err) {
        console.error("GET ACHIEVEMENT OMSET ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err?.message || "Gagal mengambil achievement omset",
        });
    }
};

const getSpkOmsetByMonth = async (req, res) => {
    try {
        const isManager =
            String(req.user?.jabatan || "").toUpperCase() === "MANAGER";

        const tahun = Number(req.query.tahun);
        const bulan = Number(req.query.bulan);

        if (!tahun || !bulan || bulan < 1 || bulan > 12) {
            return res.status(400).json({
                success: false,
                message: "Query tahun & bulan wajib (bulan 1-12)",
            });
        }

        const kodeFromUser =
            req.user?.kode ||
            req.user?.sal_kode ||
            req.user?.kode_sales ||
            req.user?.spk_sal_kode;
        const kode = isManager ? (req.params.id || req.params.kode) : kodeFromUser;

        if (!kode) {
            return res.status(400).json({
                success: false,
                message: "Kode sales tidak ditemukan di session user",
            });
        }

        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(
            100,
            Math.max(10, Number(req.query.limit || 20)),
        );

        const result = await achService.getSpkOmsetByMonth({
            kode,
            tahun,
            bulan,
            page,
            limit,
        });

        return res.status(200).json({
            success: true,
            kode,
            tahun,
            bulan,
            page,
            limit,
            summary: result.summary,
            data: result.rows,
        });
    } catch (err) {
        console.error("GET SPK OMSET BY MONTH ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err?.message || "Gagal mengambil detail SPK omset",
        });
    }
};

module.exports = {
    allData,
    getOmsetByMonth,
    getOmsetByYear,
    getAchievementRange,
    getSpkOmsetByMonth,
    getAchievementOmset,
    getOmsetNameKey: achService.getOmsetNameKey,
    normalize: achService.normalize,
};
