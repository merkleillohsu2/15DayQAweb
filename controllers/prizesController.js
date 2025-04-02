const { sql, connectDB } = require('../dbconfig');
const { DateTime } = require('luxon');

require('dotenv').config();
// 動態配置表名稱
const PRIZES_TABLE = process.env.PRIZES_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

const today = DateTime.now().toFormat('yyyy-MM-dd');

// 獲取指定日期的得獎公告


// 獲取所有 Prize 的資料
exports.getAllPrizes = async (req, res) => {
  try {
    const pool = await sql.connect();

    // 查詢 Prizes 和 Users 資料表
    const query = `
      SELECT 
        p.ClaimedDate AS PrizeDate,
        u.UserName,
        u.PhoneNumber
      FROM 
        ${PRIZES_TABLE} p
      LEFT JOIN 
        ${USERS_TABLE} u
      ON 
        p.ClaimedByUserID = u.UserID
      WHERE 
        p.IsClaimed = 1
      ORDER BY 
        p.ClaimedDate DESC;
    `;

    const result = await pool.request().query(query);

    if (result.recordset.length > 0) {
      // 分組數據
      // 格式化 PrizeDate 為 YYYY-MM-DD
      const formattedResult = result.recordset.map(item => ({
        PrizeDate: new Date(item.PrizeDate).toISOString().split('T')[0], // 格式化日期
        UserName: item.UserName,
        PhoneNumber: item.PhoneNumber,
      }));

      res.status(200).json({
        totalRecords: formattedResult.length,
        prizesByDate: formattedResult.reduce((acc, prize) => {
          if (!acc[prize.PrizeDate]) {
            acc[prize.PrizeDate] = [];
          }
          acc[prize.PrizeDate].push({
            UserName: prize.UserName,
            PhoneNumber: prize.PhoneNumber,
          });
          return acc;
        }, {}),
      });
    } else {
      res.status(404).json({ message: `目前無人獲獎.` });
    }
  } catch (error) {
    console.error(`Error querying table ${PRIZES_TABLE}:`, error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
