const express = require('express');
const router = express.Router();
const { sql } = require('../dbconfig');

// 獲取當前日期
const getCurrentDate = () => {
  const date = new Date();
  return date.toISOString().split('T')[0]; // 格式化為 YYYY-MM-DD
};

// 根據當前日期跳轉到今日任務
router.get('/task-today', async (req, res) => {
  const currentDate = getCurrentDate();

  try {
    // 查找當前日期的任務
    const result = await sql.query`SELECT * FROM Tasks WHERE TaskDate = ${currentDate}`;
    const task = result.recordset[0];

    if (task) {
      // 重新導向到對應的任務頁面
      res.redirect(`/task/${task.TaskID}`);
    } else {
      res.status(404).send('今日無任務');
    }
  } catch (err) {
    res.status(500).send('Database error');
  }
});

// 每日任務頁面
for (let day = 1; day <= 15; day++) {
  router.get(`/task/${day}`, async (req, res) => {
    const currentDate = getCurrentDate(); // 獲取當前日期

    try {
      const result = await sql.query`SELECT * FROM Tasks WHERE TaskID = ${day}`;
      const task = result.recordset[0];

      // 檢查任務日期是否已過或是當天任務
      const isTaskAvailable = new Date(task.TaskDate) <= new Date(currentDate);
      const isToday = new Date(task.TaskDate).toISOString().split('T')[0] === currentDate;

      res.render(`task-${day}`, { task, isTaskAvailable, isToday, currentDate });
    } catch (err) {
      res.status(500).send('Database error');
    }
  });

  // 任務完成邏輯
  router.post(`/task/${day}/complete`, async (req, res) => {
    const currentDate = getCurrentDate(); // 獲取當前日期
    const userId = req.cookies.userId;

    try {
      const userResult = await sql.query`SELECT * FROM Users WHERE UserID = ${userId}`;
      const taskResult = await sql.query`SELECT * FROM Tasks WHERE TaskID = ${day}`;
      const user = userResult.recordset[0];
      const task = taskResult.recordset[0];

      if (new Date(task.TaskDate).toISOString().split('T')[0] !== currentDate) {
        return res.status(400).send('只能在當天完成任務');
      }

      // 更新使用者的任務完成情況和獎勵
      const tasksCompleted = user.tasksCompleted ? JSON.parse(user.tasksCompleted) : [];
      tasksCompleted.push(day);
      const rewards = user.rewards + task.RewardAmount;

      await sql.query`UPDATE Users SET tasksCompleted = ${JSON.stringify(tasksCompleted)}, rewards = ${rewards} WHERE UserID = ${userId}`;

      res.redirect(`/task/${day}`);
    } catch (err) {
      res.status(500).send('Database error');
    }
  });
}

// 首頁路由
router.get('/', (req, res) => {
  res.render('index');
});

module.exports = router;
