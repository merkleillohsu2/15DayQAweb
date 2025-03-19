const express = require('express');
const router = express.Router();
const lotteryController = require('../controllers/lotteryController');

// 獲取今日剩餘抽獎名額
router.get('/get-remaining-prizes', lotteryController.getRemainingPrizes);

// 用戶參加抽獎
router.post('/perform-lottery', lotteryController.performLottery);

// 查詢用戶的抽獎記錄
router.get('/get-user-lottery-records', lotteryController.getUserLotteryRecords);

module.exports = router;
