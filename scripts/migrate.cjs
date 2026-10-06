'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

class MigrationError extends Error {
    constructor(message) { super(message); this.code = 'MIGRATION_CHECK_FAILED'; }
}

function migrationBody(sql) {
    // 001/002 continuam executáveis individualmente no pgAdmin. No runner a
    // transação externa inclui também o registro do checksum, de forma atômica.
    const withoutLeadingComments = sql.replace(/^(?:\s*--[^\n]*(?:\n|$))*/, '').trim();
    if (/^BEGIN\s*;/i.test(withoutLeadingComments)) {
        if (!/COMMIT\s*;\s*$/i.test(withoutLeadingComments)) {
            throw new MigrationError('Migração com transação incompleta. Revise o arquivo SQL antes de continuar.');
        }
        return withoutLeadingComments.replace(/^BEGIN\s*;/i, '').replace(/COMMIT\s*;\s*$/i, '').trim();
    }
    return sql;
}

async function readMigrations(directory = path.join(__dirname, '..', 'database', 'migrations')) {
    const filenames = (await fs.readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    if (!filenames.length) throw new MigrationError('Nenhuma migração encontrada.');
    const versions = new Set();
    return Promise.all(filenames.map(async filename => {
        const version = filename.slice(0, 3);
        if (versions.has(version)) throw new MigrationError('Existem migrações com o mesmo número.');
        versions.add(version);
        // O checkout Git no Windows pode trocar LF por CRLF; não é alteração SQL.
        const source = (await fs.readFile(path.join(directory, filename), 'utf8')).replace(/\r\n/g, '\n');
        return { filename, checksum: createHash('sha256').update(source).digest('hex'), sql: migrationBody(source) };
    }));
}

async function migrate(pool, { migrations, directory, onApplied = () => {} } = {}) {
    const files = migrations || await readMigrations(directory);
    const client = await pool.connect();
    const applied = [];
    let transaction = false;
    try {
        await client.query('BEGIN');
        transaction = true;
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '60s'");
        await client.query('SELECT pg_advisory_xact_lock($1)', [1296122948]);
        await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
            filename TEXT PRIMARY KEY,
            checksum VARCHAR(64) NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )`);
        const tracked = await client.query('SELECT filename, checksum FROM public.schema_migrations ORDER BY filename');
        const byName = new Map(files.map(file => [file.filename, file]));
        const recorded = new Map(tracked.rows.map(row => [row.filename, row.checksum]));
        for (const row of tracked.rows) {
            if (!byName.has(row.filename)) throw new MigrationError('O banco registra uma migração ausente nesta versão do código. Não houve atualização.');
            if (byName.get(row.filename).checksum !== row.checksum) throw new MigrationError('Uma migração já aplicada foi alterada. Restaure o arquivo original e crie uma nova migração.');
        }
        let pendingSeen = false;
        for (const file of files) {
            if (!recorded.has(file.filename)) pendingSeen = true;
            else if (pendingSeen) throw new MigrationError('A sequência das migrações está incompleta. Revise o histórico antes de continuar.');
        }
        for (const file of files) {
            if (recorded.has(file.filename)) continue;
            await client.query(file.sql);
            await client.query('INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)', [file.filename, file.checksum]);
            applied.push(file.filename);
        }
        await client.query('COMMIT');
        transaction = false;
        for (const filename of applied) onApplied(filename);
        return { applied, skipped: files.length - applied.length };
    } catch (error) {
        if (transaction) { try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the first failure. */ } }
        throw error;
    } finally { client.release(); }
}

async function main() {
    if (process.argv.length > 2) throw new MigrationError('Uso: npm run db:migrate. O comando nunca reinicia nem limpa o banco.');
    const pool = require('../conexao');
    try {
        const report = await migrate(pool, { onApplied: filename => console.log('Aplicada: ' + filename) });
        console.log('Banco atualizado. ' + report.applied.length + ' migração(ões) aplicada(s); ' + report.skipped + ' já registrada(s).');
    } finally { await pool.end(); }
}

if (require.main === module) main().catch(error => {
    console.error(['MIGRATION_CHECK_FAILED', 'DATABASE_CONFIG_INVALID'].includes(error.code)
        ? error.message
        : 'Não foi possível aplicar as migrações. Confira conexão, permissões e compatibilidade do banco. A transação não confirmada foi revertida.');
    process.exitCode = 1;
});

module.exports = { migrate, readMigrations, migrationBody };
