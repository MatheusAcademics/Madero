const pool = require('./conexao');


(async () => {
  try {
    const res = await pool.query('SELECT * FROM usuarios;');
    console.log('Conexão bem-sucedida! Linhas encontradas:');
    console.log(res.rows);
  } catch (err) {
    console.error('Erro ao conectar ou consultar o banco:', err);
  } finally {
    pool.end(); // encerra a conexão
  }
})();
