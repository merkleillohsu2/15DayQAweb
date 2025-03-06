const crypto = require('crypto');
const sql = require('mssql');
require('dotenv').config();

// 解密函數
const decryptString = (cipherText) => {
  const crypto = require('crypto');
  const key = Buffer.from(process.env.DECRYPTION_KEY); // 32 字節
  const iv = Buffer.from(process.env.DECRYPTION_IV); // 16 字節

  if (key.length !== 32) {
    throw new Error('解密密鑰長度無效');
  }
  if (iv.length !== 16) {
    throw new Error('初始化向量長度無效');
  }
  console.log('密鑰:', key.toString('hex'));
  console.log('IV:', iv.toString('hex'));


  try {
    const buffer = Buffer.from(cipherText, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(buffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error('解密失敗: ' + err.message);
  }
};

// 數據庫配置
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true,
  },
};

// 中間件函數
/*
async function setupUser(req, res, next) {
  const urlquery = req.query.query;
  if (!urlquery) {
    console.error('[ERROR] 缺少 query 參數');
    return res.status(400).send('Missing query parameter');
  }

  try {
    // 解密字符串
    console.log('[INFO] 解密前的字符串:', urlquery);
    const decryptedData = decryptString(decodeURIComponent(urlquery));
    console.log('[INFO] 解密後的數據:', decryptedData);

    const parsedData = JSON.parse(decryptedData);
    const userId = parsedData.User.ContactId;
    const userName = parsedData.User.Name; // 假設解密結果包含用戶名

    if (!userId) {
      console.error('[ERROR] 未找到 ContactId');
      return res.status(400).send('ContactId not found in decrypted data');
    }

    console.log('[INFO] UserId to store:', userId);

    // 連接數據庫
    await sql.connect(dbConfig);

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

    // 記錄到會話
    if (!req.session) {
      console.error('[ERROR] 會話未初始化');
      return res.status(500).send('Session not initialized');
    }

    req.session.ContactId = userId;
    req.session.Query = urlquery;

    // 提供會話數據給響應
    res.locals.sessionData = { ContactId: userId, Query: urlquery };

    next();
  } catch (err) {
    console.error('[ERROR] 解密或存儲失敗:', err.message);
    res.status(500).send(`Failed to decrypt or store the string: ${err.message}`);
  }
}
 */
// 將 decryptString 函數作為命名導出
module.exports = { decryptString };
