const sql = require('mssql');
const csv = require('csv-parser');
const fs = require('fs');

const importSurveyRewards = async (req, res) => {
  if (!req.file || !req.file.path) {
    return res.status(400).send({ error: '未找到上傳的文件，請選擇 CSV 後再試' });
  }

  const filePath = req.file.path;

  try {
    const pool = await sql.connect();
    const importedIds = [];
    const existingIds = new Set();
    const newIds = [];
    let unchangedCount = 0;

    // 讀取 CSV 文件
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          console.log('解析的行:', row); // 檢查每行的結構
          console.log('所有欄位名稱:', Object.keys(row)); // 檢查是否有 "Id" 鍵
          const idField = row['\uFEFFId'] || row.Id; // 支援 BOM 頭或正常 Id
          if (idField) {
            importedIds.push(idField.trim());
            console.log(`[INFO] 匯入的 Id 列表:`, importedIds);
          }

        })
        .on('end', resolve)
        .on('error', reject);
    });

    // 查詢現有 UserSurveyRewards 的 UserID
    const query = `
      SELECT UserID
      FROM UserSurveyRewards
    `;
    const existingRecords = await pool.request().query(query);
    existingRecords.recordset.forEach((record) => existingIds.add(record.UserID));

    // 比對匯入的資料
    for (const id of importedIds) {
      if (existingIds.has(id)) {
        unchangedCount++;
      } else {
        newIds.push(id);
        const insertQuery = `
          INSERT INTO UserSurveyRewards (UserID, surveyRewardGiven)
          VALUES (@userId, 0)
        `;
        await pool.request().input('userId', sql.VarChar(36), id).query(insertQuery);
      }
    }

    // 返回處理結果
    res.json({
      totalImported: importedIds.length,
      newAdded: newIds.length,
      unchanged: unchangedCount,
    });

    // 刪除臨時文件
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error('[ERROR] 匯入 UserSurveyRewards 失敗:', error);
    res.status(500).send({ error: '無法處理 CSV 文件' });
  }
};

module.exports = { importSurveyRewards };