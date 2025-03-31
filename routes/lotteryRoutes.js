const express = require('express');
const router = express.Router();
const lotteryController = require('../controllers/lotteryController');
const { handleDecryption } = require('../handleDecryption'); // 導入 decryptString 函數
const { sql } = require('../dbconfig');

require('dotenv').config();
// 動態配置表名稱
const USERS_TABLE = process.env.USERS_TABLE;
const PRIZES_TABLE = process.env.PRIZES_TABLE;
const USER_TASK_COMPLETION_TABLE = process.env.USER_TASK_COMPLETION_TABLE;
const TASKS_TABLE = process.env.TASKS_TABLE;
const USER_LOTTERY_ENTRIES_TABLE = process.env.USER_LOTTERY_ENTRIES_TABLE;
const CONFIGURATION_SETTINGS_TABLE = process.env.CONFIGURATION_SETTINGS_TABLE;

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
        console.log(`[INFO] 獲取 ContactId: ${req.session.ContactId}`);
        const currentDate = new Date().toISOString().split('T')[0];
        const userId = req.session.ContactId;
        if (!userId) {
            console.error('[ERROR] 缺少有效的 ContactId');
            return res.render('error', { message: '無效的使用者資訊，請重新登入！' });
        }

        console.log(`今日時間: ${currentDate}`);
        const pool = await sql.connect();
        // 1. 獲取當天所有的任務
        const tasksQuery = `
                            SELECT t.TaskID, utc.IsCompleted
                            FROM ${TASKS_TABLE} t
                            LEFT JOIN ${USER_TASK_COMPLETION_TABLE} utc 
                                ON t.TaskID = utc.TaskID AND utc.UserID = @userId
                            INNER JOIN ${USERS_TABLE} u
                                ON u.UserID = @userId
                            WHERE t.TaskDate = @currentDate
                                AND t.Chain = u.Chain; -- 僅返回與用戶 Chain 匹配的任務
                        `;
        const tasksResult = await pool.request()
            .input('userId', sql.VarChar(36), userId)
            .input('currentDate', sql.Date, currentDate)
            .query(tasksQuery);
        const tasks = tasksResult.recordset;

        if (tasks.length === 0) {
            console.log(`[INFO] 今日無任務`);
            return res.redirect('/tasks'); // 如果無任務，跳轉到任務頁
        }

        console.log(`[INFO] 今日任務數量: ${tasks.length}`);

        // 2. 檢查是否所有任務都已完成
        const allTasksCompleted = tasks.every(task => task.IsCompleted === true);
        console.log(`[INFO] 任務完成狀態: ${JSON.stringify(tasks.map(task => ({ TaskID: task.TaskID, IsCompleted: task.IsCompleted })), null, 2)}`);
        if (!allTasksCompleted) {
            console.log('[INFO] 有未完成的任務，跳轉回任務頁');
            return res.redirect('/tasks'); // 若有未完成的任務，跳轉到任務頁
        }



        // 3. 獲取所有任務的 TaskID（以便傳送到下一頁面）
        const taskIds = tasks.map(task => task.TaskID);
        console.log(`[INFO] 當天所有任務 ID: ${taskIds.join(', ')}`);

        // 4. 檢查剩餘抽獎次數
        const drawsQuery = `
        SELECT COUNT(*) AS TotalDraws
        FROM ${USER_LOTTERY_ENTRIES_TABLE}
        WHERE UserID = @userId AND CAST(DrawDate AS DATE) = @currentDate;
        `;
        const drawsResult = await pool.request()
            .input('userId', sql.VarChar(36), userId)
            .input('currentDate', sql.Date, currentDate)
            .query(drawsQuery);
        const totalDrawsToday = drawsResult.recordset[0]?.TotalDraws || 0;
        console.log(`今日抽獎次數: ${totalDrawsToday}`);

        // 5. 獲取最大抽獎次數
        const settingsQuery = `
                                SELECT SettingValue
                                FROM ${CONFIGURATION_SETTINGS_TABLE}
                                WHERE SettingKey = 'MaxDailyDrawsPerUser';
                            `;
        const settingsResult = await pool.request().query(settingsQuery);
        const maxDailyDraws = parseInt(settingsResult.recordset[0]?.SettingValue || '0', 10);


        // 6. 檢查剩餘獎品
        const remainingPrizesQuery = `
                    SELECT COUNT(*) AS RemainingPrizes
                    FROM ${PRIZES_TABLE}
                    WHERE AvailableDate = @currentDate AND IsClaimed = 0;
                `;
        const remainingPrizesResult = await pool.request()
            .input('currentDate', sql.Date, currentDate)
            .query(remainingPrizesQuery);
        const remainingPrizes = remainingPrizesResult.recordset[0]?.RemainingPrizes || 0;

        console.log(`剩餘獎品數: ${remainingPrizes}, 最大每日抽獎次數: ${maxDailyDraws}`);


        // 渲染 Bounce 頁面，傳遞必要資訊
        res.render('Bounce', {
            contactId: res.locals.contactId,
            query: res.locals.query,
            taskIds, // 當天的任務 ID
            remainingPrizes,
            isMaxDrawsReached: totalDrawsToday >= maxDailyDraws // 是否已達最大次數
        });
    } catch (err) {
        console.error('檢查邏輯失敗:', err.message);
        res.render('error', { message: '系統錯誤，請稍後再試！' });
    }
});


module.exports = router;
