const { sql, connectDB } = require('../dbconfig');
const { DateTime } = require('luxon');

require('dotenv').config();

// 動態配置表名稱
const PRIZES_TABLE = process.env.PRIZES_TABLE;
const USER_LOTTERY_ENTRIES_TABLE = process.env.USER_LOTTERY_ENTRIES_TABLE;
const CONFIGURATION_SETTINGS_TABLE = process.env.CONFIGURATION_SETTINGS_TABLE;
const TIME_BASED_PROBABILITY_TABLE = process.env.TIME_BASED_PROBABILITY_TABLE;

// 通用 SQL 執行函數
async function executeQuery(query, inputs = {}) {
  try {
      const pool = await sql.connect();
      const request = pool.request();
      for (const [key, value] of Object.entries(inputs)) {
          request.input(key, value.type, value.value);
      }
      const result = await request.query(query);
      return result.recordset;
  } catch (error) {
      console.error('執行 SQL 失敗:', error.message);
      throw error;
  }
}

// 統一日期與時間處理
function getFormattedDateTime() {
  const today = new Date().toISOString().split('T')[0];
  const taiwanTime = DateTime.now().setZone('Asia/Taipei').toFormat('HH:mm:ss');
  return { today, taiwanTime };
}

// 返回格式化的 API 響應
function createResponse(success, data, message) {
  return { success, data, message };
}









// 獲取今日剩餘抽獎名額
exports.getRemainingPrizes = async (req, res) => {
  try {
      const { today } = getFormattedDateTime();
      const query = `
          SELECT COUNT(*) AS RemainingPrizes
          FROM ${PRIZES_TABLE}
          WHERE AvailableDate = @today AND IsClaimed = 0;
      `;
      const result = await executeQuery(query, { today: { type: sql.Date, value: today } });
      const remainingPrizes = result[0]?.RemainingPrizes || 0;
      res.json(createResponse(true, { remainingPrizes }, '成功獲取剩餘獎項數量'));
  } catch (error) {
      console.error('獲取剩餘獎項失敗:', error.message);
      res.status(500).json(createResponse(false, null, '無法獲取剩餘獎項數量'));
  }
};



// 用戶參加抽獎
exports.performLottery = async (req, res) => {
  const { userId, taskIds } = req.body; // 從請求中接收 userId 和 taskId
  const { today, taiwanTime } = getFormattedDateTime();
  console.log(`[INFO] 台灣時間轉換後: ${taiwanTime}`);
  const pool = await sql.connect();
  try {
    // 1. 獲取每日最大抽獎次數限制
    const settingsQuery = `
                          SELECT SettingValue
                          FROM ${CONFIGURATION_SETTINGS_TABLE}
                          WHERE SettingKey = 'MaxDailyDrawsPerUser'
                          `;
    const settingsResult = await pool.request().query(settingsQuery);
    const maxDailyDraws = parseInt(settingsResult.recordset[0]?.SettingValue || '0', 10);

    if (!maxDailyDraws) {
      return res.status(500).json({ message: '無法獲取每日抽獎次數限制' });
    }

    console.log(`[INFO] 每日最大抽獎次數限制: ${maxDailyDraws}`);
    // 2. 查詢當前用戶今日的抽獎次數
    const drawsQuery = `
        SELECT COUNT(*) AS TotalDraws
        FROM ${USER_LOTTERY_ENTRIES_TABLE}
        WHERE UserID = @userId AND CAST(DrawDate AS DATE) = @today
      `;
    const drawsResult = await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .input('today', sql.Date, today)
      .query(drawsQuery);
    const totalDrawsToday = drawsResult.recordset[0]?.TotalDraws || 0;

    console.log(`[INFO] 用戶今日抽獎次數: ${totalDrawsToday}`);

    // 3. 判斷是否超出每日抽獎限制
    if (totalDrawsToday >= maxDailyDraws) {
      return res.status(403).json({
        success: false,
        message: `您已達到每日最大抽獎次數限制 (${maxDailyDraws})，請明天再試！`,
      });
    }
    // 4. 根據當前時間獲取對應的機率設定
    const probabilityQuery = `
    SELECT TOP 1 WinningThreshold, TotalProbability
    FROM ${TIME_BASED_PROBABILITY_TABLE}
    WHERE '${taiwanTime}' >= StartTime AND '${taiwanTime}' < EndTime
`;

    const probabilityResult = await sql.query(probabilityQuery); // 執行直接查詢
    console.log('[INFO] Query Result:', probabilityResult.recordset);
    if (probabilityResult.recordset.length === 0) {
      return res.status(404).json({ message: '無符合的時間段' });
    }

    const { WinningThreshold, TotalProbability } = probabilityResult.recordset[0];
    // 5. 隨機生成一個數字，決定是否中獎
    const randomNumber = Math.floor(Math.random() * TotalProbability) + 1;
    const isWinner = randomNumber <= WinningThreshold;

    // 6. 查詢當天是否還有獎品
    const prizeQuery = `
        SELECT TOP 1 PrizeID, PrizeName, PrizeValue
        FROM ${PRIZES_TABLE}
        WHERE AvailableDate = @today AND IsClaimed = 0
        ORDER BY NEWID();
    `;
    const prizeResult = await pool.request()
      .input('today', sql.Date, today)
      .query(prizeQuery);

    if (prizeResult.recordset.length === 0) {
      // 當天無獎品時，記錄為未中獎
      const insertLotteryEntryQuery = `
          INSERT INTO ${USER_LOTTERY_ENTRIES_TABLE} ( UserID, TaskID, IsWinner, DrawDate)
          VALUES ( @userId, @taskId, 0, SWITCHOFFSET(SYSDATETIMEOFFSET(), '+08:00'));
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('taskId', sql.NVarChar, taskIds)
        .query(insertLotteryEntryQuery);

      return res.json({ success: false, message: '很遺憾，您未中獎！' });
    }

    // 獲取獎品信息
    const prize = prizeResult.recordset[0];
    const prizeId = prize.PrizeID;

    if (isWinner) {
      // 中獎處理
      const insertLotteryEntryQuery = `
          INSERT INTO ${USER_LOTTERY_ENTRIES_TABLE} (UserID, TaskID, PrizeID, IsWinner, DrawDate)
          VALUES (@userId, @taskId, @prizeId, 1, SWITCHOFFSET(SYSDATETIMEOFFSET(), '+08:00'));
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('taskId', sql.NVarChar, taskIds)
        .input('prizeId', sql.Int, prizeId)
        .query(insertLotteryEntryQuery);

      const updatePrizeQuery = `
          UPDATE ${PRIZES_TABLE}
          SET IsClaimed = 1, ClaimedByUserID = @userId, ClaimedDate = SWITCHOFFSET(SYSDATETIMEOFFSET(), '+08:00')
          WHERE PrizeID = @prizeId;
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('prizeId', sql.Int, prizeId)
        .query(updatePrizeQuery);

      return res.json({
        success: true,
        prizeName: prize.PrizeName,
        prizeValue: prize.PrizeValue,
      });
    } else {
      // 未中獎處理
      const insertLotteryEntryQuery = `
          INSERT INTO ${USER_LOTTERY_ENTRIES_TABLE} (UserID, TaskID, IsWinner, DrawDate)
          VALUES (@userId, @taskId, 0, SWITCHOFFSET(SYSDATETIMEOFFSET(), '+08:00'));
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('taskId',  sql.NVarChar, taskIds)
        .query(insertLotteryEntryQuery);

      return res.json({
        success: false,
        message: '很遺憾，您未中獎！',
      });
    }
  } catch (error) {
    console.error('抽獎失敗:', error.message);
    res.status(500).json({ success: false, message: '抽獎失敗，請稍後再試' });
  }
};

// 查詢用戶抽獎記錄
exports.getUserLotteryRecords = async (req, res) => {
  const { userId } = req.query;

  const query = `
      SELECT 
          u.LotteryEntryID,
          u.TaskID,
          p.PrizeName,
          p.PrizeValue,
          u.IsWinner,
          u.DrawDate
      FROM ${USER_LOTTERY_ENTRIES_TABLE} u
      LEFT JOIN Prizes p ON u.PrizeID = p.PrizeID
      WHERE u.UserID = @userId;
  `;
  try {
    const pool = await sql.connect();
    const result = await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .query(query);

    res.json(result.recordset);
  } catch (error) {
    console.error('獲取用戶抽獎記錄失敗:', error.message);
    res.status(500).json({ error: '無法獲取抽獎記錄' });
  }
};
