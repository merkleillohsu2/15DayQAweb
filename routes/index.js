const express = require('express');
const router = express.Router();
const { sql } = require('../dbconfig');
const { decryptString } = require('../userSetup'); // 導入 decryptString 函數

// 獲取當前日期，格式化為 YYYY-MM-DD
const getCurrentDate = () => {
  const date = new Date();
  return date.toISOString().split('T')[0];
};
const app = express();

// 根據當前日期跳轉到今日任務
router.get('/task-today', async (req, res) => {
  const currentDate = getCurrentDate();

  try {
    // 查找當前日期的任務
    const result = await sql.query`SELECT * FROM Tasks WHERE TaskDate = ${currentDate}`;
    const task = result.recordset[0];

    if (task) {
      // 保留查詢參數並重新導向到對應的任務頁面
      const queryParams = new URLSearchParams(req.query).toString();
      const redirectUrl = queryParams
        ? `/task/${task.TaskID}?${queryParams}`
        : `/task/${task.TaskID}`;
      res.redirect(redirectUrl);
    } else {
      res.status(404).send('今日無任務');
    }
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).send('Database error');
  }
});

// 每日任務頁面
for (let day = 1; day <= 15; day++) {
  router.get(`/task/${day}`, async (req, res) => {
    
    // 檢查是否存在 ContactId
    if (!req.session.ContactId) {
        console.error('[INFO] Session 缺少 ContactId，執行 /decrypt 邏輯');

        const urlquery = req.query.query; // 確保前端提供 query
        if (!urlquery) {
            return res.status(400).send('Missing query parameter for decryption');
        }

        try {
            // 解密 URL，模擬 /decrypt 的處理邏輯
            console.log('[INFO] 正在執行解密邏輯');
            const decryptedData = decryptString(decodeURIComponent(urlquery));
            const parsedData = JSON.parse(decryptedData);
            const userId = parsedData.User.ContactId;

            if (!userId) {
                return res.status(400).send('ContactId not found in decrypted data');
            }
            
            // 存儲到 session 中
            req.session.ContactId = userId;
            console.log('[INFO] ContactId 已成功存入 Session:', userId);
        } catch (err) {
            console.error('[ERROR] 解密失敗:', err.message);
            return res.status(500).send('Failed to decrypt data');
        }
    }
    console.log(`[INFO] 獲取 ContactId: ${req.session.ContactId}`);
    const currentDate = getCurrentDate();
    const userId = req.session.ContactId;

    try {
      const taskResult = await sql.query`SELECT * FROM Tasks WHERE TaskID = ${day}`;
      if (taskResult.recordset.length === 0) {
        return res.status(404).send('任務未找到');
      }
      const task = taskResult.recordset[0];
      task.TaskDate = task.TaskDate.toISOString().split('T')[0]; // 格式化 TaskDate 為 YYYY-MM-DD 字符串

      const completionResult = await sql.query`SELECT * FROM UserTaskCompletion WHERE UserID = ${userId} AND TaskID = ${day} AND IsCompleted = 1`;
      const isCompleted = completionResult.recordset.length > 0;
      console.log(`Completion count: ${JSON.stringify(isCompleted)}`);
      console.log(`Task: ${JSON.stringify(completionResult)}`);
      res.render(`task-${day}`, { task, currentDate, isCompleted });
    } catch (err) {
      res.status(500).send('Database error');
    }
  });

  // 任務完成邏輯
  router.post(`/task/${day}/complete`, async (req, res) => {
    const currentDate = getCurrentDate();
    const { UserId } = req.body; // 從請求中提取 UserId
    console.log('Request Body:', req.body);

    if (!UserId) {
      return res.status(400).send('缺少 UserId');
    }
    try {
      const userResult = await sql.query`SELECT * FROM Users WHERE UserID = ${UserId}`;
      if (userResult.recordset.length === 0) {
        throw new Error('User not found');
      }
      const taskResult = await sql.query`SELECT * FROM Tasks WHERE TaskID = ${day}`;
      if (taskResult.recordset.length === 0) {
        throw new Error('Task not found');
      }
      const task = taskResult.recordset[0];

      // 獲取 user 的資料
      const user = userResult.recordset[0];

      // 檢查 user.tasksCompleted 是否為有效的 JSON 字符串，否則初始化為空陣列
      let tasksCompleted;
      try {
        tasksCompleted = JSON.parse(user.tasksCompleted) || [];
      } catch (e) {
        tasksCompleted = [];
      }
      console.log("teste")
      // 確認任務是否已經完成
      const completionResult = await sql.query`SELECT * FROM UserTaskCompletion WHERE UserID = ${UserId} AND TaskID = ${day} AND IsCompleted = 1`;
      console.log(completionResult)
      if (completionResult.recordset.length > 0) {
        return res.status(400).send('任務已完成');
      }

      // 只比對到日期部分
      const taskDate = task.TaskDate.toISOString().split('T')[0];
      if (taskDate === currentDate) {
        // 記錄任務完成
        await sql.query`INSERT INTO UserTaskCompletion (UserID, TaskID, CompletionDate, IsCompleted) VALUES (${UserId}, ${day}, ${currentDate}, ${1})`;

        // 更新使用者的任務完成情況和獎勵
        tasksCompleted.push(day);
        const rewards = user.rewards + task.RewardAmount;

        await sql.query`UPDATE Users SET tasksCompleted = ${JSON.stringify(tasksCompleted)}, rewards = ${rewards} WHERE UserID = ${UserId}`;
        console.log(task);
        // 返回成功消息和獎勵金
        return res.json({ message: '恭喜你完成任務', reward: task.RewardAmount });
      } else {
        res.status(400).send('非今日任務');
      }
    } catch (err) {
      console.error(err); // 輸出錯誤信息到控制台
      res.status(500).send(`Database error: ${err.message}`); // 顯示詳細錯誤信息
    }
  });


}

// 首頁路由
router.get('/', (req, res) => {
  res.render('index');
});

// 首頁路由
router.get('/prize-info', (req, res) => {
  res.render('prize-info');
});



// 任務總表頁面
router.get('/task-list', async (req, res) => {
  try {
    const result = await sql.query`SELECT * FROM Tasks ORDER BY TaskDate ASC`;
    const tasks = result.recordset;
    res.render('task-list', { tasks });
  } catch (err) {
    res.status(500).send('Database error');
  }
});

module.exports = router;
