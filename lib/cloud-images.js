'use strict';

function storageConfig(env = process.env) {
    const provider = env.UPLOAD_STORAGE || (env.VERCEL === '1' ? 'supabase' : 'local');
    if (!['local', 'supabase'].includes(provider)) throw new Error('UPLOAD_STORAGE inválido.');
    if (env.VERCEL === '1' && provider !== 'supabase') throw new Error('Configure Supabase Storage na Vercel.');
    if (provider === 'local') return null;
    let origin;
    try {
        const url = new URL(env.SUPABASE_URL);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
        origin = url.origin;
    } catch (_) { throw new Error('Configure SUPABASE_URL com a origem HTTPS do projeto.'); }
    const bucket = env.SUPABASE_STORAGE_BUCKET || 'madero-uploads';
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket) || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Configure o bucket e a chave privada do Supabase Storage.');
    }
    return { origin, bucket, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

function objectPath(folder, filename) {
    if (!['products', 'avatars'].includes(folder) || !/^[a-f0-9-]{36}\.webp$/.test(filename)) {
        throw new Error('Caminho de imagem inválido.');
    }
    return folder + '/' + filename;
}

function publicImageUrl(config, folder, filename) {
    return `${config.origin}/storage/v1/object/public/${config.bucket}/${objectPath(folder, filename)}`;
}

async function storageRequest(config, endpoint, options = {}, fetcher = fetch) {
    try {
        const response = await fetcher(config.origin + '/storage/v1/' + endpoint, {
            ...options,
            headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, ...options.headers },
            redirect: 'error', signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error();
        return response;
    } catch (_) { throw new Error('Não foi possível acessar o armazenamento de imagens.'); }
}

async function uploadImage(config, folder, filename, bytes, fetcher) {
    const target = objectPath(folder, filename);
    await storageRequest(config, `object/${config.bucket}/${target}`, {
        method: 'POST', body: bytes,
        headers: { 'Content-Type': 'image/webp', 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000' }
    }, fetcher);
    return '/uploads/' + target;
}

async function checkCloudStorage(config, fetcher) {
    const response = await storageRequest(config, 'bucket/' + config.bucket, {}, fetcher);
    const bucket = await response.json();
    if (bucket.public !== true) throw new Error('O bucket de imagens precisa permitir leitura pública.');
}

async function deleteAvatar(config, filename, fetcher) {
    const target = objectPath('avatars', filename);
    await storageRequest(config, `object/${config.bucket}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [target] })
    }, fetcher);
}

module.exports = { storageConfig, publicImageUrl, uploadImage, checkCloudStorage, deleteAvatar };
