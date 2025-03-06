require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true
  }
};
if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_SERVER || !process.env.DB_DATABASE) {
  throw new Error('Missing database environment variables');
}

async function connectDB(retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await sql.connect(config);
      console.log('Connected to Azure SQL Database');
      break;
    } catch (err) {
      console.error(`Database connection failed (attempt ${i + 1}):`, err.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        console.error('Failed to connect to database after multiple attempts');
      }
    }
  }
}
process.on('SIGINT', async () => {
  await sql.close();
  console.log('Database connection closed');
  process.exit(0);
});

module.exports = {
  sql,      // 導出 mssql 模塊
  connectDB, // 導出數據庫連接函數
  config,    // 導出配置對象
};
