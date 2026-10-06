const test = require('node:test');
const assert = require('node:assert/strict');
const { getDatabaseConfig } = require('../lib/database-config');

const production = { NODE_ENV: 'production', DB_HOST: 'database.internal', DB_NAME: 'inventory', DB_USER: 'app', DB_PASSWORD: 'test-only' };

test('database config: mantém configuração local separada e limites do pool', () => {
    const config = getDatabaseConfig({ DB_HOST: 'localhost', DB_NAME: 'test', DB_USER: 'student', DB_PASSWORD: 'test-only', DB_PORT: '5433' });
    assert.equal(config.host, 'localhost');
    assert.equal(config.database, 'test');
    assert.equal(config.user, 'student');
    assert.equal(config.password, 'test-only');
    assert.equal(config.port, 5433);
    assert.equal(config.ssl, false);
    assert.equal(config.max, 10);
    assert.equal(config.connectionTimeoutMillis, 10000);
});

test('database config: URL tem prioridade e credenciais escapadas são decodificadas', () => {
    const config = getDatabaseConfig({ ...production, DATABASE_URL: 'postgresql://user%40demo:p%40ss%2Fword@remote.example:6543/stock%20test' });
    assert.equal(config.host, 'remote.example');
    assert.equal(config.port, 6543);
    assert.equal(config.database, 'stock test');
    assert.equal(config.user, 'user@demo');
    assert.equal(config.password, 'p@ss/word');
    assert.equal(config.connectionString, undefined);
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('database config: SSL verificado em produção e rede interna somente por opção explícita', () => {
    assert.deepEqual(getDatabaseConfig(production).ssl, { rejectUnauthorized: true });
    assert.equal(getDatabaseConfig({ ...production, DB_SSL: 'disable' }).ssl, false);
    for (const mode of ['require', 'verify-full']) {
        assert.deepEqual(getDatabaseConfig({ ...production, DB_SSL: mode }).ssl, { rejectUnauthorized: true });
    }
});

test('database config: CA customizada não desliga a validação TLS', () => {
    const config = getDatabaseConfig({ ...production, DB_SSL: 'require', DB_SSL_CA: 'BEGIN\\nCERTIFICATE\\nEND' });
    assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: 'BEGIN\nCERTIFICATE\nEND' });
    assert.throws(() => getDatabaseConfig({ ...production, DB_SSL: 'disable', DB_SSL_CA: 'certificate' }), /DB_SSL_CA exige/);
});

test('database config: sslmode seguro da URL é respeitado sem repassar parâmetros ao pg', () => {
    for (const [mode, expected] of [['disable', false], ['require', { rejectUnauthorized: true }], ['verify-full', { rejectUnauthorized: true }]]) {
        assert.deepEqual(getDatabaseConfig({ DATABASE_URL: 'postgres://app:pass@db/test?sslmode=' + mode }).ssl, expected);
    }
    assert.equal(getDatabaseConfig({ ...production, DATABASE_URL: 'postgres://app:pass@db/test?sslmode=require', DB_SSL: 'disable' }).ssl, false);
});

test('database config: URLs inseguras ou parâmetros que alteram TLS são rejeitados', () => {
    for (const query of ['sslmode=no-verify', 'sslmode=prefer', 'sslmode=verify-ca', 'ssl=false', 'sslrootcert=/private/key', 'uselibpqcompat=true', 'options=-c%20search_path=evil']) {
        assert.throws(() => getDatabaseConfig({ DATABASE_URL: 'postgres://app:pass@db/test?' + query }), { code: 'DATABASE_CONFIG_INVALID' });
    }
    assert.throws(() => getDatabaseConfig({ DB_SSL: 'false' }), { code: 'DATABASE_CONFIG_INVALID' });
});

test('database config: mensagens de URL inválida nunca expõem o valor recebido', () => {
    for (const value of ['not-a-url-private-value', 'https://secret-user:secret-pass@example.org/db', 'postgres://app:secret-pass@db/', 'postgres://app:secret-pass@db/%broken']) {
        assert.throws(() => getDatabaseConfig({ DATABASE_URL: value }), error => {
            assert.equal(error.code, 'DATABASE_CONFIG_INVALID');
            assert.doesNotMatch(error.message, /secret-pass|secret-user|private-value/);
            return true;
        });
    }
});

test('database config: produção incompleta falha sem abrir conexão', () => {
    assert.throws(() => getDatabaseConfig({ NODE_ENV: 'production' }), { code: 'DATABASE_CONFIG_INVALID' });
    assert.throws(() => getDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/test' }), { code: 'DATABASE_CONFIG_INVALID' });
    assert.equal(getDatabaseConfig({}).port, 5432);
});

test('database config: valida limites de porta e tamanho do pool', () => {
    for (const port of ['-1', '0', '5432abc', '65536', 'NaN']) assert.throws(() => getDatabaseConfig({ DB_PORT: port }), /DB_PORT/);
    for (const max of ['-1', '0', '51', '2.5', 'not-number']) assert.throws(() => getDatabaseConfig({ DB_POOL_MAX: max }), /DB_POOL_MAX/);
    assert.equal(getDatabaseConfig({ DB_POOL_MAX: '5' }).max, 5);
});

test('database config: suporta URL IPv6 e não modifica ambiente recebido', () => {
    const env = { DATABASE_URL: 'postgres://app:pass@[::1]:5432/test' };
    const original = { ...env };
    assert.equal(getDatabaseConfig(env).host, '::1');
    assert.deepEqual(env, original);
});
