const auth = require("../middleware/auth");
const authService = require("../services/authService");

const login = async (req, res) => {
    const { username, password, deviceId, versiApp } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Username dan password wajib diisi",
        });
    }

    try {
        const result = await authService.login({
            username,
            password,
            deviceId,
            versiApp,
        });

        if (!result.success) {
            return res.json({
                success: false,
                message: result.message,
            });
        }

        console.log("AUTH HEADER:", req.headers.authorization);
        return res.status(200).json({
            success: true,
            token: result.token,
            user: result.user,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Kesalahan server",
        });
    }
};

const profile = [
    auth,
    async (req, res) => {
        return res.status(200).json({
            success: true,
            user: {
                id: req.user?.id,
                nama: req.user?.nama,
                jabatan: req.user?.jabatan,
                cabang: req.user?.cabang,
                sales_kode: req.user?.sales_kode || "",
                sales_nama: req.user?.sales_nama || "",
            },
        });
    },
];

const register = async (req, res) => {
    const { nama, password, cabang, jabatan, deviceId } = req.body;
    console.debug(req.body);
    if (!nama || nama.length < 3 || !password || password.length < 3) {
        return res.status(400).json({
            success: false,
            message:
                "Data Belum Lengkap (Nama dan Password minimal 3 karakter)",
        });
    }

    try {
        const result = await authService.register({
            nama,
            password,
            cabang,
            jabatan,
            deviceId,
        });

        if (result.isUpdate) {
            return res.status(200).json({
                success: true,
                message: result.message,
            });
        } else {
            return res.status(201).json({
                success: true,
                message: result.message,
            });
        }
    } catch (err) {
        console.error("REGISTER ERROR:", err);
        return res.status(500).json({
            success: false,
            message: "Terjadi kesalahan server: " + err.message,
        });
    }
};

const checkDevice = async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) {
        return res.status(400).json({
            success: false,
            message: "Device belum terdaftar",
        });
    }

    try {
        const result = await authService.checkDevice({ deviceId });

        if (!result.success) {
            return res.json({
                success: false,
                message: result.message,
            });
        }

        return res.json({
            success: true,
            username: result.username,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};

module.exports = { login, register, checkDevice, profile };
