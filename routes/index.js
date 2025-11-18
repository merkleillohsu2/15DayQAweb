const express = require('express');
const router = express.Router();
const { sql } = require('../dbconfig');
const { decryptString } = require('../userSetup'); // 導入 decryptString 函數
const { handleDecryption } = require('../handleDecryption'); // 導入 decryptString 函數
const { DateTime } = require('luxon');

require('dotenv').config(); // 加載環境變數

// 導入表名環境變數
const TASKS_TABLE = process.env.TASKS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const USER_TASK_COMPLETION_TABLE = process.env.USER_TASK_COMPLETION_TABLE;
const REWARDS_TABLE = process.env.REWARDS_TABLE;
const USER_LOTTERY_ENTRIES_TABLE = process.env.USER_LOTTERY_ENTRIES_TABLE;
const LOTTERY_RULES_TABLE = process.env.LOTTERY_RULES_TABLE;
const CONFIGURATION_SETTINGS_TABLE = process.env.CONFIGURATION_SETTINGS_TABLE;


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
      return res.render('error', {
        message: '無法處理解密數據，請重試',
        errorDetails: null
      });
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
  const currentDate = getCurrentDate(); // yyyy-mm-dd 格式字串

  try {
    const pool = await sql.connect();
    const userId = req.session.ContactId;
    const chain = req.session.Chain;
    console.log(`[INFO] 獲取 UserId: ${userId}, Chain: ${chain}`);

    // 查找今天正在進行的任務（StartDate <= currentDate <= EndDate）
    const query = `
      SELECT TOP 1 t.*
        FROM ${TASKS_TABLE} t
        LEFT JOIN ${USER_TASK_COMPLETION_TABLE} utc
          ON t.TaskID = utc.TaskID AND utc.UserID = @userId
        WHERE @currentDate BETWEEN t.StartDate AND t.EndDate
          AND t.Chain = @chain
          AND ISNULL(utc.IsCompleted, 0) = 0
        ORDER BY t.StartDate ASC
    `;

    const result = await pool.request()
        .input('currentDate', sql.Date, currentDate)
        .input('chain', sql.NVarChar(10), chain)
        .input('userId', sql.VarChar(36), userId)
        .query(query);  


    const task = result.recordset[0];
    console.log(`[INFO] 今日任務:`, task);
    if (task) {
      const queryParams = new URLSearchParams(req.query).toString();
      const redirectUrl = queryParams
        ? `/task/${task.TaskID}?${queryParams}`
        : `/task/${task.TaskID}`;
      res.redirect(redirectUrl);
    } else {
      res.status(404).send('今日無進行中的任務');
    }
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).render('error', {
      message: '載入任務時發生錯誤，請稍後再試或聯繫支援人員。',
      errorDetails: {
        name: err.name,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : null
      }
    });
  }
});

// 每日任務頁面
for (let day = 1; day <= 15; day++) {
  router.get(`/task/${day}`, handleDecryptionMiddleware, async (req, res) => {
    const currentDate = getCurrentDate();// yyyy-mm-dd
    console.log(`[INFO] 當前日期: ${currentDate}`);
    const userId = req.session.ContactId;
    console.log(`[INFO] 獲取 UserId: ${userId}`);

    try {
      const pool = await sql.connect();
      const task = await getTask(day); // 取得任務資料（含 StartDate / EndDate）
      console.log(`[INFO] 獲取 Task 資料:`, task);
      // 驗證使用者 Chain 是否符合任務 Chain
      const userChain = await getUserChain(pool, userId);
      console.log(`[INFO] 用戶 Chain: ${userChain}, 任務 Chain: ${task.Chain}`);
      if (!userChain) {
        return res.render('error', {
          message: '用戶不存在，請重新登入後重試',
          errorDetails: null
        });
      }
      if (userChain !== task.Chain) {
        return res.render('error', {
          message: '您無權訪問此任務，請聯繫支援人員',
          errorDetails: null
        });
      }

      // 判斷任務狀態
      const startDateStr = task.StartDate;
      const endDateStr = task.EndDate;
      let status = '';

      if (currentDate < startDateStr) {
        status = '未開始';
      } else if (currentDate > endDateStr) {
        status = '已結束';
      } else {
        status = '進行中';
      }

      if (status === '未開始') {
        return res.render('error', {
          message: '任務尚未開始，請稍後再來！',
          errorDetails: null
        });
      }
      // 查詢任務完成狀態
      const isCompleted = await isTaskCompleted(pool, userId, day);
      console.log(`[INFO] 任務完成狀態: ${isCompleted}`);
      // 查詢是否已抽過該任務的獎
      const chances = await getRemainingLotteryChances(pool, userId);
      console.log(`[INFO] 任務抽獎次數:`, chances);
      const currentChance = chances.find(c => c.taskId === day);
      const remainingEntries = currentChance?.remainingEntries || 0;
      const hasDrawnLottery = remainingEntries === 0;
      console.log(`[INFO] 任務狀態: ${status}`);
      console.log(`[INFO] 是否完成: ${isCompleted}`);
      console.log(`[INFO] 是否已抽獎: ${hasDrawnLottery}`);

      // 渲染任務頁面
      res.render(`task-${day}`, {
        task,
        currentDate,
        status,
        isCompleted,
        remainingEntries,
        hasDrawnLottery,
        lotteryRule: {
          ruleId: currentChance?.ruleId,
          ruleName: currentChance?.ruleName,
          maxEntries: currentChance?.maxEntries,
          usedEntries: currentChance?.usedEntries
        },
        contactId: res.locals.contactId,
        query: res.locals.query
      });

    } catch (err) {
      console.error('[ERROR] Failed to load task:', err.message);
      res.status(500).render('error', {
        message: '載入任務時發生錯誤，請稍後再試或聯繫支援人員。',
        errorDetails: {
          name: err.name,
          message: err.message,
          stack: process.env.NODE_ENV === 'development' ? err.stack : null
        }
      });

    }
  });

  // 任務完成邏輯
  router.post(`/task/${day}/complete`, async (req, res) => {
    const currentDate = getCurrentDate();;
    const { UserId } = req.body; // 從請求中提取 UserId

    if (!UserId) {
      return res.status(400).send('缺少 UserId');
    }
    try {
      const pool = await sql.connect();
      const task = await getTask(day);  // 獲取任務

      const startDateStr = new Date(task.StartDate).toISOString().slice(0, 10);
      const endDateStr = new Date(task.EndDate).toISOString().slice(0, 10);
      const isActive = currentDate >= startDateStr && currentDate <= endDateStr;
      const taskId = task.TaskID;
      // 獲取用戶資料
      const userQuery = `
                        SELECT * 
                        FROM ${USERS_TABLE}
                        WHERE UserID = @userId
                      `;
      const userResult = await pool.request()
        .input('userId', sql.VarChar(36), UserId)
        .query(userQuery);
      if (userResult.recordset.length === 0) {
        return res.status(404).send({ error: '用戶未找到' });
      }

      // 獲取 user 的資料
      const user = userResult.recordset[0];
      if (user.Chain !== task.Chain) {
        return res.render('error', {
          message: '您無權訪問此任務',
          errorDetails: null
        });
      }

      // 檢查 user.tasksCompleted 是否為有效的 JSON 字符串，否則初始化為空陣列
      const tasksCompleted = JSON.parse(user.tasksCompleted || '[]');
      console.log('Tasks completed by user:', { UserId, tasksCompleted });


      // 獲取 FlexAllCompleteExtraAmount 配置值
      const bonusReward = await getSettingValue(pool, 'FlexAllCompleteExtraAmount');
      if (!Number.isInteger(bonusReward)) {
        console.warn('FlexAllCompleteExtraAmount 配置值無效，使用默認值 0');
      }

      // 確認任務是否已經完成
      const completionQuery = `
                              SELECT * 
                              FROM ${USER_TASK_COMPLETION_TABLE}
                              WHERE UserID = @userId AND TaskID = @taskId AND IsCompleted = 1
                            `;
      const completionResult = await pool.request()
        .input('userId', sql.VarChar(36), UserId)
        .input('taskId', sql.Int, taskId)
        .query(completionQuery);

      if (completionResult.recordset.length > 0) {
        return res.status(400).send({ error: '任務已完成' });
      }

      // 只比對到日期部分
      console.log('StartDate:', startDateStr);
      console.log('EndDate:', endDateStr);
      console.log('CurrentDate:', currentDate);

      // 檢查任務日期是否為今天
      if (isActive) {
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
        await updateUserRewards(pool, UserId, tasksCompleted, rewards);





        // 新增檢查 UserSurveyRewards 是否有未派送獎勵的邏輯
        const surveyRewardsQuery = `
                                    SELECT surveyRewardGiven
                                    FROM ${REWARDS_TABLE}
                                    WHERE UserID = @userId AND surveyRewardGiven = 0
                                  `;
        const surveyRewardsResult = await pool.request()
          .input('userId', sql.VarChar(36), UserId)
          .query(surveyRewardsQuery);

        if (surveyRewardsResult.recordset.length > 0) {
          console.log('[INFO] 發放額外獎勵中...');

          // 更新 UserSurveyRewards 狀態並增加用戶獎勵
          const extraReward = 10; // 額外獎勵金額
          const updateRewardsQuery = `
                                        UPDATE ${USERS_TABLE}
                                        SET rewards = rewards + @extraReward
                                        WHERE UserID = @userId
                                      `;
          await pool.request()
            .input('userId', sql.VarChar(36), UserId)
            .input('extraReward', sql.Int, extraReward)
            .query(updateRewardsQuery);

          const updateSurveyQuery = `
                                      UPDATE ${REWARDS_TABLE}
                                      SET surveyRewardGiven = 1
                                      WHERE UserID = @userId
                                    `;
          await pool.request()
            .input('userId', sql.VarChar(36), UserId)
            .query(updateSurveyQuery);

          console.log('[INFO] 額外獎勵已發放');
        }

        // 特殊邏輯處理：day = 15 時檢查所有任務是否完成
        if (day === 10) {
          const allTasksQuery = `
            SELECT TaskID 
            FROM ${TASKS_TABLE} t
            JOIN ${USERS_TABLE} u ON t.Chain = u.Chain
            WHERE u.UserID = @userId

        `;
          const allTasksResult = await pool.request()
            .input('userId', sql.VarChar(36), UserId) // 傳入 userId 作為查詢參數
            .query(allTasksQuery);

          const allTasks = allTasksResult.recordset.map(task => task.TaskID);
          console.log('所有任務:', rewards);
          // 檢查是否所有任務都已完成
          const hasCompletedAllTasks = allTasks.every(taskId => tasksCompleted.includes(taskId));
          console.log('所有任務:', rewards);
          console.log('已完成的任務:', bonusReward);
          if (hasCompletedAllTasks) {
            // 所有任務完成，額外派送獎勵金
            const newRewards = rewards + bonusReward;
            await updateUserRewards(pool, UserId, tasksCompleted, newRewards);

            // 返回完成所有任務的成功消息
            return res.json({
              message: '恭喜您完成所有任務！您已獲得額外獎勵金。',
              bonusReward,
              totalRewards: newRewards
            });
          }
        }
        // 返回成功消息和獎勵金
        return res.json({ message: '恭喜你完成任務', reward: task.RewardAmount });
      } else {
        return res.status(400).send({ error: '非任務期間，無法完成任務' });
      }
    } catch (err) {
      console.error(err); // 輸出錯誤信息到控制台
      res.status(500).render('error', {
        message: '載入任務時發生錯誤，請稍後再試或聯繫支援人員。',
        errorDetails: {
          name: err.name,
          message: err.message,
          stack: process.env.NODE_ENV === 'development' ? err.stack : null
        }
      });

    }
  });
}

// 獲取用戶的 Chain
async function getUserChain(pool, userId) {
  const query = `
    SELECT Chain 
    FROM ${USERS_TABLE}
    WHERE UserID = @userId;
  `;
  const result = await pool.request()
    .input('userId', sql.VarChar(36), userId)
    .query(query);
  return result.recordset.length ? result.recordset[0].Chain : null;
}

// 檢查用戶的任務是否已完成
async function isTaskCompleted(pool, userId, taskId) {
  const query = `
    SELECT * 
    FROM ${USER_TASK_COMPLETION_TABLE}
    WHERE UserID = @userId AND TaskID = @taskId AND IsCompleted = 1;
  `;
  const result = await pool.request()
    .input('userId', sql.VarChar(36), userId)
    .input('taskId', sql.Int, taskId)
    .query(query);
  return result.recordset.length > 0;
}

async function getRemainingLotteryChances(pool, userId) {
  const query = `
    SELECT 
      t.TaskID,
      t.TaskName,
      lr.RuleID,
      lr.RuleName,
      lr.MaxEntriesPerUser,
      ISNULL(ul.Draws, 0) AS DrawsUsed
    FROM ${USER_TASK_COMPLETION_TABLE} utc
    JOIN ${TASKS_TABLE} t ON utc.TaskID = t.TaskID
    LEFT JOIN ${LOTTERY_RULES_TABLE} lr ON t.LotteryRuleID = lr.RuleID
    LEFT JOIN (
      SELECT TaskID, UserID, COUNT(*) AS Draws
      FROM ${USER_LOTTERY_ENTRIES_TABLE}
      WHERE UserID = @userId
      GROUP BY TaskID, UserID
    ) ul ON ul.TaskID = t.TaskID AND ul.UserID = @userId
    WHERE utc.UserID = @userId AND utc.IsCompleted = 1
  `;

  const result = await pool.request()
    .input('userId', sql.VarChar(36), userId)
    .query(query);

  // 整理剩餘抽獎次數
  const chances = result.recordset.map(row => ({
    taskId: row.TaskID,
    taskName: row.TaskName,
    ruleId: row.RuleID,
    ruleName: row.RuleName,
    maxEntries: row.MaxEntriesPerUser,
    usedEntries: row.DrawsUsed,
    remainingEntries: Math.max(0, row.MaxEntriesPerUser - row.DrawsUsed)
  }));

  return chances;
}


// 獲取用戶的任務完成情況和獎勵金額
async function updateUserRewards(pool, userId, tasksCompleted, rewards) {
  const query = `
    UPDATE ${USERS_TABLE}
    SET tasksCompleted = @tasksCompleted, rewards = @rewards
    WHERE UserID = @userId
  `;
  await pool.request()
    .input('userId', sql.VarChar(36), userId)
    .input('tasksCompleted', sql.NVarChar, JSON.stringify(tasksCompleted))
    .input('rewards', sql.Int, rewards)
    .query(query);
}

// 獲取配置值的通用函數
async function getSettingValue(pool, settingKey) {
  const query = `
    SELECT SettingValue
    FROM ${CONFIGURATION_SETTINGS_TABLE}
    WHERE SettingKey = @settingKey
  `;
  const result = await pool.request()
    .input('settingKey', sql.VarChar(100), settingKey)
    .query(query);

  return result.recordset.length > 0 ? parseInt(result.recordset[0].SettingValue, 10) : null;
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
      .input('taskId', sql.Int, day)
      .query(query);

    if (taskResult.recordset.length === 0) {
      console.error('[ERROR] Task not found for TaskID:', day);
      throw new Error('Task not found');
    }

    const task = taskResult.recordset[0];

    // 格式化 StartDate 和 EndDate 為 YYYY-MM-DD
    task.StartDate = new Date(task.StartDate).toISOString().slice(0, 10);
    task.EndDate = new Date(task.EndDate).toISOString().slice(0, 10);

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
  const now = new Date();
  const taiwanOffset = 8 * 60; // 台灣時區 UTC+8 的分鐘數
  const localOffset = now.getTimezoneOffset(); // 當前時區的分鐘數
  const currentDate = new Date(now.getTime() + (taiwanOffset - localOffset) * 60 * 1000);
    const userId = req.session.ContactId;
    const chain = req.session.Chain;
    if (!userId) {
      console.error('[ERROR] 缺少有效的 ContactId');
      return res.render('error', {
        message: '無效的使用者資訊，請重新登入！',
        errorDetails: null
      });
    }

    const pool = await sql.connect();
    function toDateOnly(date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    }



    // 獲取任務數據，包括 TaskName
    // 1. 查詢任務資料 + 完成狀態
    const taskQuery = `
      SELECT 
          t.TaskID,
          t.TaskName,
          t.StartDate,
          t.EndDate,
          t.LotteryRuleID,
          ISNULL(utc.IsCompleted, 0) AS IsCompleted,
          ISNULL(ule.DrawDate, NULL) AS DrawDate
        FROM ${TASKS_TABLE} t
        LEFT JOIN ${USER_TASK_COMPLETION_TABLE} utc 
          ON t.TaskID = utc.TaskID AND utc.UserID = @userId
        LEFT JOIN  ${USER_LOTTERY_ENTRIES_TABLE} ule 
          ON t.TaskID = ule.TaskID AND ule.UserID = @userId
        WHERE t.Chain = @chain
        ORDER BY t.StartDate ASC
    `;
    const taskResult = await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .input('chain', sql.NVarChar(10), chain)
      .query(taskQuery);

    const today = new Date(currentDate);
    const todayDateOnly = toDateOnly(currentDate);

    console.log(today)
    console.log(`[INFO] 今日日期: ${today.toISOString().slice(0,10)}`);
    const tasks = taskResult.recordset.map(task => {
      const startDate = toDateOnly(task.StartDate);
      const endDate = toDateOnly(task.EndDate);

      console.log(`[INFO] 處理任務 ${task.TaskID} - ${task.TaskName}: StartDate: ${startDate.toISOString().slice(0,10)}, EndDate: ${endDate.toISOString().slice(0,10)}`);
      const isCompleted = task.IsCompleted === true || task.IsCompleted === 1;
      const hasDrawn = !!task.DrawDate;
      const isActive = todayDateOnly >= startDate && todayDateOnly <= endDate;
      const hasLottery = task.LotteryRuleID !== null;

      const status = todayDateOnly < startDate
        ? '未開始'
        : todayDateOnly > endDate
          ? '已結束'
          : '進行中';

      console.log(`[INFO] 任務 ${task.TaskID} 狀態: ${status}, 完成: ${isCompleted}, 已抽獎: ${hasDrawn}, 是否有抽獎: ${hasLottery}`);
      const DaysLeft = Math.max(0, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)));
      const showDrawReminder = hasLottery && isCompleted && !hasDrawn && isActive;



      return {
        TaskID: task.TaskID,
        TaskName: task.TaskName,
        StartDate: startDate.toISOString().slice(0, 10),
        EndDate: endDate.toISOString().slice(0, 10),
        IsCompleted: isCompleted,
        HasDrawn: hasDrawn,
        IsActive: isActive,
        DaysLeft,
        status,
        ShowDrawReminder: showDrawReminder
      };
    });


    // 2. 查詢使用者資料
    const userQuery = `
      SELECT *
      FROM ${USERS_TABLE}
      WHERE UserID = @userId
    `;
    const userResult = await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .query(userQuery);

    const user = userResult.recordset[0];
    user.tasksCompleted = JSON.parse(user.tasksCompleted || '[]');

    // 3. 渲染頁面
    res.render('task-list', {
      tasks,
      user,
      currentDate
    });

  } catch (err) {
    console.error('[ERROR] 任務列表載入失敗:', err.message);
    res.status(500).render('error', {
      message: '載入任務時發生錯誤，請稍後再試或聯繫支援人員。',
      errorDetails: {
        name: err.name,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : null
      }
    });

  }

});


module.exports = router;
