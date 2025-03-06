const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { config, connectDB, sql } = require('./dbconfig');
const { decryptString } = require('./userSetup'); // 導入 decryptString 函數

const port = process.env.PORT || 3000;

// 連接數據庫
connectDB();

// 配置中間件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: 'your-secret-key', // 使用您的密鑰
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }, // 在開發環境下使用 HTTP
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // 添加這個中間件

const indexRouter = require('./routes/index');

// 定義 /decrypt 路由
app.get('/decrypt', async (req, res) => {
  const urlquery = req.query.query;

  if (!urlquery) {
    console.error('[ERROR] 缺少 query 參數，請求失敗');
    return res.status(400).send('Missing query parameter in request');
  }


  try {
    // 解密字符串
    console.log('[INFO] 解密前的字符串:', urlquery);
    const decryptedData = decryptString(decodeURIComponent(urlquery));
    console.log('[INFO] 解密後的數據:', decryptedData);

    const parsedData = JSON.parse(decryptedData);
    const userId = parsedData.User.ContactId;
    const userName = parsedData.User.Name; // 假設解密結果包含用戶名

    console.log(`User ID: ${userId}`);
    req.session.ContactId = userId;

    if (!parsedData || !parsedData.User || !parsedData.User.ContactId) {
      console.error('[ERROR] 無效的解密數據，缺少 User 或 ContactId');
      return res.status(400).send('Invalid decrypted data: missing User or ContactId');
    }

    if (!userId) {
      console.error('[ERROR] 未找到 ContactId');
      return res.status(400).send('ContactId not found in decrypted data');
    }

    console.log('[INFO] UserId to store:', userId);

    // 連接數據庫
    try {
      await sql.connect(config);
    } catch (err) {
      console.error('[ERROR] 數據庫連接失敗:', err.message);
      return res.status(500).send('Database connection failed');
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

    // 記錄到會話
    if (!req.session) {
      console.error('[ERROR] 會話未初始化，請確認 express-session 中間件已啟用');
      return res.status(500).send('Session not initialized, check middleware');
    }
    // 提供會話數據給響應
    res.locals.sessionData = { ContactId: userId, Query: urlquery };

    res.status(200).json({ message: 'User setup completed', ContactId: userId });
  } catch (err) {
    console.error('[ERROR] 解密或存儲失敗:', err.message);
    res.status(500).send(`Failed to decrypt or store the string: ${err.message}`);
  }
});

// 主路由
app.use('/', indexRouter);

// 啟動服務器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
