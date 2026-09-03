const fs = require("fs");
const path = require("path");
const db = require("../config/dbPenawaran");
const { UPLOAD_DIR } = require("../middleware/uploadPermintaanHarga");
const sharp = require("sharp");

const nomorLocks = new Map();

const toNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const toDecimalNumber = (value, fallback = 0) => {
    const normalized = String(value ?? "")
        .trim()
        .replace(/,/g, ".")
        .replace(/[^0-9.]/g, "");
    if (!normalized) return fallback;
    const firstDot = normalized.indexOf(".");
    const safe =
        firstDot === -1
            ? normalized
            : normalized.slice(0, firstDot + 1) +
              normalized.slice(firstDot + 1).replace(/\./g, "");
    const num = Number(safe);
    return Number.isFinite(num) ? num : fallback;
};

const normalizeDate = (value) => {
    if (!value) return null;
    const s = String(value).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
};

const getCurrentMonthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const toYmd = (d) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    };
    return { start: toYmd(start), end: toYmd(end) };
};

const isSalesUser = (req) =>
    String(req.user?.jabatan || "")
        .trim()
        .toUpperCase() === "SALES";

const isManagerUser = (req) =>
    String(req.user?.jabatan || "")
        .trim()
        .toUpperCase() === "MANAGER";

const isOwnedBySalesKode = (req, row = {}) => {
    const authSalesKode = String(req.user?.sales_kode || "").trim();
    const rowSalesKode = String(
        row?.mh_sal_kode || row?.pen_sal_kode || "",
    ).trim();
    return Boolean(authSalesKode) && rowSalesKode === authSalesKode;
};

const resolveActor = (req) =>
    String(
        req.user?.nama || req.user?.id || req.body?.user || "MOBILE",
    ).trim() || "MOBILE";

const resolveActorCandidates = (req) => {
    const values = [
        req.user?.id,
        req.user?.nama,
        req.body?.user,
        req.query?.user,
    ]
        .map((v) => String(v || "").trim())
        .filter(Boolean);

    const set = new Set();
    values.forEach((v) => {
        set.add(v);
        set.add(v.toUpperCase());
        set.add(v.toLowerCase());
    });

    return Array.from(set);
};

const withNomorLock = async (key, fn) => {
    const prev = nomorLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });

    nomorLocks.set(
        key,
        prev.then(() => current),
    );
    await prev;

    try {
        return await fn();
    } finally {
        release();
        if (nomorLocks.get(key) === current) {
            nomorLocks.delete(key);
        }
    }
};

const getNextNomor = async (conn, tahun) => {
    const [rows] = await conn.query(
        `
        SELECT IFNULL(MAX(RIGHT(mh_nomor,4)),0) AS jumlah
        FROM tmintaharga
        WHERE YEAR(mh_tanggal) = ?
        `,
        [tahun],
    );
    const next = toNumber(rows?.[0]?.jumlah, 0) + 1;
    return `MH.${tahun}.${String(next).padStart(4, "0")}`;
};

const uploadDir = path.join(process.cwd(), "uploads", "mintaharga");

const normalizePublicOrigin = (origin) => {
    const raw = String(origin || "").trim();
    if (!raw) return "";

    let normalized = raw.replace(/\\+/g, "/");

    if (normalized.startsWith("//")) {
        normalized = `http:${normalized}`;
    } else if (!/^https?:\/\//i.test(normalized)) {
        normalized = `http://${normalized.replace(/^\/+/, "")}`;
    }

    return normalized.replace(/\/+$/, "");
};

const resolveImagePublicOrigin = () => {
    const envOrigin = String(
        process.env.PUBLIC_IMAGE_READ_ORIGIN ||
            process.env.PUBLIC_IMAGE_ORIGIN ||
            process.env.IMAGE_PUBLIC_ORIGIN ||
            "",
    ).trim();
    return (
        normalizePublicOrigin(envOrigin) ||
        normalizePublicOrigin("http://103.94.238.252:8182")
    );
};

const buildImageBaseUrl = () => resolveImagePublicOrigin();

const buildImagePaths = (nomor) => {
    const safeNomor = String(nomor || "").trim();
    return {
        delphi1: `/images/mintaharga/${safeNomor}.jpg`,
        delphi2: `/images/mintaharga/${safeNomor}-2.jpg`,
        legacy1: `/images/mintaharga/${safeNomor}.jpg`,
        legacy2: `/images/mintaharga/${safeNomor}-2.jpg`,
    };
};

const getExistingImageMeta = (nomor, slot) => {
    const safeNomor = String(nomor || "").trim();
    if (!safeNomor) return null;
    const fileName = slot === 2 ? `${safeNomor}-2.jpg` : `${safeNomor}.jpg`;
    const absolutePath = path.join(UPLOAD_DIR, fileName);
    if (!fs.existsSync(absolutePath)) return null;
    return { fileName, absolutePath };
};

const getYearFromTanggal = (tanggal) =>
    Number(String(tanggal || "").slice(0, 4));

const isBasicEmail = (value) => {
    const val = String(value || "").trim();
    if (val === "-") return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
};

const isBasicNpwp = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 15;
};

const getNextCustomerKode = async (conn) => {
    const baseSql = `
        SELECT IFNULL(MAX(CAST(cus_kode AS UNSIGNED)), 0) AS max_kode
        FROM tcustomer
        WHERE TRIM(IFNULL(cus_kode, '')) REGEXP '^[0-9]{1,5}$'
    `;

    try {
        const [rows] = await conn.query(
            `${baseSql}
             AND (
                 IFNULL(TRIM(cus_kodec), '') = ''
                 OR TRIM(cus_kodec) = '0'
             )`,
        );
        const next = toNumber(rows?.[0]?.max_kode, 0) + 1;
        return String(next).padStart(5, "0");
    } catch (err) {
        if (String(err?.code || "") !== "ER_BAD_FIELD_ERROR") throw err;
        const [fallbackRows] = await conn.query(baseSql);
        const next = toNumber(fallbackRows?.[0]?.max_kode, 0) + 1;
        return String(next).padStart(5, "0");
    }
};

const createPermintaanHargaInTransaction = async ({
    conn,
    payload,
    actor,
    nomor,
}) => {
    const hargaKalkulasi = toNumber(payload.mh_harga_kalkulasi, 0);
    let initialStatus = "MINTA";
    if (payload.mh_status) {
        initialStatus = String(payload.mh_status).trim().toUpperCase();
    } else if (hargaKalkulasi > 0) {
        initialStatus = "WAIT"; // Sudah ada kalkulasi -> status WAIT
    } else {
        initialStatus = "MINTA"; // Lewati kalkulasi / belum ada kalkulasi -> status MINTA
    }

    await conn.query(
        `
        INSERT INTO tmintaharga (
            mh_divisi, mh_nomor, mh_tanggal, mh_cus_kode, mh_cus_nama, mh_sal_kode,
            mh_nama, mh_jmlorder, mh_harga, mh_budget, mh_dateorder, mh_kain,
            mh_panjang, mh_lebar, mh_ukuran, mh_gramasi, mh_finishing,
            mh_ket, mh_status, date_create, user_create,
            mh_harga_kalkulasi, mh_ket_kalkulasi
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
        `,
        [
            toNumber(payload.mh_divisi, 0),
            nomor,
            payload.tanggal,
            String(payload.mh_cus_kode || "").trim(),
            String(payload.mh_cus_nama || "").trim(),
            String(payload.mh_sal_kode || "").trim(),
            String(payload.mh_nama || "").trim(),
            toNumber(payload.mh_jmlorder, 0),
            toNumber(payload.mh_harga, 0),
            toNumber(payload.mh_budget, 0),
            normalizeDate(payload.mh_dateorder),
            String(payload.mh_kain || "").trim(),
            toNumber(payload.mh_panjang, 0),
            toNumber(payload.mh_lebar, 0),
            String(payload.mh_ukuran || "").trim(),
            String(payload.mh_gramasi || "").trim(),
            String(payload.mh_finishing || "").trim(),
            String(payload.mh_ket || "").trim(),
            initialStatus,
            actor,
            hargaKalkulasi,
            String(payload.mh_ket_kalkulasi || "").trim(),
        ],
    );
};

const cloneImageFile = async (fromNomor, toNomor, suffix = "") => {
    const src = path.join(uploadDir, `${fromNomor}${suffix}.jpg`);
    const dst = path.join(uploadDir, `${toNomor}${suffix}.jpg`);
    try {
        await fs.promises.access(src, fs.constants.F_OK);
        await fs.promises.copyFile(src, dst);
        return true;
    } catch {
        return false;
    }
};

const getPermintaanHargaList = async (req, res) => {
    try {
        const monthRange = getCurrentMonthRange();
        const startDate =
            normalizeDate(req.query.startDate) || monthRange.start;
        const endDate = normalizeDate(req.query.endDate) || monthRange.end;
        const status = String(req.query.status || "")
            .trim()
            .toUpperCase();
        const search = String(req.query.search || "").trim();
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 300);
        const page = Math.max(Number(req.query.page) || 1, 1);
        const offset = (page - 1) * limit;
        const actor = resolveActor(req);
        const actorCandidates = resolveActorCandidates(req);
        const actorCandidatesNormalized = Array.from(
            new Set(
                actorCandidates
                    .map((v) =>
                        String(v || "")
                            .trim()
                            .toUpperCase(),
                    )
                    .filter(Boolean),
            ),
        );
        const salesRole = isSalesUser(req);
        const ownerCandidates = Array.from(
            new Set(
                [req.user?.nama, req.user?.id]
                    .map((v) => String(v || "").trim())
                    .filter(Boolean),
            ),
        );
        const authSalesKode = String(req.user?.sales_kode || "").trim();

        const managerRole = isManagerUser(req);
        if (!managerRole && !ownerCandidates.length) {
            return res.status(403).json({
                success: false,
                message: "User tidak valid",
            });
        }

        const where = [
            "m.mh_tanggal >= ?",
            "m.mh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)",
        ];
        const params = [startDate, endDate];

        if (!managerRole) {
            if (!authSalesKode) {
                return res.status(403).json({
                    success: false,
                    message: "Sales tidak valid (sales_kode kosong)",
                });
            }
            where.unshift("COALESCE(m.mh_sal_kode,'') = ?");
            params.unshift(authSalesKode);
        }

        if (status) {
            where.push("COALESCE(m.mh_status,'') = ?");
            params.push(status);
        }

        if (search) {
            where.push(
                "(m.mh_nomor LIKE ? OR m.mh_nama LIKE ? OR m.mh_cus_nama LIKE ?)",
            );
            const like = `%${search}%`;
            params.push(like, like, like);
        }

        const bypassSalesFilter =
            String(process.env.PH_BYPASS_SALES_FILTER || "")
                .trim()
                .toLowerCase() === "1";

        // TEMP: bypass user_create filter

        if (
            String(process.env.PH_DEBUG_LIST || "")
                .trim()
                .toLowerCase() === "1"
        ) {
            console.log("[PermintaanHarga][List][Debug]", {
                actor,
                actorCandidates,
                actorCandidatesNormalized,
                salesRole,
                managerRole,
                bypassSalesFilter,
                startDate,
                endDate,
                status,
                search,
                limit,
                page,
                where,
            });
        }

        params.push(limit, offset);

        const [rows] = await db.query(
            `
            SELECT
                m.mh_nomor AS nomor,
                DATE_FORMAT(m.date_create, '%Y-%m-%d') AS tanggal,
                COALESCE(m.mh_nama,'') AS nama,
                COALESCE(m.mh_cus_nama,'') AS customer,
                COALESCE(v.divisi,'') AS divisi,
                COALESCE(m.mh_jmlorder,0) AS jml_order,
                COALESCE(m.mh_harga_kalkulasi,0) AS harga_kalkulasi,
                COALESCE(m.mh_status,'') AS status,
                COALESCE(m.mh_ket_kalkulasi,'') AS ket_kalkulasi,
                COALESCE(m.user_create,'') AS user_create
            FROM tmintaharga m
            LEFT JOIN tdivisi v ON v.kode = m.mh_divisi
            WHERE ${where.join(" AND ")}
            ORDER BY m.mh_nomor DESC
            LIMIT ? OFFSET ?
            `,
            params,
        );

        if (
            String(process.env.PH_DEBUG_LIST || "")
                .trim()
                .toLowerCase() === "1"
        ) {
            console.log("[PermintaanHarga][List][Result]", {
                count: rows?.length || 0,
            });
        }

        return res.json({
            success: true,
            data: rows,
            meta: {
                page,
                limit,
                count: rows.length,
            },
        });
    } catch (err) {
        console.error("[PermintaanHarga][List][Error]", {
            message: err?.message,
            sqlMessage: err?.sqlMessage,
            code: err?.code,
        });
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal mengambil list permintaan harga",
        });
    }
};

const getPermintaanHargaDetail = async (req, res) => {
    try {
        const nomor = String(req.params.nomor || "").trim();
        const ownerCandidates = Array.from(
            new Set(
                [req.user?.nama, req.user?.id]
                    .map((v) => String(v || "").trim())
                    .filter(Boolean),
            ),
        );

        const managerRole = isManagerUser(req);
        if (!managerRole && !ownerCandidates.length) {
            return res.status(403).json({
                success: false,
                message: "User tidak valid",
            });
        }

        if (!nomor) {
            return res
                .status(400)
                .json({ success: false, message: "Nomor tidak valid" });
        }

        const authSalesKode = String(req.user?.sales_kode || "").trim();
        const whereUserCreate = managerRole
            ? ""
            : "AND COALESCE(h.mh_sal_kode,'') = ?";
        const [rows] = await db.query(
            `
            SELECT
                h.mh_nomor,
                h.mh_divisi,
                h.mh_tanggal,
                h.mh_cus_kode,
                h.mh_cus_nama,
                h.mh_sal_kode,
                h.mh_nama,
                h.mh_jmlorder,
                h.mh_harga,
                h.mh_budget,
                DATE_FORMAT(h.mh_dateorder, '%Y-%m-%d') AS mh_dateorder,
                h.mh_kain,
                h.mh_panjang,
                h.mh_lebar,
                h.mh_ukuran,
                h.mh_gramasi,
                h.mh_finishing,
                h.mh_ket,
                h.mh_status,
                COALESCE(h.mh_harga_kalkulasi, 0) AS mh_harga_kalkulasi,
                COALESCE(h.mh_ket_kalkulasi, '') AS mh_ket_kalkulasi,
                h.user_create,
                COALESCE(v.divisi,'') AS divisi_nama,
                COALESCE(s.sal_nama,'') AS sales_nama,
                DATE_FORMAT(h.date_create, '%Y-%m-%d %H:%i:%s') AS created_at_fmt
            FROM tmintaharga h
            LEFT JOIN tdivisi v ON v.kode=h.mh_divisi
            LEFT JOIN tsales s ON s.sal_kode=h.mh_sal_kode
            WHERE h.mh_nomor = ?
              ${whereUserCreate}
            LIMIT 1
            `,
            managerRole ? [nomor] : [nomor, authSalesKode],
        );

        if (!rows?.length) {
            return res
                .status(404)
                .json({ success: false, message: "Data tidak ditemukan" });
        }

        const row = rows[0];
        const baseUrl = buildImageBaseUrl();
        const imagePaths = buildImagePaths(row.mh_nomor);
        const withBase = (p) => (baseUrl ? `${baseUrl}${p}` : p);

        console.log("[PermintaanHarga][Detail][ImageUrl]", {
            nomor: row.mh_nomor,
            baseUrl,
            imagePath1: imagePaths.delphi1,
            imagePath2: imagePaths.delphi2,
        });

        // Kirim metadata gambar hanya jika file benar-benar ada.
        // Ini mencegah FE menganggap gambar "sudah terisi" padahal file belum ada.
        const existing1 = getExistingImageMeta(row.mh_nomor, 1);
        const existing2 = getExistingImageMeta(row.mh_nomor, 2);

        row.gambar_1_url = existing1 ? withBase(imagePaths.delphi1) : "";
        row.gambar_2_url = existing2 ? withBase(imagePaths.delphi2) : "";
        row.gambar_1_path = existing1 ? imagePaths.delphi1 : "";
        row.gambar_2_path = existing2 ? imagePaths.delphi2 : "";
        row.gambar_1_file = existing1 ? existing1.fileName : "";
        row.gambar_2_file = existing2 ? existing2.fileName : "";

        return res.json({ success: true, data: row });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal mengambil detail permintaan harga",
        });
    }
};

const createPermintaanHarga = async (req, res) => {
    try {
        const body = req.body || {};
        console.log("[PermintaanHarga][Create][PriceInput]", {
            mh_harga_raw: body.mh_harga,
            mh_budget_raw: body.mh_budget,
            mh_harga_normalized: toNumber(body.mh_harga, 0),
            mh_budget_normalized: toNumber(body.mh_budget, 0),
            mh_panjang_raw: body.mh_panjang,
            mh_lebar_raw: body.mh_lebar,
            mh_panjang_normalized: toDecimalNumber(body.mh_panjang, 0),
            mh_lebar_normalized: toDecimalNumber(body.mh_lebar, 0),
        });
        const tanggal = normalizeDate(
            body.mh_tanggal || new Date().toISOString(),
        );
        const actor = resolveActor(req);
        const tahun = getYearFromTanggal(tanggal);

        if (!tanggal) {
            return res
                .status(400)
                .json({ success: false, message: "Tanggal tidak valid" });
        }

        const result = await withNomorLock(`create:${tahun}`, async () => {
            let conn;
            try {
                conn = await db.getConnection();

                for (let attempt = 1; attempt <= 3; attempt += 1) {
                    await conn.beginTransaction();
                    const nomor = await getNextNomor(conn, tahun);
                    const [exists] = await conn.query(
                        `SELECT mh_nomor FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
                        [nomor],
                    );
                    if (exists?.length) {
                        await conn.rollback();
                        continue;
                    }

                    await createPermintaanHargaInTransaction({
                        conn,
                        payload: { ...body, tanggal },
                        actor,
                        nomor,
                    });
                    await conn.commit();
                    return nomor;
                }

                throw new Error(
                    "Gagal membuat nomor permintaan harga yang unik, silakan coba lagi",
                );
            } finally {
                if (conn) conn.release();
            }
        });

        return res.status(201).json({ success: true, data: { nomor: result } });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal membuat permintaan harga",
        });
    }
};

const updatePermintaanHarga = async (req, res) => {
    try {
        const nomor = String(req.params.nomor || "").trim();
        const actor = resolveActor(req);
        const body = req.body || {};
        console.log("[PermintaanHarga][Update][PriceInput]", {
            nomor,
            mh_harga_raw: body.mh_harga,
            mh_budget_raw: body.mh_budget,
            mh_harga_normalized: toNumber(body.mh_harga, 0),
            mh_budget_normalized: toNumber(body.mh_budget, 0),
            mh_panjang_raw: body.mh_panjang,
            mh_lebar_raw: body.mh_lebar,
            mh_panjang_normalized: toDecimalNumber(body.mh_panjang, 0),
            mh_lebar_normalized: toDecimalNumber(body.mh_lebar, 0),
        });

        const [rows] = await db.query(
            `SELECT mh_nomor, mh_status, mh_sal_kode, user_create FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
            [nomor],
        );
        if (!rows?.length) {
            return res
                .status(404)
                .json({ success: false, message: "Data tidak ditemukan" });
        }
        if (isSalesUser(req) && !isOwnedBySalesKode(req, rows[0])) {
            return res.status(403).json({
                success: false,
                message: "Tidak berhak mengubah data ini",
            });
        }
        if (String(rows[0].mh_status || "").toUpperCase() !== "BELUM") {
            return res.status(409).json({
                success: false,
                message: "Hanya status BELUM yang dapat diubah",
            });
        }

        await db.query(
            `
            UPDATE tmintaharga
            SET
                mh_tanggal = ?,
                mh_divisi = ?,
                mh_cus_kode = ?,
                mh_cus_nama = ?,
                mh_sal_kode = ?,
                mh_nama = ?,
                mh_jmlorder = ?,
                mh_harga = ?,
                mh_budget = ?,
                mh_dateorder = ?,
                mh_kain = ?,
                mh_panjang = ?,
                mh_lebar = ?,
                mh_ukuran = ?,
                mh_gramasi = ?,
                mh_finishing = ?,
                mh_ket = ?,
                mh_harga_kalkulasi = ?,
                mh_ket_kalkulasi = ?,
                user_modified = ?,
                date_modified = NOW()
            WHERE mh_nomor = ?
            `,
            [
                normalizeDate(body.mh_tanggal || new Date().toISOString()),
                toNumber(body.mh_divisi, 0),
                String(body.mh_cus_kode || "").trim(),
                String(body.mh_cus_nama || "").trim(),
                String(body.mh_sal_kode || "").trim(),
                String(body.mh_nama || "").trim(),
                toNumber(body.mh_jmlorder, 0),
                toNumber(body.mh_harga, 0),
                toNumber(body.mh_budget, 0),
                normalizeDate(body.mh_dateorder),
                String(body.mh_kain || "").trim(),
                toDecimalNumber(body.mh_panjang, 0),
                toDecimalNumber(body.mh_lebar, 0),
                String(body.mh_ukuran || "").trim(),
                String(body.mh_gramasi || "").trim(),
                String(body.mh_finishing || "").trim(),
                String(body.mh_ket || "").trim(),
                toNumber(body.mh_harga_kalkulasi, 0),
                String(body.mh_ket_kalkulasi || "").trim(),
                actor,
                nomor,
            ],
        );

        return res.json({
            success: true,
            message: "Permintaan harga berhasil diubah",
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal mengubah permintaan harga",
        });
    }
};

const copyPermintaanHarga = async (req, res) => {
    try {
        const actor = resolveActor(req);
        const nomor = String(req.params.nomor || "").trim();
        const [rows] = await db.query(
            `SELECT * FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
            [nomor],
        );
        if (!rows?.length) {
            return res.status(404).json({
                success: false,
                message: "Data sumber copy tidak ditemukan",
            });
        }

        const source = rows[0];
        if (isSalesUser(req) && !isOwnedBySalesKode(req, source)) {
            return res.status(403).json({
                success: false,
                message: "Tidak berhak copy data ini",
            });
        }

        if (
            String(source.mh_status || "")
                .trim()
                .toUpperCase() !== "BELUM"
        ) {
            return res.status(409).json({
                success: false,
                message: "Hanya status BELUM yang dapat di-copy",
            });
        }

        const tanggalBaru = normalizeDate(new Date().toISOString());
        const tahun = getYearFromTanggal(tanggalBaru);
        const nomorBaru = await withNomorLock(`copy:${tahun}`, async () => {
            let conn;
            try {
                conn = await db.getConnection();
                for (let attempt = 1; attempt <= 3; attempt += 1) {
                    await conn.beginTransaction();
                    const candidate = await getNextNomor(conn, tahun);
                    const [exists] = await conn.query(
                        `SELECT mh_nomor FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
                        [candidate],
                    );
                    if (exists?.length) {
                        await conn.rollback();
                        continue;
                    }

                    await createPermintaanHargaInTransaction({
                        conn,
                        payload: {
                            ...source,
                            tanggal: tanggalBaru,
                        },
                        actor,
                        nomor: candidate,
                    });
                    await conn.commit();
                    return candidate;
                }

                throw new Error(
                    "Gagal membuat nomor copy yang unik, silakan coba lagi",
                );
            } finally {
                if (conn) conn.release();
            }
        });

        const copied1 = await cloneImageFile(nomor, nomorBaru, "");
        const copied2 = await cloneImageFile(nomor, nomorBaru, "-2");
        if (!copied1 || !copied2) {
            console.warn("[PermintaanHarga][CopyImage][Partial]", {
                nomor_sumber: nomor,
                nomor_baru: nomorBaru,
                gambar_1_copied: copied1,
                gambar_2_copied: copied2,
            });
        }

        return res.status(201).json({
            success: true,
            message: "Copy permintaan harga berhasil",
            data: {
                nomor_sumber: nomor,
                nomor_baru: nomorBaru,
                gambar_1_copied: copied1,
                gambar_2_copied: copied2,
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage || err.message || "Gagal copy permintaan harga",
        });
    }
};

const deletePermintaanHarga = async (req, res) => {
    try {
        const nomor = String(req.params.nomor || "").trim();
        const actor = resolveActor(req);
        const [rows] = await db.query(
            `SELECT mh_nomor, mh_status, mh_sal_kode, user_create FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
            [nomor],
        );
        if (!rows?.length) {
            return res
                .status(404)
                .json({ success: false, message: "Data tidak ditemukan" });
        }
        if (isSalesUser(req) && !isOwnedBySalesKode(req, rows[0])) {
            return res.status(403).json({
                success: false,
                message: "Tidak berhak menghapus data ini",
            });
        }
        if (String(rows[0].mh_status || "").toUpperCase() !== "BELUM") {
            return res.status(409).json({
                success: false,
                message: "Hanya status BELUM yang dapat dihapus",
            });
        }

        await db.query(`DELETE FROM tmintaharga WHERE mh_nomor = ?`, [nomor]);
        return res.json({
            success: true,
            message: "Permintaan harga berhasil dihapus",
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal menghapus permintaan harga",
        });
    }
};

const uploadPermintaanHargaImage = async (req, res) => {
    try {
        const nomor = String(req.params.nomor || "").trim();
        const slot = String(req.params.slot || "1").trim();
        if (!["1", "2"].includes(slot)) {
            return res.status(400).json({
                success: false,
                message: "Slot gambar hanya 1 atau 2",
            });
        }
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "File gambar wajib diunggah",
            });
        }

        const [rows] = await db.query(
            `SELECT mh_nomor, mh_status, mh_sal_kode, user_create FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
            [nomor],
        );
        if (!rows?.length) {
            return res
                .status(404)
                .json({ success: false, message: "Data tidak ditemukan" });
        }
        if (isSalesUser(req) && !isOwnedBySalesKode(req, rows[0])) {
            return res.status(403).json({
                success: false,
                message: "Tidak berhak upload gambar untuk data ini",
            });
        }

        if (
            String(rows[0].mh_status || "")
                .trim()
                .toUpperCase() !== "BELUM"
        ) {
            return res.status(409).json({
                success: false,
                message: "Upload gambar hanya diizinkan untuk status BELUM",
            });
        }

        if (req.file && req.file.path) {
            try {
                const imgBuffer = await sharp(req.file.path)
                    .jpeg({ quality: 90, force: true })
                    .toBuffer();
                await fs.promises.writeFile(req.file.path, imgBuffer);
            } catch (sharpErr) {
                console.error(
                    "[PermintaanHarga][Upload][SharpError]",
                    sharpErr,
                );
            }
        }

        const baseUrl = buildImageBaseUrl();
        const imagePaths = buildImagePaths(nomor);
        const currentPath =
            String(slot) === "2" ? imagePaths.delphi2 : imagePaths.delphi1;
        const legacyPath =
            String(slot) === "2" ? imagePaths.legacy2 : imagePaths.legacy1;
        const withBase = (p) => (baseUrl ? `${baseUrl}${p}` : p);

        console.log("[PermintaanHarga][Upload][Result]", {
            nomor,
            slot,
            savedFile: req.file?.filename,
            mimeType: req.file?.mimetype,
            size: req.file?.size,
            baseUrl,
            currentPath,
            legacyPath,
        });

        return res.json({
            success: true,
            message: "Upload gambar berhasil",
            data: {
                nomor,
                slot,
                file: req.file.filename,
                url: withBase(currentPath),
                legacy_url: withBase(legacyPath),
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.sqlMessage || err.message || "Gagal upload gambar",
        });
    }
};

// TEMP TEST: endpoint uploader internal untuk uji upload file tanpa validasi DB/status.
const uploadPermintaanHargaImageInternal = async (req, res) => {
    try {
        const nomor = String(req.params.nomor || "").trim();
        const slot = String(req.params.slot || "1").trim();

        if (!nomor) {
            console.warn(
                "[PermintaanHarga][Upload][Internal][FAILED] Nomor wajib diisi",
            );
            return res.status(400).json({
                success: false,
                message: "Nomor wajib diisi",
            });
        }

        if (!["1", "2"].includes(slot)) {
            console.warn(
                "[PermintaanHarga][Upload][Internal][FAILED] Slot gambar invalid",
                { nomor, slot },
            );
            return res.status(400).json({
                success: false,
                message: "Slot gambar hanya 1 atau 2",
            });
        }

        if (!req.file) {
            console.warn(
                "[PermintaanHarga][Upload][Internal][FAILED] File gambar tidak terdeteksi",
                { nomor, slot },
            );
            return res.status(400).json({
                success: false,
                message: "File gambar wajib diunggah",
            });
        }

        if (req.file && req.file.path) {
            try {
                const imgBuffer = await sharp(req.file.path)
                    .jpeg({ quality: 90, force: true })
                    .toBuffer();
                await fs.promises.writeFile(req.file.path, imgBuffer);
            } catch (sharpErr) {
                console.error(
                    "[PermintaanHarga][Upload][Internal][SharpError]",
                    sharpErr,
                );
            }
        }

        const baseUrl = buildImageBaseUrl();
        const imagePaths = buildImagePaths(nomor);
        const currentPath =
            String(slot) === "2" ? imagePaths.delphi2 : imagePaths.delphi1;
        const legacyPath =
            String(slot) === "2" ? imagePaths.legacy2 : imagePaths.legacy1;
        const withBase = (p) => (baseUrl ? `${baseUrl}${p}` : p);

        console.log("[PermintaanHarga][Upload][Internal][SUCCESS]", {
            nomor,
            slot,
            savedFile: req.file?.filename,
            mimeType: req.file?.mimetype,
            size: req.file?.size,
            destination: req.file?.destination,
            path: req.file?.path,
            baseUrl,
            currentPath,
            legacyPath,
        });

        return res.json({
            success: true,
            message: "Upload internal berhasil",
            data: {
                nomor,
                slot,
                file: req.file.filename,
                destination: req.file.destination,
                path: req.file.path,
                url: withBase(currentPath),
                legacy_url: withBase(legacyPath),
            },
        });
    } catch (err) {
        console.error(
            "[PermintaanHarga][Upload][Internal][ERROR] Gagal menyimpan file:",
            {
                nomor: req.params.nomor,
                slot: req.params.slot,
                error: err.message,
                stack: err.stack,
            },
        );
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage || err.message || "Gagal upload internal gambar",
        });
    }
};

// TEMP TEST: endpoint upload JSON base64 untuk bypass masalah multipart dari RN emulator.
const uploadPermintaanHargaImageBase64 = async (req, res) => {
    try {
        const nomor = String(req.params.nomor || "").trim();
        const slot = String(req.params.slot || "1").trim();
        if (!["1", "2"].includes(slot)) {
            return res.status(400).json({
                success: false,
                message: "Slot gambar hanya 1 atau 2",
            });
        }

        const [rows] = await db.query(
            `SELECT mh_nomor, mh_status, mh_sal_kode, user_create FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
            [nomor],
        );
        if (!rows?.length) {
            return res
                .status(404)
                .json({ success: false, message: "Data tidak ditemukan" });
        }
        if (isSalesUser(req) && !isOwnedBySalesKode(req, rows[0])) {
            return res.status(403).json({
                success: false,
                message: "Tidak berhak upload gambar untuk data ini",
            });
        }

        if (
            String(rows[0].mh_status || "")
                .trim()
                .toUpperCase() !== "BELUM"
        ) {
            return res.status(409).json({
                success: false,
                message: "Upload gambar hanya diizinkan untuk status BELUM",
            });
        }

        const dataUrl = String(req.body?.file_base64 || "").trim();
        if (!dataUrl) {
            console.warn(
                "[PermintaanHarga][Upload][Base64][FAILED] Payload file_base64 kosong",
                { nomor, slot },
            );
            return res.status(400).json({
                success: false,
                message: "Payload file_base64 wajib diisi",
            });
        }

        const matched = dataUrl.match(
            /^data:(image\/(jpeg|jpg|png));base64,(.+)$/i,
        );
        if (!matched) {
            console.warn(
                "[PermintaanHarga][Upload][Base64][FAILED] Format base64 tidak valid",
                { nomor, slot },
            );
            return res.status(400).json({
                success: false,
                message: "Format base64 tidak valid",
            });
        }

        const mimeType = String(matched[1] || "image/jpeg").toLowerCase();
        // Force ekstensi menjadi .jpg agar sesuai dengan format yang dibaca oleh view Delphi
        const ext = "jpg";
        const b64 = String(matched[3] || "");
        let buffer = Buffer.from(b64, "base64");
        if (!buffer.length) {
            console.warn(
                "[PermintaanHarga][Upload][Base64][FAILED] Konten gambar kosong",
                { nomor, slot },
            );
            return res.status(400).json({
                success: false,
                message: "Konten gambar kosong",
            });
        }

        const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
        if (buffer.length > MAX_FILE_SIZE) {
            console.warn(
                "[PermintaanHarga][Upload][Base64][FAILED] File terlalu besar",
                { nomor, slot, bytes: buffer.length },
            );
            return res.status(400).json({
                success: false,
                message: `Ukuran gambar melebihi batas maksimal 1MB (ukuran file: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`,
            });
        }

        try {
            buffer = await sharp(buffer)
                .jpeg({ quality: 90, force: true })
                .toBuffer();
        } catch (sharpErr) {
            console.error(
                "[PermintaanHarga][Upload][Base64][SharpError]",
                sharpErr,
            );
        }

        const safeNomor = String(nomor || "")
            .trim()
            .replace(/[^A-Z0-9.\-_/]/gi, "_");
        const suffix = slot === "2" ? "-2" : "";
        const fileName = `${safeNomor}${suffix}.${ext}`;
        const targetPath = path.join(UPLOAD_DIR, fileName);

        await fs.promises.writeFile(targetPath, buffer);

        const baseUrl = buildImageBaseUrl();
        const imagePaths = buildImagePaths(nomor);
        const currentPath =
            String(slot) === "2" ? imagePaths.delphi2 : imagePaths.delphi1;
        const legacyPath =
            String(slot) === "2" ? imagePaths.legacy2 : imagePaths.legacy1;
        const withBase = (p) => (baseUrl ? `${baseUrl}${p}` : p);

        console.log("[PermintaanHarga][Upload][Base64][SUCCESS]", {
            nomor,
            slot,
            mimeType,
            bytes: buffer.length,
            fileName,
            uploadDir: UPLOAD_DIR,
            targetPath,
        });

        return res.json({
            success: true,
            message: "Upload base64 berhasil",
            data: {
                nomor,
                slot,
                file: fileName,
                path: targetPath,
                url: withBase(currentPath),
                legacy_url: withBase(legacyPath),
            },
        });
    } catch (err) {
        console.error(
            "[PermintaanHarga][Upload][Base64][ERROR] Gagal menyimpan file:",
            {
                nomor: req.params.nomor,
                slot: req.params.slot,
                error: err.message,
                stack: err.stack,
            },
        );
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage || err.message || "Gagal upload base64 gambar",
        });
    }
};

const createPermintaanHargaCustomer = async (req, res) => {
    let conn;
    try {
        const body = req.body || {};
        const actor =
            String(body.user_create || "").trim() ||
            String(req.user?.nama || "").trim() ||
            resolveActor(req);

        const nama = String(body.nama || "").trim();
        const alamat = String(body.alamat || "").trim();
        const kota = String(body.kota || "").trim();
        const telp = String(body.cus_telp || body.telp || "").trim();
        const cp = String(body.cus_cp || body.kontak_person || "").trim();
        const email = String(body.cus_email || body.email || "").trim();
        const korporasi =
            String(body.cus_korporasi || body.korporasi || "N")
                .trim()
                .toUpperCase() === "Y"
                ? "Y"
                : "N";

        const jenisUsaha = String(
            body.cus_jenisusaha || body.jenis_usaha || "",
        ).trim();
        const npwp = String(body.cus_npwp || body.npwp || "").trim();
        const namaNpwp = String(
            body.cus_nama_npwp || body.nama_npwp || "",
        ).trim();
        const alamatNpwp = String(
            body.cus_alamat_npwp || body.alamat_npwp || "",
        ).trim();
        const kotaNpwp = String(
            body.cus_kota_npwp || body.kota_npwp || "",
        ).trim();

        if (!nama || !alamat || !kota || !telp || !cp || !email) {
            return res.status(400).json({
                success: false,
                message:
                    "Nama, alamat, kota, no telp, kontak person, dan email wajib diisi",
            });
        }

        if (!isBasicEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Format email tidak valid",
            });
        }

        if (korporasi === "Y") {
            if (!jenisUsaha || !npwp) {
                return res.status(400).json({
                    success: false,
                    message: "Jenis usaha dan NPWP wajib diisi untuk korporasi",
                });
            }
            if (!isBasicNpwp(npwp)) {
                return res.status(400).json({
                    success: false,
                    message: "Format NPWP tidak valid",
                });
            }
        }

        const kode = await withNomorLock("customer:create", async () => {
            conn = await db.getConnection();
            try {
                for (let attempt = 1; attempt <= 3; attempt += 1) {
                    await conn.beginTransaction();
                    const candidate = await getNextCustomerKode(conn);
                    const [exists] = await conn.query(
                        `SELECT cus_kode FROM tcustomer WHERE cus_kode = ? LIMIT 1`,
                        [candidate],
                    );
                    if (exists?.length) {
                        await conn.rollback();
                        continue;
                    }

                    await conn.query(
                        `
                        INSERT INTO tcustomer (
                            cus_kode,
                            cus_nama,
                            cus_alamat,
                            cus_kota,
                            cus_telp,
                            cus_cp,
                            cus_email,
                            cus_korporasi,
                            cus_jenisusaha,
                            cus_npwp,
                            cus_nama_npwp,
                            cus_alamat_npwp,
                            cus_kota_npwp,
                            cus_aktif,
                            user_create,
                            date_create
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())
                        `,
                        [
                            candidate,
                            nama,
                            alamat,
                            kota,
                            telp,
                            cp,
                            email,
                            korporasi,
                            korporasi === "Y" ? jenisUsaha : "",
                            korporasi === "Y" ? npwp : "",
                            korporasi === "Y" ? namaNpwp : "",
                            korporasi === "Y" ? alamatNpwp : "",
                            korporasi === "Y" ? kotaNpwp : "",
                            actor,
                        ],
                    );

                    await conn.commit();
                    return candidate;
                }

                throw new Error("Gagal membuat kode customer unik");
            } finally {
                if (conn) {
                    conn.release();
                    conn = null;
                }
            }
        });

        return res.status(201).json({
            success: true,
            data: {
                kode,
                nama,
            },
        });
    } catch (err) {
        if (conn) {
            try {
                await conn.rollback();
            } catch {}
            conn.release();
        }
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage || err.message || "Gagal menambahkan customer",
        });
    }
};

const deletePermintaanHargaImage = async (req, res) => {
    try {
        const nomor = String(req.params.nomor || "").trim();
        const slot = String(req.params.slot || "1").trim();
        if (!["1", "2"].includes(slot)) {
            return res.status(400).json({
                success: false,
                message: "Slot gambar hanya 1 atau 2",
            });
        }

        const [rows] = await db.query(
            `SELECT mh_nomor, mh_status, mh_sal_kode, user_create FROM tmintaharga WHERE mh_nomor = ? LIMIT 1`,
            [nomor],
        );
        if (!rows?.length) {
            return res
                .status(404)
                .json({ success: false, message: "Data tidak ditemukan" });
        }
        if (isSalesUser(req) && !isOwnedBySalesKode(req, rows[0])) {
            return res.status(403).json({
                success: false,
                message: "Tidak berhak menghapus gambar data ini",
            });
        }
        if (
            String(rows[0].mh_status || "")
                .trim()
                .toUpperCase() !== "BELUM"
        ) {
            return res.status(409).json({
                success: false,
                message: "Hapus gambar hanya diizinkan untuk status BELUM",
            });
        }

        const fileName = slot === "2" ? `${nomor}-2.jpg` : `${nomor}.jpg`;
        const targetPath = path.join(UPLOAD_DIR, fileName);

        if (fs.existsSync(targetPath)) {
            await fs.promises.unlink(targetPath);
            console.log("[PermintaanHarga][DeleteImage][Success]", { nomor, slot, targetPath });
            return res.json({
                success: true,
                message: "Gambar berhasil dihapus dari server",
            });
        } else {
            console.warn("[PermintaanHarga][DeleteImage][NotFound]", { nomor, slot, targetPath });
            return res.json({
                success: true,
                message: "File gambar tidak ditemukan di server, namun data telah di-sinkronisasi",
            });
        }
    } catch (err) {
        console.error("[PermintaanHarga][DeleteImage][Error]", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Gagal menghapus gambar dari server",
        });
    }
};

const getPermintaanHargaStatusCounts = async (req, res) => {
    try {
        const monthRange = getCurrentMonthRange();
        const startDate =
            normalizeDate(req.query.startDate) || monthRange.start;
        const endDate = normalizeDate(req.query.endDate) || monthRange.end;

        const managerRole = isManagerUser(req);
        const authSalesKode = String(req.user?.sales_kode || "").trim();

        if (!managerRole && !authSalesKode) {
            return res.status(403).json({
                success: false,
                message: "Sales tidak valid (sales_kode kosong)",
            });
        }

        let query = `
            SELECT 
                COALESCE(mh_status, '') AS status,
                COUNT(*) AS jumlah
            FROM tmintaharga
            WHERE mh_tanggal >= ?
              AND mh_tanggal < DATE_ADD(?, INTERVAL 1 DAY)
        `;
        const params = [startDate, endDate];

        if (!managerRole) {
            query += " AND COALESCE(mh_sal_kode, '') = ?";
            params.push(authSalesKode);
        }

        query += " GROUP BY mh_status";

        const [rows] = await db.query(query, params);

        const statusMap = {
            BELUM: 0,
            MINTA: 0,
            WAIT: 0,
            DONE: 0,
            CANCEL: 0
        };

        for (const row of rows || []) {
            const statusKey = String(row?.status || "").trim().toUpperCase();
            if (statusKey in statusMap) {
                statusMap[statusKey] = toNumber(row?.jumlah, 0);
            }
        }

        return res.json({
            success: true,
            data: statusMap
        });
    } catch (err) {
        console.error("[PermintaanHarga][StatusCounts][Error]", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Gagal mengambil rincian status permintaan harga",
        });
    }
};


// --- ENGINE KALKULASI SPANDUK & MMT ---

const getKalkulasiOptions = async (req, res) => {
    try {
        const [spandukBahan] = await db.query(
            `SELECT DISTINCT 
                mhsp_metode AS metode, 
                mhsp_lebar AS lebar, 
                mhsp_jenis_kain AS jenis_kain 
             FROM tmintaharga_spanduk 
             ORDER BY mhsp_metode, mhsp_lebar, mhsp_jenis_kain`
        );

        const [mmtBahan] = await db.query(
            `SELECT DISTINCT 
                mhm_kategori AS kategori, 
                mhm_bahan_kode AS bahan_kode, 
                mhm_nama_bahan AS nama_bahan, 
                mhm_resolusi_tipe AS resolusi_tipe 
             FROM tmintaharga_mmt 
             WHERE mhm_is_netto = 0 
             ORDER BY mhm_kategori, mhm_bahan_kode`
        );

        const [toppingBanner] = await db.query(
            `SELECT 
                mhmt_kode AS kode, 
                mhmt_nama AS nama, 
                mhmt_kategori AS kategori, 
                mhmt_ukuran AS ukuran, 
                mhmt_material AS material, 
                mhmt_harga AS harga 
             FROM tmintaharga_mmt_tambahan 
             WHERE mhmt_aktif = 1 
             ORDER BY mhmt_id`
        );

        return res.json({
            success: true,
            data: {
                spanduk: spandukBahan,
                mmt: mmtBahan,
                topping: toppingBanner,
            }
        });
    } catch (err) {
        console.error("[PermintaanHarga][Kalkulasi][Options][Error]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

const calculateSpanduk = async (req, res) => {
    try {
        const { metode = "MANUAL", lebar = 90, jenisKain = "POLYESTER 50/36", panjang = 0, qty = 0 } = req.body;

        const numPanjang = toNumber(panjang, 0);
        const numQty = toNumber(qty, 0);
        const totalMeter = Math.round(numPanjang * numQty * 100) / 100;

        const [allStrata] = await db.query(
            `SELECT 
                mhsp_id AS id, 
                mhsp_qmin AS qmin, 
                mhsp_qmax AS qmax, 
                mhsp_harga AS harga 
             FROM tmintaharga_spanduk 
             WHERE mhsp_metode = ? AND mhsp_lebar = ? AND mhsp_jenis_kain = ? 
             ORDER BY mhsp_qmin`,
            [metode, toNumber(lebar, 90), jenisKain]
        );

        let matched = allStrata.find(s => totalMeter >= s.qmin && totalMeter <= s.qmax);
        if (!matched && allStrata.length > 0) {
            if (totalMeter < allStrata[0].qmin) {
                matched = allStrata[0]; // Jika qty lebih kecil dari minimum strata, gunakan strata awal (harga eceran)
            } else {
                matched = allStrata[allStrata.length - 1]; // Jika qty melebihi batas atas, gunakan strata tier tertinggi
            }
        }

        const tarifPerMeter = matched ? matched.harga : 0;
        const hargaSatuanPcs = Math.round(numPanjang * tarifPerMeter);
        const totalHarga = Math.round(totalMeter * tarifPerMeter);

        return res.json({
            success: true,
            data: {
                totalMeter,
                tarifPerMeter,
                hargaSatuanPcs,
                totalHarga,
                strataAktif: matched || null,
                tabelReferensi: allStrata,
            }
        });
    } catch (err) {
        console.error("[PermintaanHarga][Kalkulasi][Spanduk][Error]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

const calculateMmt = async (req, res) => {
    try {
        const { kategori = "VYNIL", bahanKode = "260", panjang = 0, lebar = 0, qty = 0, toppingKode = "", toppingQty = 0 } = req.body;

        const numPanjang = toNumber(panjang, 0);
        const numLebar = toNumber(lebar, 0);
        const numQty = toNumber(qty, 0);

        const luasPerPcs = Math.round(numPanjang * numLebar * 100) / 100;
        const totalLuas = Math.round(luasPerPcs * numQty * 100) / 100;

        const [allStrata] = await db.query(
            `SELECT 
                mhm_id AS id, 
                mhm_nama_bahan AS nama_bahan, 
                mhm_qmin AS qmin, 
                mhm_qmax AS qmax, 
                mhm_harga AS harga, 
                mhm_is_netto AS is_netto 
             FROM tmintaharga_mmt 
             WHERE mhm_kategori = ? AND mhm_bahan_kode = ? 
             ORDER BY mhm_is_netto, mhm_qmin`,
            [kategori, String(bahanKode)]
        );

        const normalStrata = allStrata.filter(s => s.is_netto === 0);
        let matched = normalStrata.find(s => totalLuas >= s.qmin && totalLuas <= s.qmax);
        if (!matched && normalStrata.length > 0) {
            if (totalLuas < normalStrata[0].qmin) {
                matched = normalStrata[0]; // Jika luas lebih kecil dari minimum strata, gunakan strata awal
            } else {
                matched = normalStrata[normalStrata.length - 1];
            }
        }

        const tarifPerM2 = matched ? matched.harga : 0;
        const biayaCetak = Math.round(totalLuas * tarifPerM2);

        let toppingData = null;
        let totalTopping = 0;

        if (toppingKode) {
            const [[topRow]] = await db.query(
                `SELECT 
                    mhmt_kode AS kode, 
                    mhmt_nama AS nama, 
                    mhmt_harga AS harga, 
                    mhmt_material AS material, 
                    mhmt_ukuran AS ukuran 
                 FROM tmintaharga_mmt_tambahan 
                 WHERE mhmt_kode = ? LIMIT 1`,
                [toppingKode]
            );
            if (topRow) {
                const numTopQty = toNumber(toppingQty, 1);
                totalTopping = Math.round(topRow.harga * numTopQty);
                toppingData = {
                    kode: topRow.kode,
                    nama: topRow.nama,
                    material: topRow.material,
                    ukuran: topRow.ukuran,
                    hargaSatuan: topRow.harga,
                    qty: numTopQty,
                    totalHarga: totalTopping,
                };
            }
        }

        const totalHarga = biayaCetak + totalTopping;
        const hargaSatuanPcs = numQty > 0 ? Math.round(totalHarga / numQty) : 0;

        return res.json({
            success: true,
            data: {
                luasPerPcs,
                totalLuas,
                tarifPerM2,
                biayaCetak,
                topping: toppingData,
                totalHarga,
                hargaSatuanPcs,
                strataAktif: matched || null,
                tabelReferensi: allStrata,
            }
        });
    } catch (err) {
        console.error("[PermintaanHarga][Kalkulasi][MMT][Error]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    getKalkulasiOptions,
    calculateSpanduk,
    calculateMmt,
    getPermintaanHargaList,
    getPermintaanHargaDetail,
    createPermintaanHarga,
    updatePermintaanHarga,
    createPermintaanHargaCustomer,
    copyPermintaanHarga,
    deletePermintaanHarga,
    uploadPermintaanHargaImage,
    uploadPermintaanHargaImageInternal,
    uploadPermintaanHargaImageBase64,
    deletePermintaanHargaImage,
    getPermintaanHargaStatusCounts,
};
