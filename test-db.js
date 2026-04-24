import { Pool } from 'pg';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'viva123', // Senha fornecida pelo usuário
  database: 'postgres'
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Erro de conexão:', err.message);
    return;
  }
  console.log('Conectado ao PostgreSQL!');

  client.query('SELECT 1;', (err, result) => {
    release();
    if (err) {
      console.error('Erro na query:', err.message);
    } else {
      console.log('Query executada com sucesso:', result.rows);
    }
    pool.end();
  });
});
