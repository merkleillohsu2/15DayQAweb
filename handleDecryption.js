const crypto = require('crypto');
const { decryptString } = require('./userSetup'); // 導入 decryptString 函數
const { config, sql } = require('./dbconfig');

require('dotenv').config();

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
    const userName = parsedData.User.Name;

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
    // 獲取當前時間作為 LastLoginTime
    const lastLoginTime = new Date().toISOString();

    // 檢查 UserId 是否已存在
    const checkResult = await sql.query`
        SELECT COUNT(*) as count 
        FROM Users 
        WHERE UserID = ${userId}
      `;
    if (checkResult.recordset[0].count > 0) {
      console.log('[INFO] User 已存在，更新 LastLoginTime');
      // 更新 LastLoginTime
      await sql.query`
            UPDATE Users 
            SET LastLoginTime = ${lastLoginTime} 
            WHERE UserID = ${userId}
          `;
    } else {
      console.log('[INFO] User 不存在，創建新記錄');
      // 插入新用戶
      await sql.query`
            INSERT INTO Users (UserID, UserName, LastLoginTime, tasksCompleted, rewards) 
            VALUES (${userId}, ${userName}, ${lastLoginTime}, '[]', 0)
          `;
    }
    try {
      // 確認是否需要發放獎勵
      const rewardCheck = await sql.query`
                                          SELECT surveyRewardGiven 
                                          FROM UserSurveyRewards 
                                          WHERE UserID = ${userId};
                                          `;
      console.log('[INFO] 獎勵檢查結果:', rewardCheck.recordset);   
      if (rewardCheck.recordset.length > 0 && !(rewardCheck.recordset[0].surveyRewardGiven)) {
        // 發放獎勵
        await sql.query`
                          UPDATE Users 
                          SET rewards = rewards + 10 
                          WHERE UserID = ${userId};
                      `;
        await sql.query`
                          UPDATE UserSurveyRewards 
                          SET surveyRewardGiven = 1 
                          WHERE UserID = ${userId};
                      `;
                      console.log('[INFO] 獎勵已發放');
      }
    } catch (err) {
      console.error('[ERROR] 發放獎勵失敗:', err.message);
      res.status(500).send('Failed to process reward.');
    }
    return { success: true, ContactId: userId, Query: urlquery };
  } catch (err) {
    console.error('[ERROR] 解密或存儲失敗:', err.message);
    return { error: `Failed to decrypt or store the string: ${err.message}` };
  }
};

// 將 handleDecryption 函數作為命名導出
module.exports = { handleDecryption };
