const { sql } = require('../dbconfig');

exports.previewTable = async (req, res) => {
  const tableName = req.query.table;

  if (!tableName) {
    return res.status(400).send('必須指定資料表名稱');
  }

  try {
    // 查詢資料表內容
    const result = await sql.query(`SELECT * FROM ${tableName}`);
    const rows = result.recordset.map(row => Object.values(row)); // 每一行資料
    const columns = Object.keys(result.recordset[0] || {}); // 欄位名稱

    // 渲染 EJS 頁面，傳遞資料
    res.render('preview-data', { columns, rows });
  } catch (err) {
    console.error('預覽資料表失敗:', err.message);
    res.status(500).send('無法預覽資料表');
  }
};
exports.previewTableData = async (req, res) => {
    const tableName = req.query.table;
  
    if (!tableName) {
      return res.status(400).json({ error: '必須指定資料表名稱' });
    }
  
    try {
      // 查詢資料表內容（限制 100 筆）
      const result = await sql.query(`SELECT TOP 100 * FROM ${tableName}`);
      const rows = result.recordset.map(row => Object.values(row)); // 每行的資料
      const columns = Object.keys(result.recordset[0] || {}); // 欄位名稱
  
      // 返回 JSON 格式
      res.json({ columns, rows });
    } catch (err) {
      console.error('預覽資料表失敗:', err.message);
      res.status(500).json({ error: '無法預覽資料表' });
    }
  };
  
  