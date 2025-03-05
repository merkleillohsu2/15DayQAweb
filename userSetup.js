const crypto = require('crypto');
const sql = require('mssql'); // 假設您使用的是 mssql 庫
require('dotenv').config();

// 解密函數
function decryptString(cipherText) {
  const key = Buffer.from(process.env.DECRYPTION_KEY);
  const iv = Buffer.from(process.env.DECRYPTION_IV);

  console.log('DECRYPTION_KEY:', key.toString('hex'));
  console.log('DECRYPTION_IV:', iv.toString('hex'));

  if (key.length !== 32) {
    console.error('解密密鑰長度無效:', key.length);
    throw new Error('解密密鑰長度無效');
  }

  if (iv.length !== 16) {
    console.error('初始化向量長度無效:', iv.length);
    throw new Error('初始化向量長度無效');
  }

  try {
    const buffer = Buffer.from(cipherText, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(buffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('解密失敗:', err.message);
    throw new Error('解密失敗');
  }
}

// 配置數據庫連接
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true // 如果需要加密連接
  }
};

console.log('DB Config:', dbConfig);

// 設置用戶的中間件函數
async function setupUser(req, res, next) {
  const urlquery = req.query.query;
  if (!urlquery) {
    console.error('缺少 query 参数');
    return res.status(400).send('Missing query parameter');
  }

  try {
    console.log('解密前的字符串:', urlquery);
    const decryptedData = decryptString(decodeURIComponent(urlquery));
    console.log('解密後的數據:', decryptedData);

    const parsedData = JSON.parse(decryptedData);
    const userId = parsedData.User.ContactId;

    if (!userId) {
      console.error('未找到 ContactId');
      return res.status(400).send('ContactId not found in decrypted data');
    }

    console.log('UserId to store:', userId);

    // 連接數據庫
    await sql.connect(dbConfig);

    // 檢查 UserId 是否已存在
    const checkResult = await sql.query`SELECT COUNT(*) as count FROM Users WHERE UserId = ${userId}`;
    if (checkResult.recordset[0].count > 0) {
      console.log('UserId 已存在:', userId);
    } else {
      // 插入 UserId
      await sql.query`INSERT INTO Users (UserId) VALUES (${userId})`;
      console.log('UserId 已存儲:', userId);
    }

    // 記錄到會話
    if (!req.session) {
      console.error('會話未初始化');
      return res.status(500).send('Session not initialized');
    }

    req.session.ContactId = userId;
    req.session.Query = urlquery;

    res.locals.sessionData = { ContactId: userId, Query: urlquery };

    next();
  } catch (err) {
    console.error('解密或存儲失敗:', err.message);
    res.status(500).send('Failed to decrypt or store the string');
  }
}

module.exports = setupUser;
