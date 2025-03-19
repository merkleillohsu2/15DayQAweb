const crypto = require('crypto');
const { decryptString } = require('./userSetup'); // 導入 decryptString 函數
const { config, sql } = require('./dbconfig');
const { DateTime } = require('luxon');

require('dotenv').config();

const USERS_TABLE = process.env.USERS_TABLE
const REWARDS_TABLE = process.env.REWARDS_TABLE

const handleDecryption = async (req, res) => {
  const urlquery = req.query.query;

  if (!urlquery) {
    console.error('[ERROR] 缺少 query 參數，請求失敗');
    return { error: 'Missing query parameter in request' };
  }

  if (!req.session) {
    console.error('[ERROR] 會話未初始化，無法存儲 ContactId');
    return { error: 'Session not initialized. Check express-session configuration.' };
  }

  try {
    console.log('[INFO] 解密前的字符串:', urlquery);
    const decryptedData = decryptString(decodeURIComponent(urlquery));
    console.log('[INFO] 解密後的數據:', decryptedData);

    const parsedData = JSON.parse(decryptedData);
    const userId = parsedData.User.ContactId;
    const userName = parsedData.User.LastName + ' ' + parsedData.User.FirstName;

    if (!parsedData || !parsedData.User || !parsedData.User.ContactId) {
      console.error('[ERROR] 無效的解密數據，缺少 User 或 ContactId');
      return { error: 'Invalid decrypted data: missing User or ContactId' };
    }
    if (!userId) {
      console.error('[ERROR] 未找到 ContactId');
      return res.status(400).send('ContactId not found in decrypted data');
    }
    req.session.ContactId = userId;

    console.log('[INFO] UserId to store:', userId);

    // 連接數據庫
    try {
      await sql.connect(config);
    } catch (err) {
      console.error('[ERROR] 數據庫連接失敗:', err.message);
      return { error: 'Database connection failed', details: err.message };
    }
    // 獲取台灣時間
    // 獲取台灣時間，並轉換為 UTC 時間
    const lastLoginTime = DateTime.now().setZone('Asia/Taipei').toISO();
    console.log(lastLoginTime);

    // 單一查詢：檢查用戶是否存在並獲取獎勵狀態
    const combinedQuery = `
      SELECT 
        u.UserID, 
        u.LastLoginTime, 
        r.surveyRewardGiven 
      FROM ${USERS_TABLE} u
      LEFT JOIN ${REWARDS_TABLE} r ON u.UserID = r.UserID
      WHERE u.UserID = @userId;
    `;
    const pool = await sql.connect();
    const result = await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .query(combinedQuery);
    const userRecord = result.recordset[0];
    console.log('[INFO] 查詢結果:', userRecord);
    if (userRecord) {
      console.log('[INFO] User 已存在，更新 LastLoginTime');
      // 更新 LastLoginTime
      const updateQuery = `
       UPDATE ${USERS_TABLE}
       SET LastLoginTime = @lastLoginTime
       WHERE UserID = @userId
     `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('lastLoginTime', sql.DateTimeOffset, lastLoginTime)
        .query(updateQuery);
    } else {
      console.log('[INFO] User 不存在，創建新記錄');
      // 插入新用戶
      const insertQuery = `
        INSERT INTO ${USERS_TABLE} (UserID, UserName, LastLoginTime, tasksCompleted, rewards)
        VALUES (@userId, @userName, @lastLoginTime, '[]', 0)
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('userName', sql.NVarChar(255), userName)
        .input('lastLoginTime', sql.DateTimeOffset, lastLoginTime)
        .query(insertQuery);
    }
    // 檢查是否需要發放獎勵
    if (userRecord && userRecord.surveyRewardGiven === false) {
      console.log('[INFO] 發放獎勵中...');
      const updateRewardsQuery = `
        UPDATE ${USERS_TABLE}
        SET rewards = rewards + 10
        WHERE UserID = @userId;
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .query(updateRewardsQuery);

      const updateSurveyQuery = `
        UPDATE ${REWARDS_TABLE}
        SET surveyRewardGiven = 1
        WHERE UserID = @userId;
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .query(updateSurveyQuery);
      console.log('[INFO] 獎勵已發放');
    }
    return { success: true, ContactId: userId, Query: urlquery };
  } catch (err) {
    console.error('[ERROR] 解密或存儲失敗:', err.message);
    return { error: `Failed to decrypt or store the string: ${err.message}` };
  }
};

// 將 handleDecryption 函數作為命名導出
module.exports = { handleDecryption };
