'use strict';

function settingError(message) {
    const error = new Error(message);
    error.code = 'DATABASE_CONFIG_INVALID';
    return error;
}

function integerSetting(value, fallback, maximum, name) {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > maximum) {
        throw settingError('Confira a configuração de ' + name + '.');
    }
    return Number(value);
}

function getDatabaseConfig(env = process.env) {
    let values;
    let urlSslMode;
    if (env.DATABASE_URL) {
        try {
            const url = new URL(env.DATABASE_URL);
            if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
            // Não repassamos a URL ao pg: parâmetros SSL nela não podem desligar a
            // validação de certificado nem carregar arquivos de certificados locais.
            const allowed = new Set(['sslmode', 'application_name']);
            if ([...url.searchParams.keys()].some(key => !allowed.has(key))) throw new Error();
            urlSslMode = url.searchParams.get('sslmode') || undefined;
            values = {
                host: url.hostname.replace(/^\[|\]$/g, ''),
                port: url.port || '5432',
                database: decodeURIComponent(url.pathname.slice(1)),
                user: decodeURIComponent(url.username),
                password: decodeURIComponent(url.password)
            };
        } catch (_) {
            throw settingError('DATABASE_URL inválida. Use uma URL PostgreSQL; configure certificados em DB_SSL_CA.');
        }
    } else {
        values = {
            host: env.DB_HOST,
            port: env.DB_PORT,
            database: env.DB_NAME,
            user: env.DB_USER,
            password: env.DB_PASSWORD
        };
    }

    if (env.NODE_ENV === 'production' && (!values.host || !values.database || !values.user)) {
        throw settingError('Configure DATABASE_URL ou DB_HOST, DB_NAME e DB_USER antes de iniciar em produção.');
    }
    if (urlSslMode && !['disable', 'require', 'verify-full'].includes(urlSslMode)) {
        throw settingError('O sslmode da DATABASE_URL deve ser disable, require ou verify-full.');
    }
    const mode = env.DB_SSL || urlSslMode || (env.NODE_ENV === 'production' ? 'require' : 'disable');
    if (!['disable', 'require', 'verify-full'].includes(mode)) {
        throw settingError('DB_SSL deve ser disable, require ou verify-full.');
    }
    if (mode === 'disable' && env.DB_SSL_CA) {
        throw settingError('DB_SSL_CA exige DB_SSL=require ou verify-full.');
    }
    const ssl = mode === 'disable' ? false : { rejectUnauthorized: true };
    if (ssl && env.DB_SSL_CA) ssl.ca = env.DB_SSL_CA.replace(/\\n/g, '\n');
    return {
        ...values,
        port: integerSetting(values.port, 5432, 65535, 'DB_PORT'),
        ssl,
        max: integerSetting(env.DB_POOL_MAX, 10, 50, 'DB_POOL_MAX'),
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        application_name: 'madero-inventory'
    };
}

module.exports = { getDatabaseConfig };
