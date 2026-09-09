const db = require("../config/dbMain");
const jwt = require("jsonwebtoken");
const { resolveSalesIdentity } = require("../utils/salesIdentityResolver");

const login = async ({ username, password, deviceId, versiApp }) => {
    const [rows] = await db.query(
        `SELECT *
        FROM tkaryawan
        WHERE kar_isaktif = 1
          AND kar_nama = ?
          AND kar_password = ?
        LIMIT 1`,
        [username, password],
    );

    if (!rows || rows.length === 0) {
        return {
            success: false,
            message: "Username atau password salah",
        };
    }

    const user = rows[0];
    const resolvedSales = await resolveSalesIdentity({
        loginUser: {
            id: user.id,
            nama: user.kar_nama,
            jabatan: user.kar_jabatan,
            cabang: user.kar_cabang,
        },
    });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
    });

    await db.query(
        `INSERT INTO marketing.log_plantoday
        (log_nama, log_cabang, log_versi_app, tanggal, log_phoneid)
        VALUES (?, ?, ?, NOW(), ?)`,
        [user.kar_nama, user.kar_cabang, versiApp || "", deviceId || ""],
    );

    return {
        success: true,
        token,
        user: {
            id: user.id,
            nama: user.kar_nama,
            jabatan: user.kar_jabatan,
            cabang: user.kar_cabang,
            sales_kode: resolvedSales?.sales_kode || "",
            sales_nama: resolvedSales?.sales_nama || "",
        },
    };
};

const register = async ({ nama, password, cabang, jabatan, deviceId }) => {
    const [rows] = await db.query(
        `SELECT * FROM tkaryawan
        WHERE kar_nama = ?
        AND kar_registrasi = ?
        LIMIT 1`,
        [nama, deviceId],
    );

    if (rows && rows.length > 0) {
        await db.query(
            `UPDATE tkaryawan
            SET kar_jabatan = ?,
                kar_cabang = ?,
                kar_password = ?
            WHERE kar_nama = ? AND kar_registrasi = ?`,
            [jabatan, cabang, password, nama, deviceId],
        );

        return {
            isUpdate: true,
            message: "Update Password Berhasil.\nSilahkan Login Ulang",
        };
    } else {
        await db.query(
            `INSERT INTO tkaryawan
            (kar_nama, kar_cabang, kar_jabatan, kar_registrasi, kar_password, kar_isaktif)
            VALUES (?, ?, ?, ?, ?, 0)`,
            [nama, cabang, jabatan, deviceId, password],
        );

        return {
            isUpdate: false,
            message: "Registrasi Berhasil. Hubungi IT untuk aktifkan user.",
        };
    }
};

const checkDevice = async ({ deviceId }) => {
    const [rows] = await db.query(
        `SELECT l.log_nama AS kar_nama
         FROM marketing.log_plantoday l
         INNER JOIN tkaryawan k ON k.kar_nama = l.log_nama
         WHERE l.log_phoneid = ?
           AND k.kar_isaktif = 1
         ORDER BY l.tanggal DESC
         LIMIT 1`,
        [deviceId],
    );

    if (!rows || rows.length === 0) {
        return {
            success: false,
            message: "Device belum terdaftar",
        };
    }

    return {
        success: true,
        username: rows[0].kar_nama,
    };
};

module.exports = {
    login,
    register,
    checkDevice,
};
