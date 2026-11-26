const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 2 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: process.env.VERCEL ? 10000 : 2000,
  statement_timeout: 15000,
  query_timeout: 20000,
  ssl: process.env.VERCEL ? { rejectUnauthorized: false } : undefined,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar no PostgreSQL:', err.message);
    console.error('   Verifique DATABASE_URL no arquivo .env');
    return;
  }
  console.log('✅ PostgreSQL conectado com sucesso!');
  release();
});

module.exports = pool;
