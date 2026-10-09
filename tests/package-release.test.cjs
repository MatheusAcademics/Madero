const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ROOT_FILES, SOURCE_DIRECTORIES, allowedFile, collectReleaseFiles, packageRelease } = require('../scripts/package-release.cjs');

test('release: allowlist preserves source, demo images, migrations and non-secret configuration', () => {
    for (const file of [...ROOT_FILES, 'routes/usuarios.js', 'public/img/demo/pao.jpg',
        'public/uploads-notes.md', 'database/migrations/003_user_sessions.sql', 'tests/registration.test.cjs']) {
        assert.equal(allowedFile(file), true, file);
    }
});

test('release: excludes secrets, uploads, backups, dependencies, personal files and non-migration SQL', () => {
    for (const file of ['.env', '.env.production', '.git/config', 'node_modules/test.js', 'teste_banco.js',
        'public/uploads/products/photo.webp', 'public/uploads/avatars/photo.webp', 'database/dump.sql',
        'database/backup.sql', 'public/.env', 'scripts/.env.local', 'database/password.pem',
        'database/db.backup', 'database/private.csv', 'public/backups/data.json', 'public/secret.key', 'notes.txt']) {
        assert.equal(allowedFile(file), false, file);
    }
});

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'madero-release-test-'));
    // The only recursive cleanup target is the exact mkdtemp fixture, never the workspace.
    t.after(async () => {
        const resolved = await fs.realpath(root);
        assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('madero-release-test-'));
        await fs.rm(resolved, { recursive: true });
    });
    for (const name of ROOT_FILES) await fs.writeFile(path.join(root, name), 'release-test-placeholder');
    for (const name of SOURCE_DIRECTORIES) await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, '.env'), 'PRIVATE_FIXTURE_DO_NOT_EXPORT');
    await fs.mkdir(path.join(root, 'public', 'uploads'));
    await fs.writeFile(path.join(root, 'public', 'uploads', 'photo.jpg'), 'private fixture');
    await fs.writeFile(path.join(root, 'routes', 'index.js'), 'module.exports = {};');
    return root;
}

test('release: manifest contains only approved files and required configuration must exist', async t => {
    const root = await fixture(t);
    const files = await collectReleaseFiles(root);
    assert.deepEqual(files, [...ROOT_FILES, 'routes/index.js'].sort());
    await fs.unlink(path.join(root, 'render.yaml'));
    await assert.rejects(collectReleaseFiles(root), { code: 'ENOENT' });
});

test('release: generated tar contains exactly the reviewed file list without including user data', async t => {
    const root = await fixture(t);
    const result = await packageRelease(root);
    assert.ok(result.bytes > 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    const { stdout } = await promisify(execFile)('tar', ['-tzf', result.archive], { windowsHide: true });
    assert.deepEqual(stdout.trim().split(/\r?\n/).sort(), result.files);
    const second = await packageRelease(root);
    assert.notEqual(result.archive, second.archive);
    await fs.access(result.archive);
});
