require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { getDatabaseConfig } = require('./lib/database-config');

const pool = new Pool(getDatabaseConfig());

// Erros de clientes ociosos precisam de listener; nunca imprima a URL ou senha.
pool.on('error', () => console.error('Uma conexão ociosa com o banco foi encerrada.'));

module.exports = pool;
