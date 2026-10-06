const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const catalog = require('../database/demo-catalog.json');

async function downloadImages() {
  const directory = path.join(__dirname, '..', 'public', 'img', 'demo');
  await fs.mkdir(directory, { recursive: true });
  const results = [];
  for (const product of catalog.products) {
    const filename = path.basename(product.image);
    if (product.image !== '/img/demo/' + filename) throw new Error('Destino de imagem inválido.');
    const destination = path.join(directory, filename);
    let buffer;
    let existing = false;
    try { buffer = await fs.readFile(destination); existing = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing) {
      const url = new URL(product.source);
      if (url.origin !== 'https://master.restaurantemadero.com.br' || !url.pathname.startsWith('/assets/site/images/emporio/')) throw new Error('Fonte inesperada.');
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error('Foto indisponível: ' + product.key);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 12 * 1024 * 1024) throw new Error('Foto excede o limite de download: ' + product.key);
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);
    }
    const metadata = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
    if (!['jpeg', 'png'].includes(metadata.format) || metadata.width < 100 || metadata.height < 100) throw new Error('A fonte não forneceu uma fotografia válida: ' + product.key);
    if (!existing) await fs.writeFile(destination, buffer, { flag: 'wx' });
    results.push({ product: product.key, width: metadata.width, height: metadata.height, bytes: buffer.length, existing });
  }
  return results;
}

if (require.main === module) downloadImages().then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { downloadImages };
