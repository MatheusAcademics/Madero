const fs = require('node:fs/promises');
const path = require('node:path');
const catalog = require('../database/demo-catalog.json');

const marker = (product, direction) => `[DEMO:${catalog.version}:${product.key}:${direction}] `
  + (direction === 'entrada' ? 'Entrada inicial fictícia para testes.' : 'Saída fictícia para testar histórico e reposição.');
const validId = value => /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 2147483647;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000')
  && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
function dateAt(base, offset, hour) {
  const date = new Date(base + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10) + ' ' + hour + ':00:00';
}

async function checkAssets() {
  const sharp = require('sharp');
  const directory = path.join(__dirname, '..', 'public', 'img', 'demo');
  for (const product of catalog.products) {
    const filename = path.basename(product.image);
    if (product.image !== '/img/demo/' + filename) throw new Error('Imagem de demonstração fora da pasta esperada.');
    const image = await fs.readFile(path.join(directory, filename));
    const info = await sharp(image, { limitInputPixels: 50_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(info.format)) throw new Error('Foto de demonstração inválida.');
  }
}

async function seedDemo(db, { userId, date, verifyAssets = checkAssets } = {}) {
  if (!validId(userId)) throw new Error('Informe --user com o ID de um usuário existente para identificar os movimentos de teste.');
  if (!validDate(date || '')) throw new Error('Informe --date no formato AAAA-MM-DD.');
  await verifyAssets();
  const client = await db.connect();
  const report = { categoriesCreated: 0, productsCreated: 0, movementsCreated: 0, productsSkipped: 0, userId: Number(userId), products: [] };
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [1296122949]);
    const user = await client.query('SELECT id_usuario FROM usuarios WHERE id_usuario = $1 FOR KEY SHARE', [Number(userId)]);
    if (!user.rows.length) throw new Error('Usuário responsável não encontrado. Nenhum dado foi inserido.');
    const categories = new Map();
    for (const [index, product] of catalog.products.entries()) {
      // A descrição estável também reconhece exemplos renomeados pelo usuário.
      const exists = await client.query(`SELECT p.id_produto FROM produtos p
        WHERE p.nome = $1 OR EXISTS (SELECT 1 FROM movimentacoes m WHERE m.id_produto = p.id_produto AND m.descricao = $2)
        ORDER BY p.id_produto LIMIT 1`, [product.name, marker(product, 'entrada')]);
      if (exists.rows.length) { report.productsSkipped++; continue; }
      if (!categories.has(product.category)) {
        const markers = catalog.products.filter(p => p.category === product.category).map(p => marker(p, 'entrada'));
        const existing = await client.query(`SELECT c.id_categoria FROM categorias c WHERE c.nome = $1
          OR EXISTS (SELECT 1 FROM produtos p JOIN movimentacoes m ON m.id_produto = p.id_produto
            WHERE p.id_categoria = c.id_categoria AND m.descricao = ANY($2::text[]))
          ORDER BY c.id_categoria LIMIT 1`, [catalog.categories[product.category], markers]);
        if (existing.rows.length) categories.set(product.category, existing.rows[0].id_categoria);
        else {
          const created = await client.query('INSERT INTO categorias (nome) VALUES ($1) RETURNING id_categoria', [catalog.categories[product.category]]);
          categories.set(product.category, created.rows[0].id_categoria);
          report.categoriesCreated++;
        }
      }
      const stock = String(Number(product.initial) - Number(product.outgoing));
      const created = await client.query(`INSERT INTO produtos (nome, estoque, estoque_minimo, valor, imagem, id_categoria)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_produto`,
      [product.name, stock, product.minimum, product.price, product.image, categories.get(product.category)]);
      const id = created.rows[0].id_produto;
      for (const [type, direction, quantity, day, hour] of [
        ['Entrada', 'entrada', product.initial, -8 + Math.floor(index / 2), '09'],
        ['Saída', 'saida', product.outgoing, -4 + Math.floor(index / 2), '15']
      ]) {
        await client.query(`INSERT INTO movimentacoes (tipo_movimentacao, data_movimentacao, quantidade, descricao, id_produto, id_usuario)
          VALUES ($1, $2, $3, $4, $5, $6)`, [type, dateAt(date, day, hour), quantity, marker(product, direction), id, Number(userId)]);
        report.movementsCreated++;
      }
      report.productsCreated++;
      report.products.push({ id, name: product.name, stock, minimum: product.minimum, image: product.image });
    }
    await client.query('COMMIT');
    return report;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the original failure. */ }
    throw error;
  } finally { client.release(); }
}

async function main() {
  const args = process.argv.slice(2);
  const read = flag => args[args.indexOf(flag) + 1];
  if (args.length !== 4 || !args.includes('--user') || !args.includes('--date')) throw new Error('Uso: npm run demo:seed -- --user ID --date AAAA-MM-DD');
  require('dotenv').config({ quiet: true });
  const { Pool } = require('pg');
  const db = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectionTimeoutMillis: 5000 });
  try { console.log(JSON.stringify(await seedDemo(db, { userId: read('--user'), date: read('--date') }), null, 2)); }
  finally { await db.end(); }
}

if (require.main === module) main().catch(error => {
  console.error(error.code ? 'Carga de demonstração interrompida (' + error.code + '). Nenhum dado anterior foi alterado.' : error.message);
  process.exitCode = 1;
});
module.exports = { seedDemo, checkAssets, marker, catalog };
