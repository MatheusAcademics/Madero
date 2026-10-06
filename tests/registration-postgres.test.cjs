const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

// Opt-in: uses the configured demonstration database and ALWAYS rolls back.
// PostgreSQL identity sequences can advance even when rows are rolled back.
test('registration and login work against PostgreSQL without retaining test accounts', {
    skip: process.env.MADERO_DB_INTEGRATION !== '1',
    timeout: 20000
}, async () => {
    require('dotenv').config({ quiet: true });
    const { Client } = require('pg');
    const bcrypt = require('bcrypt');
    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionTimeoutMillis: 3000,
        query_timeout: 5000,
        statement_timeout: 5000
    });
    const handlers = new Map();
    const router = Object.fromEntries(['get', 'post'].map(method => [method,
        (route, handler) => handlers.set(`${method} ${route}`, handler)
    ]));
    const db = {
        async query(sql, values) {
            // A rejected INSERT must not abort the surrounding test transaction.
            await client.query('SAVEPOINT registration_query');
            try {
                const result = await client.query(sql, values);
                await client.query('RELEASE SAVEPOINT registration_query');
                return result;
            } catch (error) {
                await client.query('ROLLBACK TO SAVEPOINT registration_query');
                await client.query('RELEASE SAVEPOINT registration_query');
                throw error;
            }
        }
    };
    const dependencies = { express: { Router: () => router }, bcrypt, '../conexao': db };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/usuarios.js'), 'utf8'), {
        module: { exports: {} }, Buffer,
        console: { log() {}, error() {} },
        require: name => {
            assert.ok(Object.hasOwn(dependencies, name));
            return dependencies[name];
        }
    });
    const invoke = async (route, req) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            render(view, locals) { this.view = view; this.locals = locals; return this; },
            redirect(destination) { this.destination = destination; return this; }
        };
        await handlers.get(`post ${route}`)(req, res);
        return res;
    };
    const marker = randomUUID();
    const body = {
        nome: 'Teste temporário de cadastro',
        usuario: `qa_${marker}`,
        email: `  QA-${marker}@EXAMPLE.INVALID  `,
        telefone: '+55 (11) 99999-0000',
        senha: `test-only-${marker}`,
        confirmar_senha: `test-only-${marker}`
    };
    let connected = false;
    try {
        await client.connect();
        connected = true;
        await client.query('BEGIN');
        const result = await invoke('/cadastro', { body });
        assert.equal(result.statusCode, 200);
        assert.equal(result.view, 'login');
        const stored = await client.query(
            'SELECT email, telefone, senha FROM public.usuarios WHERE usuario = $1', [body.usuario]
        );
        assert.equal(stored.rows.length, 1);
        assert.equal(stored.rows[0].email, body.email.trim().toLowerCase());
        assert.equal(stored.rows[0].telefone, '+5511999990000');
        assert.notEqual(stored.rows[0].senha, body.senha);
        assert.equal(await bcrypt.compare(body.senha, stored.rows[0].senha), true);

        const duplicate = await invoke('/cadastro', {
            body: { ...body, usuario: `${body.usuario}_duplicate`, email: body.email.toLowerCase() }
        });
        assert.equal(duplicate.statusCode, 409);
        assert.match(duplicate.locals.mensagem_erro, /e-mail já está cadastrado/);

        // Check the DATABASE index itself, bypassing application normalization.
        await assert.rejects(db.query(
            'INSERT INTO public.usuarios (nome, usuario, senha, email) VALUES ($1, $2, $3, $4)',
            [body.nome, `${body.usuario}_index`, stored.rows[0].senha, body.email.toUpperCase()]
        ), error => error.code === '23505' && error.constraint === 'usuarios_email_unique');

        const noPhone = await invoke('/cadastro', {
            body: { ...body, usuario: `${body.usuario}_optional`, email: `optional-${marker}@example.invalid`, telefone: '' }
        });
        assert.equal(noPhone.statusCode, 200);
        const optional = await client.query('SELECT telefone FROM public.usuarios WHERE usuario = $1', [`${body.usuario}_optional`]);
        assert.equal(optional.rows[0].telefone, null);

        const loginRequest = {
            body: { usuario: body.usuario, senha: body.senha },
            session: {
                regenerate(callback) { callback(); },
                save(callback) { callback(); }
            }
        };
        const login = await invoke('/login', loginRequest);
        assert.equal(login.destination, '/');
        assert.equal(loginRequest.session.user.usuario, body.usuario);
    } finally {
        if (connected) {
            try { await client.query('ROLLBACK'); }
            finally { await client.end(); }
        } else {
            await client.end().catch(() => {});
        }
    }
});
