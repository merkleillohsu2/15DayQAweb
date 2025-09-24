const { sql, connectDB } = require('../dbconfig');
const { DateTime } = require('luxon');

require('dotenv').config();

// 動態配置表名稱
const PRIZES_TABLE = process.env.PRIZES_TABLE;
const USER_LOTTERY_ENTRIES_TABLE = process.env.USER_LOTTERY_ENTRIES_TABLE;
const TASKS_TABLE = process.env.TASKS_TABLE;
const LOTTERY_RULES_TABLE = process.env.LOTTERY_RULES_TABLE;
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
    const { today } = getFormattedDateTime(); // yyyy-MM-dd 格式（台灣時區）
    const query = `
    SELECT COUNT(*) AS RemainingPrizes
    FROM ${PRIZES_TABLE}
    WHERE @today BETWEEN AvailableStartDate AND AvailableEndDate
      AND IsClaimed = 0
      AND IsActive = 1;
  `;
    const result = await executeQuery(query, {
      today: { type: sql.Date, value: today }
    });

    const remainingPrizes = result[0]?.RemainingPrizes || 0;
    res.json(createResponse(true, { remainingPrizes }, '成功獲取剩餘獎項數量'));
  } catch (error) {
    console.error('獲取剩餘獎項失敗:', error.message);
    res.status(500).json(createResponse(false, null, '無法獲取剩餘獎項數量'));
  }
};



// 用戶參加抽獎
exports.performLottery = async (req, res) => {
  const { userId, taskId } = req.body; // 從請求中接收 userId 和 taskId
  console.log(`[INFO] 用戶 ${userId} 嘗試參加任務 ${taskId} 的抽獎`);
  const { today, taiwanTime } = getFormattedDateTime();
  console.log(`[INFO] 台灣時間轉換後: ${taiwanTime}`);
  const pool = await sql.connect();
  try {
    // 1. 查詢該任務的抽獎規則與使用者已抽次數
    const chanceQuery = `
    SELECT lr.MaxEntriesPerUser, ISNULL(ul.Draws, 0) AS DrawsUsed
    FROM ${TASKS_TABLE} t
    LEFT JOIN ${LOTTERY_RULES_TABLE} lr ON t.LotteryRuleID = lr.RuleID
    LEFT JOIN (
      SELECT TaskID, COUNT(*) AS Draws
      FROM ${USER_LOTTERY_ENTRIES_TABLE}
      WHERE UserID = @userId AND TaskID = @taskId
      GROUP BY TaskID
    ) ul ON ul.TaskID = t.TaskID
    WHERE t.TaskID = @taskId
  `;
    const chanceResult = await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .input('taskId', sql.Int, taskId)
      .query(chanceQuery);

    const chance = chanceResult.recordset[0];
    if (!chance || chance.MaxEntriesPerUser === undefined) {
      return res.status(404).json({ success: false, message: '無法取得抽獎規則' });
    }

    if (chance.DrawsUsed >= chance.MaxEntriesPerUser) {
      return res.status(403).json({ success: false, message: '此任務已達最大抽獎次數' });
    }

    // 2. 查詢時間段機率
    const probabilityQuery = `
    SELECT TOP 1 WinningThreshold, TotalProbability
    FROM ${TIME_BASED_PROBABILITY_TABLE}
    WHERE '${taiwanTime}' >= StartTime AND '${taiwanTime}' < EndTime
  `;
    const probabilityResult = await sql.query(probabilityQuery);
    if (probabilityResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: '無符合的時間段' });
    }

    const { WinningThreshold, TotalProbability } = probabilityResult.recordset[0];
    const randomNumber = Math.floor(Math.random() * TotalProbability) + 1;
    const isWinner = randomNumber <= WinningThreshold;


    // 3. 查詢可用獎品（依日期區間）
    const prizeQuery = `
    SELECT TOP 1 PrizeID, PrizeName, PrizeValue
    FROM ${PRIZES_TABLE}
    WHERE @today BETWEEN AvailableStartDate AND AvailableEndDate
      AND IsClaimed = 0
      AND IsActive = 1
    ORDER BY NEWID()
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

    // ✅ 有獎品可抽，繼續抽獎流程
    const prize = prizeResult.recordset[0];
    const prizeId = prize.PrizeID;

    // ✅ 插入抽獎記錄（中獎或未中獎）
    const insertLotteryEntryQuery = `
          INSERT INTO ${USER_LOTTERY_ENTRIES_TABLE} (UserID, TaskID, PrizeID, IsWinner, DrawDate)
          VALUES (@userId, @taskId, @prizeId, @isWinner, SWITCHOFFSET(SYSDATETIMEOFFSET(), '+08:00'));
        `;
    await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .input('taskId', sql.Int, taskId)
      .input('prizeId', sql.Int, prizeId)
      .input('isWinner', sql.Bit, isWinner ? 1 : 0)
      .query(insertLotteryEntryQuery);

    // ✅ 若中獎則更新獎品狀態
    if (isWinner) {
      const updatePrizeQuery = `
    UPDATE ${PRIZES_TABLE}
    SET IsClaimed = 1,
        ClaimedByUserID = @userId,
        ClaimedDate = SWITCHOFFSET(SYSDATETIMEOFFSET(), '+08:00')
    WHERE PrizeID = @prizeId;
  `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('prizeId', sql.Int, prizeId)
        .query(updatePrizeQuery);

      return res.json({
        success: true,
        prizeName: prize.PrizeName,
        prizeValue: prize.PrizeValue
      });
    } else {
      return res.json({
        success: false,
        message: '很遺憾，您未中獎！'
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
