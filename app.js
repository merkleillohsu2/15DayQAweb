const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { connectDB } = require('./dbconfig');
const setupUser = require('./userSetup'); // 引入 setupUser 函數

const port = process.env.PORT || 3000;
connectDB();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: 'your-secret-key', // 使用您的密鑰
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // 在開發環境下使用 HTTP
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const indexRouter = require('./routes/index');

// 使用 setupUser 函數來處理特定路由
app.use('/', async (req, res, next) => {
  try {
    await setupUser(req, res, next);
  } catch (error) {
    next(error);
  }
});

// 使用路由
app.use('/', indexRouter);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
