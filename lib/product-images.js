const multer = require('multer');
const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { uploadDirectory } = require('./runtime-config');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 12, parts: 14, fieldSize: 8192 }
}).single('imagem_arquivo');

async function receive(req, res) {
    return new Promise(resolve => upload(req, res, error => {
        if (error) {
            const message = error.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 5 MB.'
                : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE' ? 'Envie apenas uma imagem por produto.'
                    : 'Não foi possível ler o envio. Confira os campos e selecione a imagem novamente.';
            return resolve({ file: null, error: message });
        }
        resolve({ file: req.file || null, error: '' });
    }));
}

function invalidImage() {
    return Object.assign(new Error('Escolha uma imagem JPG, PNG ou WebP válida, de até 5 MB e 25 megapixels.'), { code: 'PRODUCT_IMAGE_INVALID' });
}

// O diretório é definido pela aplicação, nunca pelo nome ou caminho enviados pelo usuário.
function createImageStore(directory = path.join(uploadDirectory(), 'products')) {
    return async file => {
        if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length || file.buffer.length > MAX_BYTES) throw invalidImage();
        let encoded;
        try {
            const options = { limitInputPixels: MAX_PIXELS, failOn: 'warning' };
            const metadata = await sharp(file.buffer, options).metadata();
            if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw invalidImage();
            // Decodifica de verdade, remove metadados e preserva proporção/transparência.
            encoded = await sharp(file.buffer, options).rotate()
                .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 90 }).toBuffer();
        } catch (_) { throw invalidImage(); }
        const filename = randomUUID() + '.webp';
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, filename), encoded, { flag: 'wx' });
        return '/uploads/products/' + filename;
    };
}

module.exports = { receive, store: createImageStore(), createImageStore, MAX_BYTES };
