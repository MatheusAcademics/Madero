const multer = require('multer');
const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { uploadDirectory } = require('./runtime-config');
const { storageConfig, uploadImage } = require('./cloud-images');

const MAX_BYTES = 5 * 1024 * 1024;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 12, parts: 14, fieldSize: 8192 }
}).single('foto_arquivo');

async function receive(req, res) {
    return new Promise(resolve => upload(req, res, error => {
        if (error) {
            const message = error.code === 'LIMIT_FILE_SIZE' ? 'A foto deve ter no máximo 5 MB.'
                : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE' ? 'Envie apenas uma foto por usuário.'
                    : 'Não foi possível ler o envio. Confira os campos e selecione a foto novamente.';
            return resolve({ file: null, error: message });
        }
        resolve({ file: req.file || null, error: '' });
    }));
}

function invalidImage() {
    return Object.assign(new Error('Escolha uma foto JPG, PNG ou WebP válida, de até 5 MB e 25 megapixels.'), { code: 'USER_IMAGE_INVALID' });
}

// Somente a aplicação escolhe o destino; nomes enviados no formulário nunca viram caminhos.
function createImageStore(directory = path.join(uploadDirectory(), 'avatars')) {
    return async file => {
        if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length || file.buffer.length > MAX_BYTES) throw invalidImage();
        let encoded;
        try {
            const options = { limitInputPixels: 25_000_000, failOn: 'warning' };
            const metadata = await sharp(file.buffer, options).metadata();
            if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw invalidImage();
            encoded = await sharp(file.buffer, options).rotate()
                .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 90 }).toBuffer();
        } catch (_) { throw invalidImage(); }
        const filename = randomUUID() + '.webp';
        const cloud = storageConfig();
        if (cloud) return uploadImage(cloud, 'avatars', filename, encoded);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, filename), encoded, { flag: 'wx' });
        return '/uploads/avatars/' + filename;
    };
}

module.exports = { receive, store: createImageStore(), createImageStore, MAX_BYTES };
