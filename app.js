require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('node:path');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { loadRuntimeConfig, prepareUploadStorage, checkUploadStorage } = require('./lib/runtime-config');
const config = loadRuntimeConfig();
const pool = require('./conexao');
const rota_usuario = require('./routes/usuarios');
const rota_categoria = require('./routes/categorias');
const rota_produto = require('./routes/produtos');
const rota_painel = require('./routes/painel');
const rota_movimentacao = require('./routes/movimentacoes');
const rota_cardapio = require('./routes/cardapios');
const rota_sobre = require('./routes/sobre');
const verificaUsuario = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxyHops);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('layout', 'layouts/principal');
app.use(expressLayouts);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
});

// O disco persistente pode ficar fora de public; as URLs existentes não mudam.
app.use('/uploads', express.static(config.uploadDir, { dotfiles: 'deny', index: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// A saúde não depende de um cookie nem revela detalhes de conexão ou do servidor.
app.get('/healthz', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        await Promise.all([pool.query('SELECT 1'), checkUploadStorage(config.uploadDir)]);
        res.status(200).json({ status: 'ok' });
    } catch (_) {
        res.status(503).json({ status: 'unavailable' });
    }
});

const sessionStore = config.production ? new PgSession({
    pool,
    schemaName: 'public',
    tableName: 'user_sessions',
    createTableIfMissing: false,
    errorLog: () => console.error('Não foi possível acessar o armazenamento de sessões.')
}) : undefined;

app.use(session({
    name: config.sessionName,
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: config.cookie
}));

app.use((req, res, next) => {
    res.locals.isLoggedIn = !!req.session.user;
    res.locals.user = req.session.user || null;
    next();
});

app.get('/', (req, res) => {
    if (req.session.user) res.redirect('/painel');
    else res.render('index', { mensagem: 'Bem-vindo ao Armazém do MADERO!', mainClass: 'main-index' });
});

app.use('/usuarios', rota_usuario);
app.use('/cardapio', rota_cardapio);
app.use('/sobre', rota_sobre);

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(503).send('Não foi possível encerrar a sessão. Tente novamente.');
        res.clearCookie(config.sessionName, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.production });
        res.redirect('/');
    });
});

app.use('/painel', verificaUsuario, rota_painel);
app.use('/categorias', verificaUsuario, rota_categoria);
app.use('/produtos', verificaUsuario, rota_produto);
app.use('/movimentacoes', verificaUsuario, rota_movimentacao);

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const clientError = err.status >= 400 && err.status < 500;
    if (!clientError) console.error('Não foi possível concluir uma solicitação.');
    res.status(clientError ? err.status : 500).send(clientError
        ? 'Não foi possível processar a solicitação. Confira os dados e tente novamente.'
        : 'Não foi possível concluir a solicitação. Tente novamente em instantes.');
});

async function start() {
    await prepareUploadStorage(config.uploadDir);
    if (config.production) {
        await pool.query('SELECT 1');
        // A migração deve ter sido aplicada antes de receber logins.
        await pool.query('SELECT sid FROM public.user_sessions LIMIT 0');
    }
    const server = await new Promise((resolve, reject) => {
        const listening = app.listen(config.port, config.host, () => resolve(listening));
        listening.once('error', reject);
    });
    console.log(`Servidor pronto na porta ${config.port}.`);
    let stopping = false;
    const shutdown = () => {
        if (stopping) return;
        stopping = true;
        const timeout = setTimeout(() => process.exit(1), 10_000);
        timeout.unref();
        server.close(async () => {
            try {
                if (sessionStore) await sessionStore.close();
                await pool.end();
                clearTimeout(timeout);
                process.exitCode = 0;
            } catch (_) {
                console.error('Não foi possível finalizar todos os recursos do servidor.');
                process.exitCode = 1;
            }
        });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return server;
}

module.exports = app;
module.exports.start = start;

if (require.main === module) {
    start().catch(async () => {
        console.error('Falha ao iniciar: confira as variáveis de ambiente, as migrações e o diretório de uploads.');
        if (sessionStore) await sessionStore.close().catch(() => {});
        await pool.end().catch(() => {});
        process.exitCode = 1;
    });
}
