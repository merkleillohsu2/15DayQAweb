const express = require('express');
const router = express.Router();
const previewController = require('../controllers/previewController');

// Define the route for previewing data
router.get('/preview-data', previewController.previewTableData);

module.exports = router;
