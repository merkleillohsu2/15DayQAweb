const { sql } = require('../dbconfig');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config();

// 確保列出的表是環境變數或硬編碼的固定白名單
const ALLOWED_TABLES = [
  process.env.USERS_TABLE || 'Users',
  process.env.REWARDS_TABLE || 'UserSurveyRewards',
  process.env.TASKS_TABLE || 'Tasks',
  process.env.USER_TASK_COMPLETION_TABLE || 'UserTaskCompletion',
  process.env.PRIZES_TABLE || 'Prizes',
  process.env.USER_LOTTERY_ENTRIES_TABLE || 'UserLotteryEntries',
  process.env.CONFIGURATION_SETTINGS_TABLE || 'ConfigurationSettings',
  process.env.TIME_BASED_PROBABILITY_TABLE || 'TimeBasedProbability',
];

// 獲取資料表清單
exports.getTables = async (req, res) => {
  try {
    const result = await sql.query`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;
      // 過濾僅包含指定的表名
      const tables = result.recordset
      .map(row => row.TABLE_NAME)
      .filter(table => ALLOWED_TABLES.includes(table)); // 過濾出白名單中的表
    res.json({ tables }); // 返回過濾後的資料表清單
  } catch (err) {
    console.error('獲取資料表清單失敗:', err.message);
    res.status(500).json({ error: '無法獲取資料表清單' });
  }
};

// 匯出指定資料表為 CSV
exports.exportTableAsCsv = async (req, res) => {
  const tableName = req.query.table;

  if (!tableName) {
    return res.status(400).send('必須指定資料表名稱');
  }

  try {
    const result = await sql.query(`SELECT * FROM ${tableName}`);
    const data = result.recordset;

    if (data.length === 0) {
      return res.status(404).send('資料表無內容');
    }

    // 定義 CSV 文件名稱和欄位
    const filePath = path.join(__dirname, `${tableName}.csv`);
    const csvWriter = createCsvWriter({
      path: filePath,
      header: Object.keys(data[0]).map(key => ({ id: key, title: key })),
    });

    // 寫入資料到 CSV
    await csvWriter.writeRecords(data);

    // 提供下載
    res.download(filePath, `${tableName}.csv`, err => {
      if (err) {
        console.error('下載失敗:', err.message);
      }
      fs.unlinkSync(filePath); // 刪除臨時文件
    });
  } catch (err) {
    console.error('匯出 CSV 失敗:', err.message);
    res.status(500).send('無法匯出資料表');
  }
};

// 匯出所有資料表為 CSV 壓縮檔
exports.exportAllTablesAsCsv = async (req, res) => {
  const archiver = require('archiver');
  const output = fs.createWriteStream(path.join(__dirname, 'all-tables.zip'));
  const archive = archiver('zip', { zlib: { level: 9 } });

  try {
    const result = await sql.query`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;
    const tables = result.recordset.map(row => row.TABLE_NAME);

    archive.pipe(output);

    for (const table of tables) {
      const tableData = await sql.query(`SELECT * FROM ${table}`);
      const csvContent = tableData.recordset.map(row =>
        Object.values(row).join(',')
      ).join('\n');
      archive.append(csvContent, { name: `${table}.csv` });
    }

    archive.finalize();

    output.on('close', () => {
      res.download(path.join(__dirname, 'all-tables.zip'), 'all-tables.zip', err => {
        if (err) {
          console.error('下載失敗:', err.message);
        }
        fs.unlinkSync(path.join(__dirname, 'all-tables.zip'));
      });
    });
  } catch (err) {
    console.error('匯出所有資料表失敗:', err.message);
    res.status(500).send('無法匯出所有資料表');
  }
};