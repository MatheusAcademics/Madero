'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

const ROOT_FILES = ['app.js', 'conexao.js', 'package.json', 'package-lock.json', 'render.yaml',
    '.node-version', '.env.example', '.gitignore', 'DEPLOY.md'];
const SOURCE_DIRECTORIES = ['lib', 'middleware', 'routes', 'views', 'public', 'scripts', 'database', 'tests'];
const EXCLUDED_DIRECTORIES = new Set(['uploads', 'node_modules', '.git', 'backups', 'artifacts', 'logs', 'tmp', '.tmp']);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.json', '.ejs', '.css', '.md', '.sql', '.test.cjs']);
const ASSET_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.gif', '.avif',
    '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm']);

function allowedFile(relative) {
    if (ROOT_FILES.includes(relative)) return true;
    const parts = relative.split('/');
    if (!SOURCE_DIRECTORIES.includes(parts[0]) || parts.some(part => part.startsWith('.') || EXCLUDED_DIRECTORIES.has(part))) return false;
    const name = parts.at(-1).toLowerCase();
    if (/backup|\.dump$|\.backup$|\.pem$|\.key$|\.pfx$|\.log$/.test(name)) return false;
    // Only numbered migrations are SQL source. Never package an arbitrary DB dump.
    if (name.endsWith('.sql')) return /^database\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(relative);
    return SOURCE_EXTENSIONS.has(path.extname(name))
        || (parts[0] === 'public' && ASSET_EXTENSIONS.has(path.extname(name)));
}

async function collectReleaseFiles(root) {
    const files = [];
    async function visit(relative) {
        const fullPath = path.join(root, relative);
        const info = await fs.lstat(fullPath);
        if (info.isSymbolicLink()) throw new Error('O pacote não aceita links simbólicos ou junções. Revise: ' + relative);
        if (info.isDirectory()) {
            for (const name of (await fs.readdir(fullPath)).sort()) {
                if (name.startsWith('.') || EXCLUDED_DIRECTORIES.has(name.toLowerCase())) continue;
                await visit(relative + '/' + name);
            }
        } else if (info.isFile() && allowedFile(relative)) {
            if (/[\r\n\0]/.test(relative)) throw new Error('Nome de arquivo inválido para empacotamento.');
            files.push(relative);
        }
    }
    for (const name of ROOT_FILES) await visit(name);
    for (const name of SOURCE_DIRECTORIES) await visit(name);
    return files.sort();
}

async function packageRelease(root = path.join(__dirname, '..')) {
    root = await fs.realpath(root);
    const files = await collectReleaseFiles(root);
    const artifactDirectory = path.join(root, 'artifacts');
    await fs.mkdir(artifactDirectory, { recursive: true });
    const resolvedArtifacts = await fs.realpath(artifactDirectory);
    if (resolvedArtifacts !== artifactDirectory) throw new Error('A pasta artifacts precisa estar dentro deste projeto, sem links.');
    const archive = path.join(artifactDirectory, 'madero-release-' + randomUUID() + '.tar.gz');
    // Reserve a unique output, never overwrite an existing user archive.
    const handle = await fs.open(archive, 'wx');
    await handle.close();
    await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-czf', archive, '-C', root, '--null', '--no-recursion', '-T', '-'],
            { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        child.on('error', () => reject(new Error('Não foi possível executar tar. Use o tar incluído no Windows 10/11 ou instale-o no seu sistema.')));
        child.stderr.resume();
        child.stdin.on('error', () => {});
        child.on('close', code => code === 0 ? resolve() : reject(new Error('Falha ao gerar o pacote. Não publique o arquivo incompleto.')));
        child.stdin.end(files.join('\0') + '\0');
    });
    const bytes = await fs.readFile(archive);
    return { archive, files, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function main() {
    if (process.argv.length > 2) throw new Error('Uso: npm run release:pack');
    const result = await packageRelease();
    console.log('Pacote criado: ' + path.relative(path.join(__dirname, '..'), result.archive));
    console.log(result.files.length + ' arquivos; ' + (result.bytes / 1024 / 1024).toFixed(1) + ' MB.');
    console.log('SHA256: ' + result.sha256);
    console.log('Sem .env, node_modules, uploads ou cópia do banco. Não é um backup dos seus dados.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { ROOT_FILES, SOURCE_DIRECTORIES, allowedFile, collectReleaseFiles, packageRelease };
