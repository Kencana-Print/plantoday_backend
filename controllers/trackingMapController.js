const trackingMapService = require("../services/trackingMapService");
const {
    normalizeDate,
    getCurrentMonthRange,
    isManagerUser,
    getAuthSalesKode,
} = require("../utils/trackingHelper");

const getTrackingMapList = async (req, res) => {
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
        const filterBast = String(req.query.filterBast || "").trim().toLowerCase();
        const filterSjMap = String(req.query.filterSjMap || "").trim().toLowerCase();

        const result = await trackingMapService.getTrackingMapList({
            managerRole,
            authSalesKode,
            startDate,
            endDate,
            search,
            sales,
            filterBast,
            filterSjMap,
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
                },
            },
        });
    } catch (err) {
        console.error("GET TRACKING MAP LIST ERROR:", err);
        return res.status(500).json({
            success: false,
            message:
                err.sqlMessage ||
                err.message ||
                "Gagal mengambil data tracking MAP",
        });
    }
};

module.exports = {
    getTrackingMapList,
};
