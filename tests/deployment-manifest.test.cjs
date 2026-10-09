'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('deployment: Render manifest explicitly uses paid single-instance storage and manual updates', () => {
    const manifest = read('render.yaml');
    assert.match(manifest, /RECURSOS PAGOS/);
    assert.match(manifest, /plan: 0\.5c-512mb/);
    assert.match(manifest, /plan: 0\.1c-256mb/);
    assert.match(manifest, /numInstances: 1/);
    assert.match(manifest, /autoDeployTrigger: "off"/);
    assert.match(manifest, /buildCommand: npm ci/);
    assert.match(manifest, /startCommand: npm run db:migrate && npm run serve/);
    assert.match(manifest, /healthCheckPath: \/healthz/);
    assert.match(manifest, /mountPath: \/var\/data/);
    assert.match(manifest, /value: \/var\/data\/uploads/);
    assert.match(manifest, /ipAllowList: \[\]/);
    assert.match(manifest, /storageAutoscalingEnabled: false/);
    assert.equal((manifest.match(/region: ohio/g) || []).length, 2);
    assert.doesNotMatch(manifest, /demo:seed|demo:images|npm start/);
});

test('deployment: secrets are generated in hosting, never supplied in the example environment', () => {
    const manifest = read('render.yaml');
    assert.match(manifest, /key: SESSION_SECRET\s+generateValue: true/);
    assert.match(manifest, /key: DATABASE_URL\s+fromDatabase:\s+name: madero-db\s+property: connectionString/);
    const example = read('.env.example');
    assert.match(example, /^DB_PASSWORD=\s*$/m);
    assert.match(example, /^SESSION_SECRET=\s*$/m);
    assert.match(example, /^NODE_ENV=development$/m);
    assert.match(example, /^TRUST_PROXY_HOPS=0$/m);
    assert.match(example, /^UPLOAD_DIR=\.\/public\/uploads$/m);
    assert.equal(read('.node-version').trim(), '24');
});

test('deployment: ignore rules protect secrets, dependencies, uploads and release artifacts', () => {
    const lines = new Set(read('.gitignore').split(/\r?\n/));
    for (const rule of ['.env', '.env.*', '!.env.example', 'node_modules/', '/public/uploads/', 'backups/', 'artifacts/']) {
        assert.ok(lines.has(rule), 'Missing ignore rule: ' + rule);
    }
    assert.ok(!lines.has('*.sql'), 'Migration SQL must remain versionable');
    assert.ok(!lines.has('/public/img/demo/'), 'Reviewed demo photos must remain versionable');
});

test('deployment: guide explains cost approval, separate data transfer and demo-only access model', () => {
    const guide = read('DEPLOY.md');
    for (const phrase of ['Nada foi publicado', 'recursos pagos', 'npm run release:pack', 'git rev-parse --show-toplevel',
        'cadastro continua livre', 'mesmas operações', 'schema_migrations', 'user_sessions', '/var/data/uploads/products/',
        'Single transaction', 'dados fictícios', 'não substituem']) {
        assert.ok(guide.includes(phrase), 'Missing guide warning: ' + phrase);
    }
    for (const match of guide.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)) {
        assert.ok(fs.existsSync(path.join(root, match[1])), 'Broken relative documentation link: ' + match[1]);
    }
});
