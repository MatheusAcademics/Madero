const path = require('node:path');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');

const PROJECT_ROOT = path.join(__dirname, '..');

function uploadDirectory(env = process.env) {
    return env.UPLOAD_DIR?.trim()
        ? path.resolve(PROJECT_ROOT, env.UPLOAD_DIR.trim())
        : path.join(PROJECT_ROOT, 'public', 'uploads');
}

function loadRuntimeConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const portValue = env.PORT || '3000';
    if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
        throw new Error('PORT deve ser uma porta válida entre 1 e 65535.');
    }
    const proxyValue = env.TRUST_PROXY_HOPS || (production ? '1' : '0');
    if (!/^\d+$/.test(proxyValue) || Number(proxyValue) > 10) {
        throw new Error('TRUST_PROXY_HOPS deve ser um número de 0 a 10.');
    }
    let sessionSecret = env.SESSION_SECRET;
    if (production && (!sessionSecret || Buffer.byteLength(sessionSecret, 'utf8') < 32)) {
        throw new Error('Configure SESSION_SECRET com pelo menos 32 bytes antes de iniciar em produção.');
    }
    if (!sessionSecret) sessionSecret = randomBytes(48).toString('hex');
    return Object.freeze({
        production,
        port: Number(portValue),
        host: env.HOST?.trim() || '0.0.0.0',
        trustProxyHops: Number(proxyValue),
        sessionSecret,
        uploadDir: uploadDirectory(env),
        sessionName: 'madero.sid',
        cookie: Object.freeze({ httpOnly: true, sameSite: 'lax', secure: production, maxAge: 20 * 60 * 1000 })
    });
}

async function checkUploadStorage(directory) {
    for (const target of [directory, path.join(directory, 'products'), path.join(directory, 'avatars')]) {
        const stat = await fs.stat(target);
        if (!stat.isDirectory()) throw new Error('O armazenamento de imagens não está disponível.');
        await fs.access(target, constants.R_OK | constants.W_OK);
    }
}

async function prepareUploadStorage(directory) {
    await fs.mkdir(path.join(directory, 'products'), { recursive: true });
    await fs.mkdir(path.join(directory, 'avatars'), { recursive: true });
    await checkUploadStorage(directory);
}

module.exports = { loadRuntimeConfig, uploadDirectory, checkUploadStorage, prepareUploadStorage };
