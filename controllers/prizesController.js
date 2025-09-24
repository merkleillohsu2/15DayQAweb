const { sql, connectDB } = require('../dbconfig');
const { DateTime } = require('luxon');

require('dotenv').config();
// 動態配置表名稱
const PRIZES_TABLE = process.env.PRIZES_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const TASKS_TABLE = process.env.TASKS_TABLE;
// 獲取指定日期的得獎公告


// 獲取所有 Prize 的資料
exports.getAllPrizes = async (req, res) => {
  try {
    const pool = await sql.connect();

    const query = `
      SELECT 
        p.ClaimedDate AS PrizeDate,
        t.TaskName,
        u.UserName,
        u.AccountName
      FROM ${PRIZES_TABLE} p
      LEFT JOIN ${USERS_TABLE} u ON p.ClaimedByUserID = u.UserID
      LEFT JOIN ${TASKS_TABLE} t ON p.TaskID = t.TaskID
      WHERE p.IsClaimed = 1
      ORDER BY p.ClaimedDate DESC;
    `;

    const result = await pool.request().query(query);
    console.log('Prizes query result:', result);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: '目前無人獲獎。' });
    }

    // ✅ 台灣時間處理
    const taiwanNow = DateTime.now().setZone('Asia/Taipei');
    console.log('Taiwan time:', taiwanNow.toFormat('yyyy-MM-dd HH:mm:ss'));

    // ✅ 找出本週三與下週三
    const currentWednesday = taiwanNow.minus({ days: (taiwanNow.weekday + 4) % 7 }).startOf('day');
    const nextWednesday = currentWednesday.plus({ days: 7 }).startOf('day');

    // ✅ 過濾可顯示的獎項
    const visiblePrizes = result.recordset.filter(item => {
      const claimedDate = DateTime.fromJSDate(item.PrizeDate).setZone('Asia/Taipei');
      return claimedDate < currentWednesday || claimedDate >= nextWednesday;
    });

    // ✅ 格式化資料
    const formattedResult = visiblePrizes.map(item => ({
      PrizeDate: DateTime.fromJSDate(item.PrizeDate).setZone('Asia/Taipei').toISODate(),
      TaskName: item.TaskName,
      UserName: item.UserName,
      AccountName: item.AccountName
    }));

    // ✅ 分組依據 TaskName
    const prizesByTask = formattedResult.reduce((acc, prize) => {
      if (!acc[prize.TaskName]) {
        acc[prize.TaskName] = [];
      }
      acc[prize.TaskName].push({
        PrizeDate: prize.PrizeDate,
        UserName: prize.UserName,
        AccountName: prize.AccountName
      });
      return acc;
    }, {});

    res.status(200).json({
      totalRecords: formattedResult.length,
      prizesByTask
    });

  } catch (error) {
    console.error(`Error querying prizes:`, error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
