const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { config, connectDB, sql } = require('./dbconfig');
const { handleDecryption } = require('./handleDecryption'); // 導入 decryptString 函數
const helmet = require('helmet');
const crypto = require('crypto');

const port = process.env.PORT || 3000;

// 連接數據庫
connectDB();
app.use(helmet.hsts({
  maxAge: 31536000, // 1 年
  includeSubDomains: true,
  preload: true
}));
// 使用 helmet 增強安全性，防止一些常見的網絡攻擊

app.use(express.json({ limit: '10kb' })); // 限制 JSON 請求大小為 10KB
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
    maxAge: 24 * 60 * 60 * 1000, // 設置 Session 24 小時後過期
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // 添加這個中間件
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64'); // 生成唯一 nonce

  let cspHeader = "";

  if (process.env.NODE_ENV === 'development') {
      cspHeader = `
          default-src 'self';
          script-src 'self' https://pmi--qa.sandbox.my.site.com https://tw.pmiandu.com;
          style-src 'self' https://pmi--qa.sandbox.my.site.com https://tw.pmiandu.com;
          frame-src 'self' http://localhost:3000 https://pmi--qa.sandbox.my.site.com https://tw.pmiandu.com;
          frame-ancestors 'none'; // 禁止外部嵌入
      `;
  } else {
      cspHeader = `
          default-src 'self';
          script-src 'self' https://pmi--qa.sandbox.my.site.com https://tw.pmiandu.com;
          style-src 'self' https://pmi--qa.sandbox.my.site.com https://tw.pmiandu.com;
          frame-src 'self' https://pmi--qa.sandbox.my.site.com https://tw.pmiandu.com;
          frame-ancestors 'none'; // 禁止外部嵌入
      `;
  }

  res.setHeader('Content-Security-Policy', cspHeader.replace(/\s+/g, ' ')); // 去除多餘空格
  next();
});
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options'); // 移除 X-Frame-Options
  next();
});
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 每 15 分鐘
  max: 100, // 每個 IP 限制 100 次請求
  message: '過多請求，請稍後再試',
});

app.use(limiter); // 使用速率限制中間件來防止暴力破解攻擊

const exportRoutes = require('./routes/exportRoutes');
const indexRouter = require('./routes/index');
const previewRoutes = require('./routes/previewRoutes');
const lotteryRoutes = require('./routes/lotteryRoutes');
const prizesRoutes = require('./routes/prizes');
const surveyRewardsRoutes = require('./routes/surveyRewardsRoutes'); // 導入 surveyRewardsRoutes

app.use('/lottery', lotteryRoutes); // 為抽獎功能設定基礎路徑 "/lottery"

// 定義 /decrypt 路由
/*app.get('/decrypt', async (req, res) => {
  const result = await handleDecryption(req, res);

  if (result.error) {
      return res.status(400).json({ error: result.error });
  }

  res.status(200).json({ message: 'User setup completed', ContactId: result.ContactId });
});*/

// Mount the route with a prefix (e.g., /preview)
app.use('/preview', previewRoutes);

// 獲取獎品的路由
app.use('/prizes', prizesRoutes);

app.use('/UploadSurveyReward', surveyRewardsRoutes);

// 匯出資料的路由
app.use('/export', exportRoutes,(req, res, next) => {
  if (!req.query.filename || /[^a-zA-Z0-9_-]/.test(req.query.filename)) {
    return res.status(400).send('不安全的文件名');
  }
  next();
}); // 確保這個中間件在路由之前被調用

// 主路由
app.use('/', indexRouter);

// 啟動服務器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

app.use((err, req, res, next) => {
  console.error('全局錯誤:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });
  res.status(err.status || 500).render('error', { message: '伺服器發生錯誤，請稍後再試！' });
});

