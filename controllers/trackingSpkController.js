const trackingSpkService = require("../services/trackingSpkService");
const {
    normalizeDate,
    getCurrentMonthRange,
    isManagerUser,
    getAuthSalesKode,
} = require("../utils/trackingHelper");

const getTrackingSpkList = async (req, res) => {
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
        const filterStatus = String(req.query.filterStatus || "").trim().toLowerCase();

        const rows = await trackingSpkService.getTrackingSpkList({
            managerRole,
            authSalesKode,
            startDate,
            endDate,
            search,
            filterStatus,
        });

        return res.json({
            success: true,
            data: rows || [],
            meta: {
                startDate,
                endDate,
                search,
                count: rows?.length || 0,
            },
        });
    } catch (err) {
        console.error("GET TRACKING SPK LIST ERROR:", err);
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal mengambil data tracking SPK",
        });
    }
};

const getTrackingSpkStatusCounts = async (req, res) => {
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

        const statusMap = await trackingSpkService.getTrackingSpkStatusCounts({
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
        console.error("GET TRACKING SPK STATUS COUNTS ERROR:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Gagal mengambil status counts SPK",
        });
    }
};

module.exports = {
    getTrackingSpkList,
    getTrackingSpkStatusCounts,
};
