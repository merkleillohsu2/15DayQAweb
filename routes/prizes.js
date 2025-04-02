// routes/prizes.js
const express = require('express');
const router = express.Router();
const prizesController = require('../controllers/prizesController');

// 定義獲取所有 Prize 的路由
router.get('/all', prizesController.getAllPrizes);

module.exports = router;