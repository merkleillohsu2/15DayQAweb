const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { config, connectDB, sql } = require('./dbconfig');
const { handleDecryption } = require('./handleDecryption'); // 導入 decryptString 函數

const port = process.env.PORT || 3000;

// 連接數據庫
connectDB();

// 配置中間件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: 'your-secret-key', // 替換成一個安全的密鑰
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // 僅在生產環境中啟用 HTTPS
    httpOnly: true,       // 禁止前端 JS 訪問 Cookie，增強安全性
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 跨站請求支持
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // 添加這個中間件

const indexRouter = require('./routes/index');
// 定義 /decrypt 路由
/*app.get('/decrypt', async (req, res) => {
  const result = await handleDecryption(req, res);

  if (result.error) {
      return res.status(400).json({ error: result.error });
  }

  res.status(200).json({ message: 'User setup completed', ContactId: result.ContactId });
});*/

// 主路由
app.use('/', indexRouter);

// 啟動服務器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

app.use((err, req, res, next) => {
  console.error('全局錯誤處理:', err.stack);
  res.status(500).render('error', { message: '伺服器發生錯誤，請稍後再試！' });
});

