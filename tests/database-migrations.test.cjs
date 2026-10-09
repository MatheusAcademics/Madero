const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { migrate, readMigrations, migrationBody } = require('../scripts/migrate.cjs');

function database({ recorded = [], failAt = '' } = {}) {
    const calls = [];
    let committed = structuredClone(recorded);
    let pending = structuredClone(recorded);
    let released = false;
    return {
        calls,
        get records() { return committed; },
        get released() { return released; },
        async connect() {
            return {
                async query(sql, args = []) {
                    calls.push({ sql, args });
                    if (failAt && sql.includes(failAt)) throw new Error('Test-only failure');
                    if (sql === 'BEGIN') pending = structuredClone(committed);
                    if (sql === 'COMMIT') committed = structuredClone(pending);
                    if (sql === 'ROLLBACK') pending = structuredClone(committed);
                    if (sql.startsWith('SELECT filename')) return { rows: structuredClone(pending) };
                    if (sql.startsWith('INSERT INTO public.schema_migrations')) pending.push({ filename: args[0], checksum: args[1] });
                    return { rows: [] };
                },
                release() { released = true; }
            };
        }
    };
}

test('migrations: lê 000 a 003 em ordem e mantém originais 001/002 executáveis no pgAdmin', async () => {
    const files = await readMigrations();
    assert.deepEqual(files.map(file => file.filename), ['000_initial_schema.sql', '001_registration_contact.sql', '002_user_avatar.sql', '003_user_sessions.sql']);
    for (const file of files) {
        const raw = (await fs.readFile(path.join(__dirname, '../database/migrations', file.filename), 'utf8')).replace(/\r\n/g, '\n');
        assert.equal(file.checksum, createHash('sha256').update(raw).digest('hex'));
        assert.doesNotMatch(file.sql, /(?:^|\n)\s*(?:BEGIN|COMMIT)\s*;/i);
        if (/^00[12]_/.test(file.filename)) {
            assert.match(raw, /BEGIN;/);
            assert.match(raw, /COMMIT;/);
        }
    }
});

test('migrations: remove somente envoltório transacional esperado e rejeita incompleto', () => {
    assert.equal(migrationBody('-- explanation\nBEGIN;\nSELECT 1;\nCOMMIT;'), 'SELECT 1;');
    assert.equal(migrationBody('SELECT 1;'), 'SELECT 1;');
    assert.throws(() => migrationBody('BEGIN;\nSELECT 1;'), /transação incompleta/);
});

test('migrations: banco vazio recebe todas em uma transação com lock e checksum', async () => {
    const db = database();
    const applied = [];
    const report = await migrate(db, { onApplied: name => applied.push(name) });
    assert.equal(report.applied.length, 4);
    assert.equal(report.skipped, 0);
    assert.deepEqual(applied, report.applied);
    assert.deepEqual(db.records.map(row => row.filename), applied);
    assert.equal(db.calls.filter(call => call.sql === 'BEGIN').length, 1);
    assert.equal(db.calls.filter(call => call.sql === 'COMMIT').length, 1);
    assert.ok(db.calls.findIndex(call => call.sql.includes('pg_advisory_xact_lock')) < db.calls.findIndex(call => call.sql.startsWith('SELECT filename')));
    assert.ok(db.released);
});

test('migrations: segunda execução não reaplica alterações', async () => {
    const files = await readMigrations();
    const db = database({ recorded: files.map(({ filename, checksum }) => ({ filename, checksum })) });
    const report = await migrate(db);
    assert.deepEqual(report, { applied: [], skipped: 4 });
    assert.equal(db.calls.filter(call => call.sql.startsWith('INSERT INTO public.schema_migrations')).length, 0);
    assert.equal(db.calls.filter(call => files.some(file => file.sql === call.sql)).length, 0);
});

test('migrations: executa somente novas migrações após as já registradas', async () => {
    const files = await readMigrations();
    const db = database({ recorded: files.slice(0, 3).map(({ filename, checksum }) => ({ filename, checksum })) });
    assert.deepEqual(await migrate(db), { applied: ['003_user_sessions.sql'], skipped: 3 });
    assert.equal(db.records.length, 4);
});

test('migrations: detecta arquivo aplicado modificado antes de executar qualquer SQL de migração', async () => {
    const files = await readMigrations();
    const db = database({ recorded: [{ filename: files[0].filename, checksum: 'wrong' }] });
    await assert.rejects(migrate(db), /já aplicada foi alterada/);
    assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
    assert.equal(db.calls.filter(call => files.some(file => file.sql === call.sql)).length, 0);
    assert.equal(db.records.length, 1);
    assert.ok(db.released);
});

test('migrations: rejeita banco de versão mais nova que perdeu arquivo de migração', async () => {
    const db = database({ recorded: [{ filename: '099_future.sql', checksum: 'test' }] });
    await assert.rejects(migrate(db), /ausente nesta versão/);
    assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
});

test('migrations: não permite aplicar migração antiga fora de ordem', async () => {
    const files = await readMigrations();
    const db = database({ recorded: [{ filename: files[1].filename, checksum: files[1].checksum }] });
    await assert.rejects(migrate(db), /sequência das migrações está incompleta/);
    assert.equal(db.calls.filter(call => files.some(file => file.sql === call.sql)).length, 0);
});

test('migrations: falha de schema reverte todo histórico pendente e libera conexão', async () => {
    const db = database({ failAt: 'ALTER TABLE public.usuarios' });
    const applied = [];
    await assert.rejects(migrate(db, { onApplied: name => applied.push(name) }), /Test-only failure/);
    assert.deepEqual(db.records, []);
    assert.deepEqual(applied, []);
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.ok(db.released);
});

test('migrations: falha ao registrar checksum reverte alteração no mesmo bloco', async () => {
    const db = database({ failAt: 'INSERT INTO public.schema_migrations' });
    await assert.rejects(migrate(db), /Test-only failure/);
    assert.deepEqual(db.records, []);
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('migrations: schema inicial preserva tabelas existentes sem seed, reset ou exclusão em cascata', async () => {
    const files = await readMigrations();
    const initial = files[0].sql;
    for (const table of ['usuarios', 'categorias', 'produtos', 'movimentacoes']) {
        assert.match(initial, new RegExp('CREATE TABLE IF NOT EXISTS public\\.' + table));
    }
    assert.match(initial, /estoque NUMERIC\(12, 2\)/);
    assert.match(initial, /data_movimentacao TIMESTAMP WITHOUT TIME ZONE/);
    for (const column of ['estoque', 'estoque_minimo', 'valor']) {
        assert.match(initial, new RegExp(column + ' NUMERIC\\(12, 2\\) NOT NULL DEFAULT 0'));
    }
    for (const column of ['id_categoria', 'id_produto', 'id_usuario']) {
        assert.match(initial, new RegExp(column + ' INTEGER NOT NULL REFERENCES public\\.'));
    }
    assert.match(initial, /CHECK \(tipo_movimentacao IN \('Entrada', 'Saída'\)\)/);
    assert.match(initial, /data_movimentacao TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    assert.equal((initial.match(/ON DELETE RESTRICT/g) || []).length, 3);
    for (const file of files) assert.doesNotMatch(file.sql, /\b(?:TRUNCATE|DROP|DELETE FROM|CASCADE|INSERT INTO|UPDATE)\b/i);
});

test('migrations: sessões seguem formato connect-pg-simple sem apagar sessões existentes', async () => {
    const files = await readMigrations();
    const sessions = files.find(file => file.filename === '003_user_sessions.sql').sql;
    assert.match(sessions, /CREATE TABLE IF NOT EXISTS public\.user_sessions/);
    assert.match(sessions, /sid VARCHAR NOT NULL COLLATE "default"/);
    assert.match(sessions, /sess JSON NOT NULL/);
    assert.match(sessions, /expire TIMESTAMP\(6\) NOT NULL/);
    assert.match(sessions, /PRIMARY KEY \(sid\) NOT DEFERRABLE INITIALLY IMMEDIATE/);
    assert.match(sessions, /CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire"/);
});
