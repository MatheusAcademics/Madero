const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const routeSource = fs.readFileSync(path.join(__dirname, '../routes/usuarios.js'), 'utf8');
const validBody = {
    nome: 'Ana Silva',
    usuario: 'ana',
    email: 'ana@example.com',
    telefone: '',
    senha: 'test-password-only',
    confirmar_senha: 'test-password-only'
};

// Load only the handlers. Neither PostgreSQL nor the real bcrypt module is loaded.
function createHarness({ hashError, queryError, rows = [], passwordMatches = true } = {}) {
    const handlers = new Map();
    const calls = { hashes: [], comparisons: [], queries: [], logs: [], errors: [] };
    const router = Object.fromEntries(['get', 'post'].map(method => [
        method,
        (route, handler) => handlers.set(`${method} ${route}`, handler)
    ]));
    const dependencies = {
        express: { Router: () => router },
        bcrypt: {
            async hash(...args) {
                calls.hashes.push(args);
                if (hashError) throw hashError;
                return 'mock-password-hash';
            },
            compareSync(...args) {
                calls.comparisons.push(args);
                return passwordMatches;
            }
        },
        '../conexao': {
            async query(sql, values) {
                calls.queries.push([sql, Array.from(values)]);
                if (queryError) throw queryError;
                return { rows };
            }
        }
    };

    vm.runInNewContext(routeSource, {
        module: { exports: {} }, Buffer,
        console: {
            log: (...args) => calls.logs.push(args),
            error: (...args) => calls.errors.push(args)
        },
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    }, { filename: 'routes/usuarios.js' });

    return {
        calls,
        async invoke(method, route, req = {}) {
            const res = {
                statusCode: 200,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                render(view, locals) {
                    this.view = view;
                    // Normalize objects created in the isolated VM realm.
                    this.locals = JSON.parse(JSON.stringify(locals));
                    return this;
                },
                redirect(destination) {
                    this.destination = destination;
                    return this;
                }
            };
            const handler = handlers.get(`${method} ${route}`);
            assert.equal(typeof handler, 'function');
            await handler(req, res);
            return res;
        }
    };
}

function assertRegistrationError(res, status, body) {
    assert.equal(res.statusCode, status);
    assert.equal(res.view, 'novo_usuario');
    assert.equal(res.locals.mainClass, 'main-login');
    assert.equal(res.locals.authPage, 'register');
    assert.ok(res.locals.mensagem_erro);
    assert.equal(res.locals.nome_digitado, typeof body?.nome === 'string' ? body.nome : '');
    assert.equal(res.locals.usuario_digitado, typeof body?.usuario === 'string' ? body.usuario : '');
    assert.equal(res.locals.email_digitado, typeof body?.email === 'string' ? body.email : '');
    assert.equal(res.locals.telefone_digitado, typeof body?.telefone === 'string' ? body.telefone : '');
    assert.equal(Object.hasOwn(res.locals, 'senha'), false);
    assert.equal(Object.hasOwn(res.locals, 'senha_digitada'), false);
    assert.equal(Object.hasOwn(res.locals, 'confirmar_senha'), false);
    assert.equal(JSON.stringify(res.locals).includes(validBody.senha), false);
    assert.equal(JSON.stringify(res.locals).includes('mock-password-hash'), false);
}

test('GET cadastro renders the authentication layout with empty field defaults', async () => {
    const harness = createHarness();
    const res = await harness.invoke('get', '/novo_usuario');
    assert.equal(res.statusCode, 200);
    assert.equal(res.view, 'novo_usuario');
    assert.deepEqual(res.locals, {
        mainClass: 'main-login',
        authPage: 'register',
        mensagem_erro: '',
        nome_digitado: '',
        usuario_digitado: '',
        email_digitado: '',
        telefone_digitado: '',
        values: { foto: '' }, errors: {}, foto_atual: '', foto_erro: '', uploadNotice: ''
    });
    assert.deepEqual(harness.calls.hashes, []);
    assert.deepEqual(harness.calls.queries, []);
});

test('invalid registration bodies preserve safe fields without hashing or querying', async t => {
    const invalidBodies = [
        ['missing body', undefined],
        ['null body', null],
        ['empty body', {}],
        ['empty name', { ...validBody, nome: '' }],
        ['blank name', { ...validBody, nome: '  ' }],
        ['array name', { ...validBody, nome: ['Ana'] }],
        ['numeric name', { ...validBody, nome: 10 }],
        ['empty username', { ...validBody, usuario: '' }],
        ['blank username', { ...validBody, usuario: '  ' }],
        ['object username', { ...validBody, usuario: {} }],
        ['array username', { ...validBody, usuario: ['ana'] }],
        ['empty password', { ...validBody, senha: '' }],
        ['array password', { ...validBody, senha: ['secret'] }],
        ['numeric password', { ...validBody, senha: 123 }],
        ['missing email', { ...validBody, email: undefined }],
        ['empty email', { ...validBody, email: '' }],
        ['blank email', { ...validBody, email: '   ' }],
        ['array email', { ...validBody, email: ['ana@example.com'] }],
        ['object email', { ...validBody, email: {} }],
        ['numeric email', { ...validBody, email: 42 }],
        ['email without domain', { ...validBody, email: 'ana@' }],
        ['email without local part', { ...validBody, email: '@example.com' }],
        ['email without at sign', { ...validBody, email: 'example.com' }],
        ['email with repeated at sign', { ...validBody, email: 'ana@@example.com' }],
        ['email without domain suffix', { ...validBody, email: 'ana@localhost' }],
        ['email with spaces', { ...validBody, email: 'ana silva@example.com' }],
        ['email with trailing local dot', { ...validBody, email: 'ana.@example.com' }],
        ['email with leading local dot', { ...validBody, email: '.ana@example.com' }],
        ['email with repeated local dots', { ...validBody, email: 'ana..silva@example.com' }],
        ['email with invalid domain label', { ...validBody, email: 'ana@-example.com' }],
        ['email with consecutive domain dots', { ...validBody, email: 'ana@example..com' }],
        ['email local part too long', { ...validBody, email: `${'a'.repeat(65)}@example.com` }],
        ['email too long', { ...validBody, email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com` }],
        ['null phone', { ...validBody, telefone: null }],
        ['array phone', { ...validBody, telefone: ['11999999999'] }],
        ['object phone', { ...validBody, telefone: {} }],
        ['numeric phone', { ...validBody, telefone: 11999999999 }],
        ['phone too short', { ...validBody, telefone: '999999999' }],
        ['phone too long', { ...validBody, telefone: '1'.repeat(16) }],
        ['phone with letters', { ...validBody, telefone: '11abc999999999' }],
        ['phone with internal plus', { ...validBody, telefone: '55+11999999999' }],
        ['phone with repeated plus', { ...validBody, telefone: '++5511999999999' }],
        ['phone without digits', { ...validBody, telefone: '() - .' }],
        ['missing confirmation', { ...validBody, confirmar_senha: undefined }],
        ['empty confirmation', { ...validBody, confirmar_senha: '' }],
        ['different confirmation', { ...validBody, confirmar_senha: 'another-password' }],
        ['confirmation not trimmed', { ...validBody, confirmar_senha: `${validBody.senha} ` }],
        ['array confirmation', { ...validBody, confirmar_senha: [validBody.senha] }],
        ['object confirmation', { ...validBody, confirmar_senha: {} }],
        ['numeric confirmation', { ...validBody, confirmar_senha: 123 }]
    ];

    for (const [label, body] of invalidBodies) {
        await t.test(label, async () => {
            const harness = createHarness();
            const res = await harness.invoke('post', '/cadastro', { body });
            assertRegistrationError(res, 400, body);
            assert.deepEqual(harness.calls.hashes, []);
            assert.deepEqual(harness.calls.queries, []);
            assert.deepEqual(harness.calls.logs, []);
            assert.deepEqual(harness.calls.errors, []);
        });
    }
});

test('successful registration keeps bcrypt cost, parameterized SQL and login confirmation', async () => {
    const harness = createHarness();
    const res = await harness.invoke('post', '/cadastro', { body: validBody });
    assert.deepEqual(harness.calls.hashes, [[validBody.senha, 10]]);
    assert.deepEqual(harness.calls.queries, [[
        'INSERT INTO usuarios (usuario, nome, senha, email, telefone) VALUES ($1, $2, $3, $4, $5)',
        [validBody.usuario, validBody.nome, 'mock-password-hash', validBody.email, null]
    ]]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.view, 'login');
    assert.equal(res.locals.mainClass, 'main-login');
    assert.equal(res.locals.usuario_digitado, validBody.usuario);
    assert.ok(res.locals.mensagem_sucesso);
    assert.equal(res.locals.mensagem_erro, '');
    assert.equal(JSON.stringify(res.locals).includes(validBody.senha), false);
    assert.equal(JSON.stringify(res.locals).includes('mock-password-hash'), false);
    assert.deepEqual(harness.calls.logs, []);
    assert.deepEqual(harness.calls.errors, []);
});

test('duplicate username renders friendly 409 feedback without losing name or username', async () => {
    const queryError = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'usuarios_usuario_key' });
    const harness = createHarness({ queryError });
    const res = await harness.invoke('post', '/cadastro', { body: validBody });
    assertRegistrationError(res, 409, validBody);
    assert.match(res.locals.mensagem_erro, /já está em uso/);
    assert.equal(harness.calls.queries.length, 1);
});

test('email duplicates are handled separately and preserve safe contact fields', async () => {
    const queryError = Object.assign(new Error('duplicate key with private values'), {
        code: '23505',
        constraint: 'usuarios_email_unique'
    });
    const body = { ...validBody, email: ' ANA@EXAMPLE.COM ', telefone: '+55 (11) 99999-9999' };
    const harness = createHarness({ queryError });
    const res = await harness.invoke('post', '/cadastro', { body });
    assertRegistrationError(res, 409, body);
    assert.match(res.locals.mensagem_erro, /e-mail já está cadastrado/);
    assert.equal(harness.calls.queries[0][1][3], 'ana@example.com');
    assert.equal(harness.calls.queries[0][1][4], '+5511999999999');
    assert.deepEqual(harness.calls.logs, []);
    assert.deepEqual(harness.calls.errors, []);
});

test('email is normalized while supported contact formats are parameterized', async t => {
    const bodies = [
        ['omitted phone', { ...validBody, telefone: undefined }, null],
        ['blank phone', { ...validBody, telefone: '   ' }, null],
        ['Brazilian mobile', { ...validBody, telefone: '(11) 99999-9999' }, '11999999999'],
        ['Brazilian landline', { ...validBody, telefone: '(11) 3333-4444' }, '1133334444'],
        ['international phone', { ...validBody, telefone: ' +1 (212) 555-0123 ' }, '+12125550123'],
        ['dotted phone', { ...validBody, telefone: '11.99999.9999' }, '11999999999'],
        ['tagged email', { ...validBody, email: ' Ana.Silva+Equipe@EXAMPLE.COM.BR ' }, null]
    ];
    for (const [label, body, phone] of bodies) {
        await t.test(label, async () => {
            const harness = createHarness();
            const res = await harness.invoke('post', '/cadastro', { body });
            assert.equal(res.view, 'login');
            assert.equal(res.statusCode, 200);
            const [sql, values] = harness.calls.queries[0];
            assert.equal(values[3], body.email.trim().toLowerCase());
            assert.equal(values[4], phone);
            assert.equal(values.length, 5);
            assert.equal(sql.includes('confirmar_senha'), false);
            assert.equal(values.includes(body.senha), false);
        });
    }
});

test('database failure renders generic 500 feedback and preserves entered fields', async () => {
    const harness = createHarness({ queryError: new Error('private database diagnostic') });
    const res = await harness.invoke('post', '/cadastro', { body: validBody });
    assertRegistrationError(res, 500, validBody);
    assert.equal(res.locals.mensagem_erro.includes('private database diagnostic'), false);
    assert.equal(harness.calls.queries.length, 1);
    assert.equal(harness.calls.errors.length, 1);
    assert.equal(JSON.stringify(harness.calls.errors).includes('private database diagnostic'), false);
});

test('hash failure is caught before querying and renders registration feedback', async () => {
    const harness = createHarness({ hashError: new Error('private hashing diagnostic') });
    const res = await harness.invoke('post', '/cadastro', { body: validBody });
    assertRegistrationError(res, 500, validBody);
    assert.equal(res.locals.mensagem_erro.includes('private hashing diagnostic'), false);
    assert.equal(harness.calls.hashes.length, 1);
    assert.deepEqual(harness.calls.queries, []);
    assert.equal(harness.calls.errors.length, 1);
    assert.equal(JSON.stringify(harness.calls.errors).includes('private hashing diagnostic'), false);
});

test('existing users without email or phone can still log in normally', async () => {
    const previousUser = { id_usuario: 1, usuario: 'ana', senha: 'old-hash', email: null, telefone: null };
    const harness = createHarness({ rows: [previousUser] });
    const events = [];
    const session = {
        regenerate(done) {
            events.push('regenerate');
            done();
        },
        save(done) {
            events.push('save');
            done();
        }
    };
    const res = await harness.invoke('post', '/login', {
        body: { usuario: validBody.usuario, senha: validBody.senha },
        session
    });
    assert.equal(res.destination, '/');
    assert.deepEqual(harness.calls.queries, [['SELECT * FROM usuarios WHERE usuario = $1', ['ana']]]);
    assert.deepEqual(harness.calls.comparisons, [[validBody.senha, 'old-hash']]);
    assert.deepEqual(events, ['regenerate', 'save']);
    assert.deepEqual(JSON.parse(JSON.stringify(session.user)), { id_usuario: 1, usuario: 'ana', nome: '', foto: '' });
    assert.deepEqual(harness.calls.hashes, []);
});

test('passwords and user payloads are not logged during account updates', () => {
    const alterRoute = routeSource.slice(routeSource.indexOf("router.post('/alterar/:id_usuario'"));
    assert.doesNotMatch(alterRoute, /console\.log\((?:senha|nome|usuario|id_usuario)\)/);
});

test('public registration limits match internal names and bcrypt UTF-8 byte limit', async () => {
    for (const body of [
        { ...validBody, nome: 'n'.repeat(101) },
        { ...validBody, usuario: 'u'.repeat(101) },
        { ...validBody, senha: 'é'.repeat(37), confirmar_senha: 'é'.repeat(37) },
        { ...validBody, telefone: '11' + ' '.repeat(41) + '999999999' }
    ]) {
        const harness = createHarness();
        const res = await harness.invoke('post', '/cadastro', { body });
        assert.equal(res.statusCode, 400);
        assert.equal(harness.calls.hashes.length, 0);
        assert.equal(harness.calls.queries.length, 0);
    }
    const harness = createHarness();
    const body = { ...validBody, senha: 'é'.repeat(36), confirmar_senha: 'é'.repeat(36) };
    assert.equal((await harness.invoke('post', '/cadastro', { body })).view, 'login');
});
