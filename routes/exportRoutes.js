const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');

router.get('/export-data', async (req, res) => {
    res.render('export-data'); // 確保這裡的 'export-data' 與 ejs 文件名一致
});

// 路由
router.get('/get-tables', exportController.getTables);
router.get('/export-table-csv', exportController.exportTableAsCsv);
router.get('/export-all-tables-csv', exportController.exportAllTablesAsCsv);

module.exports = router;
