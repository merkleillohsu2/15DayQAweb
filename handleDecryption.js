const crypto = require('crypto');
const { decryptString } = require('./userSetup'); // 導入 decryptString 函數
const { config, sql } = require('./dbconfig');
const { DateTime } = require('luxon');

require('dotenv').config();

const USERS_TABLE = process.env.USERS_TABLE
const REWARDS_TABLE = process.env.REWARDS_TABLE
const USER_TASK_COMPLETION_TABLE = process.env.USER_TASK_COMPLETION_TABLE

const getTransformedName = (lastName, firstName) => {
  // 判斷是否為英文名字（簡單判斷英文字母開頭）
  const isEnglishName = /^[A-Za-z]/.test(lastName);

  if (isEnglishName) {
    // 英文名字：保留首字母，其餘替換為 X
    const transformedLastName = lastName.charAt(0) + 'O'.repeat(lastName.length - 1);
    const transformedFirstName = firstName.charAt(0) + 'O'.repeat(firstName.length - 1);
    return `${transformedLastName} ${transformedFirstName}`;
  } else {
    // 中文名字：替換第二個字為 X
    const userName = lastName + firstName;
    return userName.replace(/(\S)(\S)(\S+)/, '$1O$3');
  }
};

// 處理電話號碼轉換的邏輯
const transformPhoneNumber = (phone) => {
  if (phone.startsWith("+886")) {
    // 將 "+886" 替換為 "0"
    const localPhone = phone.replace("+886", "0");
    // 切割電話號碼
    const prefix = localPhone.slice(0, 4); // 前 4 位
    const suffix = localPhone.slice(-2); // 後 2 位
    // 拼接隱藏的電話號碼
    return `${prefix}OOOO${suffix}`;
  }
  // 若非 "+886" 開頭，直接返回原始電話號碼
  return phone;
};

const handleDecryption = async (req, res) => {
  const urlquery = req.query.query;

  if (!urlquery) {
    console.error('[ERROR] 缺少 query 參數，請求失敗');
    return { error: 'Missing query parameter in request' };
  }

  if (!req.session) {
    console.error('[ERROR] 會話未初始化，無法存儲 ContactId');
    return { error: 'Session not initialized. Check express-session configuration.' };
  }

  try {
    console.log('[INFO] 解密前的字符串:', urlquery);
    const decryptedData = decryptString(decodeURIComponent(urlquery));
    console.log('[INFO] 解密後的數據:', decryptedData);

    const parsedData = JSON.parse(decryptedData);
    const userId = parsedData.User.ContactId;
    const userName = getTransformedName(parsedData.User.LastName, parsedData.User.FirstName);
    // 判斷 MobilePhone 是否為空值，若是則使用 Phone
    const phoneNumber = parsedData.User.Contact.MobilePhone
      ? transformPhoneNumber(parsedData.User.Contact.MobilePhone)
      : (parsedData.User.Contact.Phone
        ? transformPhoneNumber(parsedData.User.Contact.Phone)
        : null); // 如果兩者都不存在，返回 null

    console.log('[INFO] 處理後的電話號碼:', phoneNumber);
    const chain = parsedData.User.Contact.Account.DTE_Chain__c || null; // 提取 Chain 值


    // ✅ 新增：取得 AccountName
    const accountName = parsedData.User.Contact.Account.Name || null;


    if (!parsedData || !parsedData.User || !parsedData.User.ContactId) {
      console.error('[ERROR] 無效的解密數據，缺少 User、ContactId');
      return { error: 'Invalid decrypted data: missing User, ContactId' };
    }
    if (!userId) {
      console.error('[ERROR] 未找到 ContactId');
      return res.status(400).send('ContactId not found in decrypted data');
    }
    req.session.ContactId = userId;

    console.log('[INFO] UserId to store:', userId);
    console.log('[INFO] PhoneNumber to store:', phoneNumber);


    // 連接數據庫
    try {
      await sql.connect(config);
    } catch (err) {
      console.error('[ERROR] 數據庫連接失敗:', err.message);
      return { error: 'Database connection failed', details: err.message };
    }
    // 獲取台灣時間，並轉換為 UTC 時間
    // const lastLoginTime = DateTime.now().setZone('Asia/Taipei').toISO();
    const lastLoginTime = DateTime.now().setZone('Asia/Taipei').toISO({ includeOffset: true });


    console.log('[INFO] LastLoginTime to store (UTC):', lastLoginTime);

    // 單一查詢：檢查用戶是否存在並獲取獎勵狀態
    const combinedQuery = `
       SELECT 
        u.UserID, 
        u.LastLoginTime, 
        u.PhoneNumber, 
        r.surveyRewardGiven,
        T.IsCompleted
      FROM ${USERS_TABLE} u
      LEFT JOIN ${REWARDS_TABLE} r ON u.UserID = r.UserID
      Left JOIN (
          SELECT UserID, TaskID, CompletionDate, IsCompleted
          FROM ${USER_TASK_COMPLETION_TABLE}
          WHERE IsCompleted = 1
      ) T ON T.UserID = u.UserID
      WHERE u.UserID = @userId;
    `;
    const pool = await sql.connect();
    const result = await pool.request()
      .input('userId', sql.VarChar(36), userId)
      .query(combinedQuery);
    const userRecord = result.recordset[0];
    console.log('[INFO] 查詢結果:', userRecord);
    if (userRecord) {
      console.log('[INFO] User 已存在，更新 LastLoginTime 和 PhoneNumber');
      // 更新 LastLoginTime 和 PhoneNumber
      const updateQuery = `
      UPDATE ${USERS_TABLE}
      SET LastLoginTime = @lastLoginTime, PhoneNumber = @phoneNumber , Chain = @chain , AccountName = @accountName
      WHERE UserID = @userId;
    `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('lastLoginTime', sql.DateTimeOffset, lastLoginTime)
        .input('phoneNumber', sql.NVarChar(15), phoneNumber)
        .input('chain', sql.NVarChar(10), chain)
        .input('accountName', sql.NVarChar(255), accountName)
        .query(updateQuery);
    } else {
      console.log('[INFO] User 不存在，創建新記錄');
      // 插入新用戶
      const insertQuery = `
        INSERT INTO ${USERS_TABLE} (UserID, UserName, PhoneNumber, Chain, LastLoginTime, tasksCompleted, rewards, AccountName)
        VALUES (@userId, @userName, @phoneNumber, @chain, @lastLoginTime, '[]', 0, @accountName);
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .input('userName', sql.NVarChar(255), userName)
        .input('phoneNumber', sql.NVarChar(15), phoneNumber)
        .input('chain', sql.NVarChar(10), chain)
        .input('lastLoginTime', sql.DateTimeOffset, lastLoginTime)
        .input('accountName', sql.NVarChar(255), accountName)
        .query(insertQuery);
    }
    console.log('[INFO] 用戶記錄已更新或創建成功');
    // 檢查是否需要發放獎勵
    if (userRecord && userRecord.surveyRewardGiven === false && userRecord.IsCompleted) {
      console.log('[INFO] 發放獎勵中...');
      const updateRewardsQuery = `
        UPDATE ${USERS_TABLE}
        SET rewards = rewards + 10
        WHERE UserID = @userId;
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .query(updateRewardsQuery);

      const updateSurveyQuery = `
        UPDATE ${REWARDS_TABLE}
        SET surveyRewardGiven = 1
        WHERE UserID = @userId;
      `;
      await pool.request()
        .input('userId', sql.VarChar(36), userId)
        .query(updateSurveyQuery);
      console.log('[INFO] 獎勵已發放');
    }
    return { success: true, ContactId: userId, Query: urlquery };
  } catch (err) {
    console.error('[ERROR] 解密或存儲失敗:', err.message);
    return { error: `Failed to decrypt or store the string: ${err.message}` };
  }
};

// 將 handleDecryption 函數作為命名導出
module.exports = { handleDecryption };
