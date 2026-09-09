const trackingPenawaranService = require("../services/trackingPenawaranService");
const {
    normalizeDate,
    getCurrentMonthRange,
    isManagerUser,
    getAuthSalesKode,
} = require("../utils/trackingHelper");

const getTrackingPenawaranList = async (req, res) => {
    try {
        const managerRole = isManagerUser(req);
        const authSalesKode = getAuthSalesKode(req);
        if (!managerRole && !authSalesKode) {
            return res.status(403).json({
                success: false,
                message: "Sales tidak valid (sales_kode kosong)",
            });
        }

        const monthRange = getCurrentMonthRange();
        const startDate =
            normalizeDate(req.query.startDate) || monthRange.start;
        const endDate = normalizeDate(req.query.endDate) || monthRange.end;
        const search = String(req.query.search || "").trim();
        const sales = String(req.query.sales || "").trim();
        const customer = String(req.query.customer || "").trim();
        const status = String(req.query.status || "").trim().toUpperCase();

        const result = await trackingPenawaranService.getTrackingPenawaranList({
            managerRole,
            authSalesKode,
            startDate,
            endDate,
            search,
            sales,
            customer,
            status,
        });

        return res.json({
            success: true,
            data: result.rows,
            meta: {
                startDate,
                endDate,
                search,
                count: result.rows.length,
                filter_options: {
                    sales: result.availableSales,
                    customers: result.availableCustomers,
                },
            },
        });
    } catch (err) {
        console.error("GET TRACKING PENAWARAN LIST ERROR:", err);
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal mengambil data tracking penawaran",
        });
    }
};

const getTrackingPenawaranDetailByNoPenawaran = async (req, res) => {
    try {
        const managerRole = isManagerUser(req);
        const authSalesKode = getAuthSalesKode(req);
        if (!managerRole && !authSalesKode) {
            return res.status(403).json({
                success: false,
                message: "Sales tidak valid (sales_kode kosong)",
            });
        }

        const noPenawaran = String(
            req.params.noPenawaran || req.query.noPenawaran || "",
        ).trim();

        if (!noPenawaran) {
            return res.status(400).json({
                success: false,
                message: "No. penawaran tidak valid",
            });
        }

        const data = await trackingPenawaranService.getTrackingPenawaranDetailByNoPenawaran({
            managerRole,
            authSalesKode,
            noPenawaran,
        });

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Data tracking penawaran tidak ditemukan",
            });
        }

        return res.json({
            success: true,
            data,
        });
    } catch (err) {
        console.error("GET TRACKING PENAWARAN DETAIL ERROR:", err);
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal mengambil detail tracking penawaran",
        });
    }
};

const getTrackingPenawaranStatusCounts = async (req, res) => {
    try {
        const managerRole = isManagerUser(req);
        const authSalesKode = getAuthSalesKode(req);
        if (!managerRole && !authSalesKode) {
            return res.status(403).json({
                success: false,
                message: "Sales tidak valid (sales_kode kosong)",
            });
        }

        const monthRange = getCurrentMonthRange();
        const startDate =
            normalizeDate(req.query.startDate) || monthRange.start;
        const endDate = normalizeDate(req.query.endDate) || monthRange.end;

        const statusMap = await trackingPenawaranService.getTrackingPenawaranStatusCounts({
            managerRole,
            authSalesKode,
            startDate,
            endDate,
        });

        return res.json({
            success: true,
            data: statusMap,
        });
    } catch (err) {
        console.error("GET TRACKING PENAWARAN STATUS COUNTS ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Gagal mengambil status counts penawaran",
        });
    }
};

module.exports = {
    getTrackingPenawaranList,
    getTrackingPenawaranDetailByNoPenawaran,
    getTrackingPenawaranStatusCounts,
};
