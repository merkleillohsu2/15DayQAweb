const express = require('express');
const router = express.Router();
const lotteryController = require('../controllers/lotteryController');
const { handleDecryption } = require('../handleDecryption'); // 導入 decryptString 函數
const { sql } = require('../dbconfig');
const { DateTime } = require('luxon');

require('dotenv').config();
// 動態配置表名稱
const USERS_TABLE = process.env.USERS_TABLE;
const PRIZES_TABLE = process.env.PRIZES_TABLE;
const USER_TASK_COMPLETION_TABLE = process.env.USER_TASK_COMPLETION_TABLE;
const TASKS_TABLE = process.env.TASKS_TABLE;
const USER_LOTTERY_ENTRIES_TABLE = process.env.USER_LOTTERY_ENTRIES_TABLE;
const CONFIGURATION_SETTINGS_TABLE = process.env.CONFIGURATION_SETTINGS_TABLE;
const LOTTERY_RULES_TABLE = process.env.LOTTERY_RULES_TABLE;


// 獲取當前日期，格式化為 YYYY-MM-DD
const getCurrentDate = () => {
    const now = new Date();
    const taiwanOffset = 8 * 60; // 台灣時區 UTC+8 的分鐘數
    const localOffset = now.getTimezoneOffset(); // 當前時區的分鐘數
    const taiwanTime = new Date(now.getTime() + (taiwanOffset - localOffset) * 60 * 1000);
    return taiwanTime.toISOString().split('T')[0];
};


// 解密中間件
const handleDecryptionMiddleware = async (req, res, next) => {
    try {
        const result = await handleDecryption(req, res);

        if (result.error) {
            console.error('解密失敗:', result.error);
            // 渲染一個錯誤頁面，而不是直接返回 400 錯誤
            return res.render('error', { message: '無法處理解密數據，請重試' });
        }

        // 保存解密結果到 res.locals，供後續路由使用
        res.locals.contactId = result.ContactId;
        res.locals.query = result.Query;

        next(); // 繼續處理下一個路由

    } catch (err) {
        console.error('中間件錯誤:', err.message);
        res.render('error', { message: '伺服器錯誤，請稍後再試' });
    }
};

// 獲取今日剩餘抽獎名額
router.get('/get-remaining-prizes', lotteryController.getRemainingPrizes);

// 用戶參加抽獎
router.post('/perform-lottery', lotteryController.performLottery);

// 查詢用戶的抽獎記錄
router.get('/get-user-lottery-records', lotteryController.getUserLotteryRecords);


router.get('/bounce', handleDecryptionMiddleware, async (req, res) => {
    try {
        const userId = req.session.ContactId;
        if (!userId) {
            console.error('[ERROR] 缺少有效的 ContactId');
            return res.render('error', { message: '無效的使用者資訊，請重新登入！' });
        }

        const taiwanNow = DateTime.now().setZone('Asia/Taipei');
        const currentDate = taiwanNow.toISODate(); // yyyy-MM-dd
        console.log(`[INFO] 今日台灣時間: ${currentDate}`);
        console.log(`[INFO] 獲取 ContactId: ${userId}`);

        const pool = await sql.connect();
        // 1. 查詢使用者 Chain 相符的任務 + 完成狀態 + 抽獎規則 + 抽獎次數
        // ✅ 查詢還有抽獎機會的任務（已完成、在期間內、尚未達抽獎上限）
        const query = `
                        SELECT 
                            t.TaskID,
                            t.TaskName,
                            lr.RuleID,
                            lr.RuleName,
                            lr.MaxEntriesPerUser,
                            ISNULL(ul.Draws, 0) AS DrawsUsed,
                            t.StartDate,
                            t.EndDate
                        FROM ${TASKS_TABLE} t
                        INNER JOIN ${USERS_TABLE} u ON u.UserID = @userId AND t.Chain = u.Chain
                        INNER JOIN ${USER_TASK_COMPLETION_TABLE} utc ON utc.TaskID = t.TaskID AND utc.UserID = @userId AND utc.IsCompleted = 1
                        LEFT JOIN ${LOTTERY_RULES_TABLE} lr ON t.LotteryRuleID = lr.RuleID
                        LEFT JOIN (
                            SELECT TaskID, UserID, COUNT(*) AS Draws
                            FROM ${USER_LOTTERY_ENTRIES_TABLE}
                            WHERE UserID = @userId
                            GROUP BY TaskID, UserID
                        ) ul ON ul.TaskID = t.TaskID AND ul.UserID = @userId
                        WHERE @currentDate BETWEEN t.StartDate AND t.EndDate
                            AND ISNULL(ul.Draws, 0) < lr.MaxEntriesPerUser
                        `;

        const result = await pool.request()
            .input('userId', sql.VarChar(36), userId)
            .input('currentDate', sql.Date, currentDate)
            .query(query);

        const eligibleTasks = result.recordset.map(row => ({
            taskId: row.TaskID,
            taskName: row.TaskName,
            ruleName: row.RuleName,
            maxEntries: row.MaxEntriesPerUser,
            usedEntries: row.DrawsUsed,
            remainingEntries: Math.max(0, row.MaxEntriesPerUser - row.DrawsUsed),
            startDate: DateTime.fromJSDate(row.StartDate).toISODate(),
            endDate: DateTime.fromJSDate(row.EndDate).toISODate()
        }));

        if (eligibleTasks.length === 0) {
            console.log('[INFO] 無符合抽獎資格的任務，跳轉回任務頁');
            return res.redirect('/tasks');
        }

        const taskIds = eligibleTasks.map(task => task.taskId);
        console.log(`[INFO] 符合抽獎資格的任務 ID: ${taskIds.join(', ')}`);


        // ✅ 查詢剩餘獎品
        const remainingPrizesQuery = `
      SELECT COUNT(*) AS RemainingPrizes
            FROM [dbo].[Prizes]
            WHERE @currentDate BETWEEN AvailableStartDate AND AvailableEndDate
            AND IsClaimed = 0
            AND IsActive = 1;
                `;
        const remainingPrizesResult = await pool.request()
            .input('currentDate', sql.Date, currentDate)
            .query(remainingPrizesQuery);

        const remainingPrizes = remainingPrizesResult.recordset[0]?.RemainingPrizes || 0;
        console.log(`剩餘獎品數: ${remainingPrizes}`);

        // ✅ 渲染 Bounce 頁面
        res.render('Bounce', {
            contactId: res.locals.contactId,
            query: res.locals.query,
            taskIds,
            remainingPrizes,
            eligibleTasks
        });

    } catch (err) {
        console.error('檢查邏輯失敗:', err.message);
        res.render('error', { message: '系統錯誤，請稍後再試！' });
    }
});


module.exports = router;
