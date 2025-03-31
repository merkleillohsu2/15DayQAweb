const express = require('express');
const router = express.Router();
const { sql } = require('../dbconfig');
const { decryptString } = require('../userSetup'); // 導入 decryptString 函數
const { handleDecryption } = require('../handleDecryption'); // 導入 decryptString 函數

require('dotenv').config(); // 加載環境變數

// 導入表名環境變數
const TASKS_TABLE = process.env.TASKS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const USER_TASK_COMPLETION_TABLE = process.env.USER_TASK_COMPLETION_TABLE;
const REWARDS_TABLE = process.env.REWARDS_TABLE;


// 獲取當前日期，格式化為 YYYY-MM-DD
const getCurrentDate = () => {
  const now = new Date();
  const taiwanOffset = 8 * 60; // 台灣時區 UTC+8 的分鐘數
  const localOffset = now.getTimezoneOffset(); // 當前時區的分鐘數
  const taiwanTime = new Date(now.getTime() + (taiwanOffset - localOffset) * 60 * 1000);
  return taiwanTime.toISOString().split('T')[0];
};

// 解密中間件
const handleDecryptionMiddleware = async (req, res, next) => {
  try {
    const result = await handleDecryption(req, res);

    if (result.error) {
      console.error('解密失敗:', result.error);
      // 渲染一個錯誤頁面，而不是直接返回 400 錯誤
      return res.render('error', { message: '無法處理解密數據，請重試' });
    }

    // 保存解密結果到 res.locals，供後續路由使用
    res.locals.contactId = result.ContactId;
    res.locals.query = result.Query;

    next(); // 繼續處理下一個路由

  } catch (err) {
    console.error('中間件錯誤:', err.message);
    res.render('error', { message: '伺服器錯誤，請稍後再試' });
  }
};
// 將中間件應用於該 router 的所有路由
// router.use(handleDecryptionMiddleware);

//router.use(['/task-today', '/task/:day','/task-list'], handleDecryptionMiddleware);


// 根據當前日期跳轉到今日任務
router.get('/task-today', handleDecryptionMiddleware, async (req, res) => {
  const currentDate = getCurrentDate();

  try {
    // 查找當前日期的任務
    const query = `
      SELECT * 
      FROM ${TASKS_TABLE}
      WHERE TaskDate = @currentDate
    `;
    const pool = await sql.connect();
    const result = await pool.request()
      .input('currentDate', sql.Date, currentDate) // 使用參數化處理日期
      .query(query);
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
  router.get(`/task/${day}`, handleDecryptionMiddleware, async (req, res) => {
    console.log(`[INFO] 獲取 ContactId: ${req.session.ContactId}`);
    const currentDate = new Date().toISOString().split('T')[0];
    const userId = req.session.ContactId;
    console.log(`[INFO] 獲取 UserId: ${userId}`);
    try {
      console.log(`[INFO] 獲取任務: ${day}`);
      const task = await getTask(day);  // 獲取任務
      console.log(`[INFO] 獲取任務: ${JSON.stringify(task)}`);
      console.log(`[INFO] 獲取任務日期: ${JSON.stringify(task.TaskDate)}`);


      // 新增邏輯：檢查 User 的 Chain 與 Task 的 Chain 是否匹配
      const chainQuery = `
        SELECT Chain 
        FROM ${USERS_TABLE}
        WHERE UserID = @userId;
        `;
      const pool = await sql.connect();
      const userChainResult = await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .query(chainQuery);

      if (!userChainResult.recordset.length) {
        console.error('[ERROR] 用戶未找到，無法比對 Chain');
        return res.render('error', {
          message: '用戶不存在',
        });
      }

      const userChain = userChainResult.recordset[0].Chain;
      const taskChain = task.Chain; // 假設任務資料中包含 Chain 欄位
      console.log(`[INFO] User Chain: ${userChain}, Task Chain: ${taskChain}`);

      if (userChain !== taskChain) {
        console.warn(`[WARNING] User 的 Chain 與 Task 的 Chain 不匹配`);
        return res.render('error', {
          message: '您無權訪問此任務',
        });
      }




      // 新增邏輯：檢查活動是否尚未開始
      if (currentDate < task.TaskDate) {
        return res.render('error', {
          message: '活動尚未開始',
          taskName: task.TaskName,
          taskDate: task.TaskDate
        });
      }
      // 檢查任務是否已完成
      const query = `
       SELECT * 
       FROM ${USER_TASK_COMPLETION_TABLE}
       WHERE UserID = @userId AND TaskID = @taskId AND IsCompleted = 1
     `;
      const completionResult = await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('taskId', sql.Int, day)
        .query(query);

      const isCompleted = completionResult.recordset.length > 0;
      console.log(`Completion count: ${JSON.stringify(completionResult.recordset.length)}`);
      console.log(`IsCompleted: ${JSON.stringify(isCompleted)}`);
      console.log(`Task: ${JSON.stringify(completionResult)}`);
      res.render(`task-${day}`, {
        task, currentDate, isCompleted,
        contactId: res.locals.contactId,
        query: res.locals.query
      });
    } catch (err) {
      console.error('[ERROR] Failed to load task:', err.message);
      res.status(500).send('Database error');
    }
  });

  // 任務完成邏輯
  router.post(`/task/${day}/complete`, async (req, res) => {
    const currentDate = new Date().toISOString().split('T')[0];
    const { UserId } = req.body; // 從請求中提取 UserId
    console.log('Request Body:', req.body);

    if (!UserId) {
      return res.status(400).send('缺少 UserId');
    }
    try {
      const task = await getTask(day);  // 獲取任務
      // 獲取用戶資料
      const userQuery = `
                        SELECT * 
                        FROM ${USERS_TABLE}
                        WHERE UserID = @userId
                      `;
      const pool = await sql.connect();
      const userResult = await pool.request()
        .input('userId', sql.VarChar(36), UserId)
        .query(userQuery);
      console.log('wwww', userResult);
      if (userResult.recordset.length === 0) {
        return res.status(404).send({ error: '用戶未找到' });
      }

      // 獲取 user 的資料
      const user = userResult.recordset[0];

      // 檢查 user.tasksCompleted 是否為有效的 JSON 字符串，否則初始化為空陣列
      const tasksCompleted = JSON.parse(user.tasksCompleted || '[]');
      console.log(tasksCompleted);

      // 特殊邏輯處理：day = 15 時檢查所有任務是否完成
      if (day === 15) {
        const allTasksQuery = `
            SELECT TaskID 
            FROM ${TASKS_TABLE}
        `;
        const allTasksResult = await pool.request().query(allTasksQuery);
        const allTasks = allTasksResult.recordset.map(task => task.TaskID);

        // 檢查是否所有任務都已完成
        const hasCompletedAllTasks = allTasks.every(taskId => tasksCompleted.includes(taskId));

        if (!hasCompletedAllTasks) {
          return res.status(400).send({
            message: '您尚未完成所有任務，請確保完成後再來提交！',
            remainingTasks: allTasks.filter(taskId => !tasksCompleted.includes(taskId)) // 返回未完成的任務 ID
          });
        }
      }
      // 確認任務是否已經完成
      const completionQuery = `
                              SELECT * 
                              FROM ${USER_TASK_COMPLETION_TABLE}
                              WHERE UserID = @userId AND TaskID = @taskId AND IsCompleted = 1
                            `;
      const completionResult = await pool.request()
        .input('userId', sql.VarChar(36), UserId)
        .input('taskId', sql.Int, day)
        .query(completionQuery);

      console.log(completionResult)
      if (completionResult.recordset.length > 0) {
        return res.status(400).send({ error: '任務已完成' });
      }

      // 只比對到日期部分
      const taskDate = task.TaskDate
      if (taskDate === currentDate) {
        // 記錄任務完成
        const insertCompletionQuery = `
        INSERT INTO ${USER_TASK_COMPLETION_TABLE} (UserID, TaskID, CompletionDate, IsCompleted)
        VALUES (@userId, @taskId, @completionDate, 1)
      `;
        await pool.request()
          .input('userId', sql.VarChar(36), UserId)
          .input('taskId', sql.Int, day)
          .input('completionDate', sql.Date, currentDate)
          .query(insertCompletionQuery);
        // 更新使用者的任務完成情況和獎勵
        tasksCompleted.push(day);
        const rewards = user.rewards + task.RewardAmount;

        const updateUserQuery = `
        UPDATE ${USERS_TABLE}
        SET tasksCompleted = @tasksCompleted, rewards = @rewards
        WHERE UserID = @userId
      `;
        await pool.request()
          .input('userId', sql.VarChar(36), UserId)
          .input('tasksCompleted', sql.NVarChar, JSON.stringify(tasksCompleted))
          .input('rewards', sql.Int, rewards)
          .query(updateUserQuery); console.log(task);
        // 返回成功消息和獎勵金
        return res.json({ message: '恭喜你完成任務', reward: task.RewardAmount });
      } else {
        return res.status(400).send({ error: '非今日任務' });
      }
    } catch (err) {
      console.error(err); // 輸出錯誤信息到控制台
      res.status(500).send({ error: 'Database error', message: err.message }); // 顯示詳細錯誤信息
    }
  });
}

// 通用函數：獲取任務
async function getTask(day) {
  const query = `
    SELECT * 
    FROM ${TASKS_TABLE} 
    WHERE TaskID = @taskId
  `;

  try {
    const pool = await sql.connect();
    const taskResult = await pool.request()
      .input('taskId', sql.Int, day) // 使用參數化處理 TaskID
      .query(query);

    if (taskResult.recordset.length === 0) {
      console.error('[ERROR] Task not found for TaskID:', day);
      throw new Error('Task not found');
    }

    const task = taskResult.recordset[0];
    // 將 TaskDate 格式化為 YYYY-MM-DD
    task.TaskDate = task.TaskDate.toISOString().split('T')[0];

    return task;
  } catch (err) {
    console.error('[ERROR] 無法獲取任務:', err.message);
    throw err;
  }



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
router.get('/task-list', handleDecryptionMiddleware, async (req, res) => {
  try {
    const currentDate = new Date().toISOString().split('T')[0];

    // 獲取任務數據，包括 TaskName
    const taskQuery = `
      SELECT TaskID, TaskName, TaskDate 
      FROM ${TASKS_TABLE}
      ORDER BY TaskDate ASC
    `;
    const pool = await sql.connect();
    const taskResult = await pool.request().query(taskQuery);
    const tasks = taskResult.recordset.map(task => ({
      ...task,
      DaysLeft: Math.ceil((new Date(task.TaskDate) - new Date(currentDate)) / (1000 * 60 * 60 * 24))
    }));

    // 獲取用戶數據
    const userQuery = `
      SELECT * 
      FROM ${USERS_TABLE} 
      WHERE UserID = @userId
    `;
    const userResult = await pool.request()
      .input('userId', sql.VarChar(36), req.session.ContactId)
      .query(userQuery);
    const user = userResult.recordset[0];
    user.tasksCompleted = JSON.parse(user.tasksCompleted || '[]');

    res.render('task-list', { tasks, user, currentDate });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Database error');
  }
});

module.exports = router;
