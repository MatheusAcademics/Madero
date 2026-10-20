const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const bd = require('../conexao');
const receiveUserImage = (req, res) => req.is?.('multipart/form-data')
    ? require('../lib/user-images').receive(req, res) : { file: null, error: '' };
const storeUserImage = file => require('../lib/user-images').store(file);
const safeUserPhoto = value => typeof value === 'string'
    && /^\/uploads\/avatars\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(value) ? value : '';
const imageReselectNotice = 'Selecione a foto novamente antes de salvar. Os demais dados foram mantidos.';

function renderLogin(res, status = 200, dados = {}) {
    return res.status(status).render('login', {
        mainClass: 'main-login',
        mensagem_sucesso: '',
        mensagem_erro: '',
        mensagem_info: '',
        usuario_digitado: '',
        ...dados
    });
}

function renderCadastro(res, status = 200, dados = {}) {
    return res.status(status).render('novo_usuario', {
        mainClass: 'main-login',
        authPage: 'register',
        mensagem_erro: '',
        nome_digitado: '',
        usuario_digitado: '',
        email_digitado: '',
        telefone_digitado: '',
        values: { foto: '' }, errors: {}, foto_atual: '', foto_erro: '', uploadNotice: '',
        ...dados
    });
}

function emailValido(email) {
    if (email.length > 254) return false;
    const partes = email.split('@');
    if (partes.length !== 2) return false;
    const [local, dominio] = partes;
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
    const segmentos = dominio.split('.');
    return segmentos.length >= 2 && segmentos.every(segmento =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(segmento)
    );
}

function telefoneValido(telefone) {
    if (!telefone) return true;
    return /^\+?[\d\s().-]+$/.test(telefone) && /^\d{10,15}$/.test(telefone.replace(/\D/g, ''));
}

// rota para a página de login
router.get('/login', (req, res) => {
    const mensagem = typeof req.query.mensagem === 'string'
        ? req.query.mensagem.trim().slice(0, 240)
        : '';

    return renderLogin(res, 200, { mensagem_info: mensagem });
});

// rota para processar o login
router.post('/login', async (req, res) => {
    const { usuario, senha } = req.body || {};
    const usuarioDigitado = typeof usuario === 'string' ? usuario : '';

    if (typeof usuario !== 'string' || !usuario.trim() || typeof senha !== 'string' || !senha.length) {
        return renderLogin(res, 400, {
            mensagem_erro: 'Informe seu usuário e sua senha para entrar.',
            usuario_digitado: usuarioDigitado
        });
    }

    try {
        const resultado = await bd.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);
        const usuarioSel = resultado.rows[0];

        if (!usuarioSel || !usuarioSel.senha || !bcrypt.compareSync(senha, usuarioSel.senha)) {
            return renderLogin(res, 401, {
                mensagem_erro: 'Usuário ou senha inválidos.',
                usuario_digitado: usuarioDigitado
            });
        }

        await new Promise((resolve, reject) => {
            req.session.regenerate((err) => err ? reject(err) : resolve());
        });
        req.session.user = {
            id_usuario: usuarioSel.id_usuario,
            usuario: usuarioSel.usuario,
            nome: typeof usuarioSel.nome === 'string' ? usuarioSel.nome : '',
            foto: safeUserPhoto(usuarioSel.foto)
        };

        try {
            // Só redireciona depois que a sessão foi persistida com sucesso.
            await new Promise((resolve, reject) => {
                req.session.save((err) => err ? reject(err) : resolve());
            });
        } catch (err) {
            delete req.session.user;
            throw err;
        }

        return res.redirect('/');
    } catch (err) {
        console.error('Não foi possível concluir o login.');
        return renderLogin(res, 500, {
            mensagem_erro: 'Não foi possível entrar agora. Tente novamente em instantes.',
            usuario_digitado: usuarioDigitado
        });
    }
});

// rota para a página de cadastro
router.get('/novo_usuario', (req, res) => {
    return renderCadastro(res);
});

// rota para efetuar o cadastro
router.post('/cadastro', async (req, res) => {
    const upload = await receiveUserImage(req, res);
    const { usuario, nome, email, telefone, senha, confirmar_senha } = req.body || {};
    const dadosDigitados = {
        nome_digitado: typeof nome === 'string' ? nome : '',
        usuario_digitado: typeof usuario === 'string' ? usuario : '',
        email_digitado: typeof email === 'string' ? email : '',
        telefone_digitado: typeof telefone === 'string' ? telefone : '',
        uploadNotice: upload.file ? imageReselectNotice : ''
    };

    if (upload.error) return renderCadastro(res, 400, {
        ...dadosDigitados, errors: { foto_arquivo: upload.error }, foto_erro: upload.error, mensagem_erro: upload.error
    });

    if (typeof nome !== 'string' || !nome.trim() ||
        typeof usuario !== 'string' || !usuario.trim() ||
        typeof senha !== 'string' || !senha.length) {
        return renderCadastro(res, 400, {
            ...dadosDigitados,
            mensagem_erro: 'Informe seu nome, usuário e senha para criar sua conta.'
        });
    }

    if (nome.trim().length > 100 || usuario.trim().length > 100) return renderCadastro(res, 400, {
        ...dadosDigitados, mensagem_erro: 'Use no máximo 100 caracteres para o nome e para o usuário.'
    });
    if (Buffer.byteLength(senha, 'utf8') > 72) return renderCadastro(res, 400, {
        ...dadosDigitados, mensagem_erro: 'A senha é longa demais. Use até 72 bytes em UTF-8.'
    });

    const emailNormalizado = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!emailValido(emailNormalizado)) {
        return renderCadastro(res, 400, {
            ...dadosDigitados,
            mensagem_erro: 'Informe um e-mail válido para criar sua conta.'
        });
    }

    const telefoneDigitado = typeof telefone === 'string' ? telefone.trim() : '';
    if ((telefone !== undefined && typeof telefone !== 'string') || telefoneDigitado.length > 40 || !telefoneValido(telefoneDigitado)) {
        return renderCadastro(res, 400, {
            ...dadosDigitados,
            mensagem_erro: 'Informe um telefone com 10 a 15 dígitos ou deixe o campo em branco.'
        });
    }

    if (typeof confirmar_senha !== 'string' || !confirmar_senha.length || confirmar_senha !== senha) {
        return renderCadastro(res, 400, {
            ...dadosDigitados,
            mensagem_erro: 'A confirmação precisa ser igual à senha informada.'
        });
    }

    const telefoneNormalizado = telefoneDigitado
        ? `${telefoneDigitado.startsWith('+') ? '+' : ''}${telefoneDigitado.replace(/\D/g, '')}`
        : null;

    try {
        const saltRounds = 10;
        const senhaCrypto = await bcrypt.hash(senha, saltRounds);
        const parameters = [usuario, nome, senhaCrypto, emailNormalizado, telefoneNormalizado];
        let photoColumn = '', photoValue = '';
        if (upload.file) {
            const photo = await storeUserImage(upload.file);
            parameters.push(photo);
            photoColumn = ', foto'; photoValue = ', $6';
            dadosDigitados.values = { foto: photo };
            dadosDigitados.foto_atual = photo;
        }
        await bd.query(`INSERT INTO usuarios (usuario, nome, senha, email, telefone${photoColumn}) VALUES ($1, $2, $3, $4, $5${photoValue})`, parameters);
        return renderLogin(res, 200, {
            mensagem_sucesso: 'Usuário criado com sucesso!!!',
            usuario_digitado: typeof usuario === 'string' ? usuario : ''
        });
    } catch (err) {
        if (err.code === 'USER_IMAGE_INVALID') return renderCadastro(res, 400, {
            ...dadosDigitados, errors: { foto_arquivo: err.message }, foto_erro: err.message, mensagem_erro: err.message
        });
        if (err.code === '23505') {
            return renderCadastro(res, 409, {
                ...dadosDigitados,
                mensagem_erro: err.constraint === 'usuarios_email_unique'
                    ? 'Este e-mail já está cadastrado. Entre com sua conta ou use outro e-mail.'
                    : 'Este usuário já está em uso. Escolha outro para continuar.'
            });
        }

        // Erros do PostgreSQL podem conter valores enviados; não registre dados pessoais nem senhas.
        console.error('Não foi possível concluir o cadastro.');
        return renderCadastro(res, 500, {
            ...dadosDigitados,
            mensagem_erro: 'Não foi possível criar sua conta agora. Tente novamente em instantes.'
        });
    }
});

// Área interna: os endpoints públicos de autenticação acima permanecem independentes.
const workspaceUserText = (value, max = Infinity) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const workspaceUserId = value => {
    if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) return '';
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? String(id) : '';
};
const currentWorkspaceUser = req => workspaceUserId(req.session?.user?.id_usuario);

router.get('/minha-conta/excluir', (req, res) => {
    if (!currentWorkspaceUser(req)) return res.redirect('/usuarios/login');
    res.setHeader('Cache-Control', 'no-store');
    return res.render('excluir_conta', { isDeletingAccount: true, mainClass: 'main-user-form', formError: '' });
});

router.post('/minha-conta/excluir', async (req, res) => {
    const id = currentWorkspaceUser(req);
    if (!id) return res.redirect('/usuarios/login');
    res.setHeader('Cache-Control', 'no-store');
    try {
        await require('../lib/delete-account').deleteAccount(bd, Number(id), req.body?.senha_atual,
            req.body?.confirmacao, photo => require('../lib/user-images').remove(photo));
    } catch (error) {
        const { AccountDeletionError } = require('../lib/delete-account');
        return res.status(error instanceof AccountDeletionError ? error.status : 503).render('excluir_conta', {
            isDeletingAccount: true, mainClass: 'main-user-form', formError: error instanceof AccountDeletionError ? error.message
                : 'Não foi possível excluir sua conta. Tente novamente em instantes.'
        });
    }
    // Invalidate the current in-memory session too; the transaction revoked all stored sessions.
    return req.session.destroy(error => {
        if (error) return res.status(503).send('Conta excluída. Feche esta janela e entre novamente se necessário.');
        const config = require('../lib/runtime-config').loadRuntimeConfig();
        res.clearCookie(config.sessionName, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.production });
        return res.redirect('/usuarios/login?mensagem=' + encodeURIComponent('Sua conta foi excluída.'));
    });
});
const safeUserColumns = 'id_usuario, nome, usuario, email, telefone, foto';
const safeUserValues = body => Object.fromEntries(['nome', 'usuario', 'email', 'telefone'].map(key => [key, workspaceUserText(body?.[key])]));
const userNotices = Object.freeze({
    criado: ['success', 'Usuário cadastrado com sucesso!'],
    alterado: ['success', 'Usuário atualizado com sucesso!'],
    excluido: ['success', 'Usuário excluído com sucesso!'],
    'propria-conta': ['error', 'Você não pode excluir a conta que está usando.'],
    'em-uso': ['error', 'Este usuário tem registros vinculados. Seu histórico deve ser preservado.'],
    'nao-encontrado': ['error', 'O usuário não foi encontrado. Ele pode já ter sido excluído.'],
    falha: ['error', 'Não foi possível excluir o usuário. Tente novamente em instantes.'],
    sessao: ['error', 'Usuário atualizado. Não foi possível atualizar sua sessão; saia e entre novamente.']
});

function renderWorkspaceUser(res, status, isEditing, recordId, options = {}) {
    return res.status(status).render(isEditing ? 'alterar_usuario' : 'usuario_form', {
        mainClass: 'main-user-form', isEditing, recordId,
        values: { nome: '', usuario: '', email: '', telefone: '', foto: '' },
        errors: {}, formError: '', loadError: '', notFound: false, submitted: false, uploadNotice: '',
        ...options
    });
}

function validateWorkspaceUser(body, isEditing) {
    const values = safeUserValues(body);
    const errors = {};
    for (const key of ['nome', 'usuario']) {
        if (!values[key]) errors[key] = key === 'nome' ? 'Informe o nome.' : 'Informe o usuário de acesso.';
        else if (values[key].length > 100) errors[key] = 'Use no máximo 100 caracteres.';
    }
    if (!emailValido(values.email.toLowerCase())) errors.email = 'Informe um e-mail válido, com até 254 caracteres.';
    if ((body?.telefone !== undefined && typeof body.telefone !== 'string') || values.telefone.length > 40 || !telefoneValido(values.telefone)) {
        errors.telefone = 'Informe um telefone com 10 a 15 dígitos ou deixe em branco.';
    }
    const password = typeof body?.senha === 'string' ? body.senha : '';
    const confirmation = typeof body?.confirmar_senha === 'string' ? body.confirmar_senha : '';
    const changingPassword = !isEditing || Boolean(password || confirmation)
        || (body?.senha !== undefined && typeof body.senha !== 'string')
        || (body?.confirmar_senha !== undefined && typeof body.confirmar_senha !== 'string');
    if (changingPassword) {
        if (!password.length) errors.senha = 'Informe a senha.';
        else if (Buffer.byteLength(password, 'utf8') > 72) errors.senha = 'A senha é longa demais. Use até 72 bytes em UTF-8.';
        if (!confirmation || confirmation !== password) errors.confirmar_senha = 'A confirmação precisa ser igual à senha.';
    }
    return { values, errors, password, changingPassword };
}

function userWriteError(err) {
    if (err.code === 'USER_IMAGE_INVALID') return { status: 400, errors: { foto_arquivo: err.message } };
    if (err.code === '23505') {
        if (err.constraint === 'usuarios_email_unique') return { status: 409, errors: { email: 'Este e-mail já está cadastrado.' } };
        if (err.constraint === 'usuarios_usuario_key') return { status: 409, errors: { usuario: 'Este usuário já está em uso.' } };
        return { status: 409, formError: 'Já existe um cadastro com estes dados. Confira o usuário e o e-mail.' };
    }
    console.error('Erro ao salvar usuário:', err.code || 'unknown');
    return { status: 503, formError: 'Não foi possível salvar o usuário. Seus dados foram mantidos; tente novamente em instantes.' };
}

router.get('/listar', async (req, res) => {
    const currentUserId = currentWorkspaceUser(req);
    if (!currentUserId) return res.redirect('/usuarios/login');
    const query = req.query || {};
    const orders = {
        nome: 'u.nome ASC NULLS LAST, u.id_usuario ASC',
        usuario: 'u.usuario ASC NULLS LAST, u.id_usuario ASC',
        recentes: 'u.id_usuario DESC'
    };
    const filters = {
        q: workspaceUserText(query.q, 120),
        ordem: typeof query.ordem === 'string' && Object.hasOwn(orders, query.ordem) ? query.ordem : 'nome'
    };
    const notice = typeof query.aviso === 'string' && Object.hasOwn(userNotices, query.aviso) ? userNotices[query.aviso] : ['success', ''];
    const rawPage = typeof query.pagina === 'string' && /^\d+$/.test(query.pagina) ? Number(query.pagina) : 1;
    const requestedPage = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const pageSize = 20;
    const base = {
        mainClass: 'main-users', usuarios: [], filters, currentUserId,
        pagination: { page: requestedPage, pageSize, total: 0, totalPages: 1 },
        summary: null, mensagem: notice[1], noticeType: notice[0], usersError: null
    };
    const parameters = [];
    let where = '';
    if (filters.q) {
        parameters.push('%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%');
        where = ' WHERE (u.nome ILIKE $1 OR u.usuario ILIKE $1 OR u.email ILIKE $1 OR u.id_usuario::text ILIKE $1)';
    }
    try {
        const totals = await bd.query('SELECT COUNT(*) AS total FROM usuarios');
        const count = await bd.query('SELECT COUNT(*) AS total FROM usuarios u' + where, parameters);
        const total = Number(count.rows[0].total);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(requestedPage, totalPages);
        const rows = await bd.query(`SELECT u.id_usuario, u.nome, u.usuario, u.email, u.telefone, u.foto,
            (SELECT COUNT(*) FROM movimentacoes m WHERE m.id_usuario = u.id_usuario) AS total_movimentacoes
            FROM usuarios u${where} ORDER BY ${orders[filters.ordem]}
            LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
            [...parameters, pageSize, (page - 1) * pageSize]);
        const usuarios = rows.rows.map(row => ({
            id_usuario: row.id_usuario, nome: row.nome, usuario: row.usuario,
            email: row.email, telefone: row.telefone, foto: safeUserPhoto(row.foto), total_movimentacoes: row.total_movimentacoes
        }));
        return res.render('usuario', { ...base, usuarios, summary: { total: Number(totals.rows[0].total) },
            pagination: { page, pageSize, total, totalPages } });
    } catch (err) {
        console.error('Erro ao listar usuários:', err.code || 'unknown');
        return res.status(503).render('usuario', {
            ...base, mensagem: '', noticeType: 'error',
            usersError: 'Não foi possível carregar os usuários. Tente novamente em instantes.'
        });
    }
});

router.post('/pesquisar', (req, res) => {
    if (!currentWorkspaceUser(req)) return res.redirect('/usuarios/login');
    const q = workspaceUserText(req.body?.pesquisa, 120);
    return res.redirect('/usuarios/listar' + (q ? '?q=' + encodeURIComponent(q) : ''));
});

router.get('/novo', (req, res) => {
    if (!currentWorkspaceUser(req)) return res.redirect('/usuarios/login');
    return renderWorkspaceUser(res, 200, false, '');
});

router.post('/criar', async (req, res) => {
    if (!currentWorkspaceUser(req)) return res.redirect('/usuarios/login');
    const upload = await receiveUserImage(req, res);
    const { values, errors, password } = validateWorkspaceUser(req.body, false);
    values.foto = '';
    const uploadNotice = upload.file ? imageReselectNotice : '';
    if (upload.error) errors.foto_arquivo = upload.error;
    if (Object.keys(errors).length) return renderWorkspaceUser(res, 400, false, '', { values, errors, uploadNotice, submitted: true });
    try {
        const hash = await bcrypt.hash(password, 10);
        const phone = values.telefone ? (values.telefone.startsWith('+') ? '+' : '') + values.telefone.replace(/\D/g, '') : null;
        const parameters = [values.nome, values.usuario, values.email.toLowerCase(), phone, hash];
        let photoColumn = '', photoValue = '';
        if (upload.file) {
            values.foto = await storeUserImage(upload.file);
            parameters.push(values.foto);
            photoColumn = ', foto'; photoValue = ', $6';
        }
        await bd.query(`INSERT INTO usuarios (nome, usuario, email, telefone, senha${photoColumn})
            VALUES ($1, $2, $3, $4, $5${photoValue}) RETURNING ${safeUserColumns}`, parameters);
        return res.redirect('/usuarios/listar?aviso=criado');
    } catch (err) {
        const { status, ...feedback } = userWriteError(err);
        return renderWorkspaceUser(res, status, false, '', { values, ...feedback, uploadNotice, submitted: true });
    }
});

router.get('/alterar/:id_usuario', async (req, res) => {
    if (!currentWorkspaceUser(req)) return res.redirect('/usuarios/login');
    const recordId = workspaceUserId(req.params?.id_usuario);
    if (!recordId) return renderWorkspaceUser(res, 404, true, '', { notFound: true });
    try {
        const record = await bd.query(`SELECT ${safeUserColumns} FROM usuarios WHERE id_usuario = $1`, [Number(recordId)]);
        if (!record.rows.length) return renderWorkspaceUser(res, 404, true, recordId, { notFound: true });
        return renderWorkspaceUser(res, 200, true, recordId, {
            values: { ...safeUserValues(record.rows[0]), foto: safeUserPhoto(record.rows[0].foto) }
        });
    } catch (err) {
        console.error('Erro ao carregar usuário:', err.code || 'unknown');
        return renderWorkspaceUser(res, 503, true, recordId, { loadError: 'Não foi possível carregar o usuário. Tente novamente em instantes.' });
    }
});

router.post('/alterar/:id_usuario', async (req, res) => {
    const currentUserId = currentWorkspaceUser(req);
    if (!currentUserId) return res.redirect('/usuarios/login');
    const recordId = workspaceUserId(req.params?.id_usuario);
    if (!recordId) return renderWorkspaceUser(res, 404, true, '', { notFound: true, submitted: true });
    const upload = await receiveUserImage(req, res);
    const { values, errors, password, changingPassword } = validateWorkspaceUser(req.body, true);
    values.foto = '';
    const uploadNotice = upload.file ? imageReselectNotice : '';
    if (upload.error) errors.foto_arquivo = upload.error;
    try {
        if (req.body?.remover_foto === '1' && !upload.file) values.remover_foto = '1';
        // Para novos formulários multipart, a foto atual vem do banco, nunca de um campo oculto.
        // A leitura também evita gravar arquivos para um cadastro que já foi excluído.
        if (req.is?.('multipart/form-data')) {
            const record = await bd.query(`SELECT ${safeUserColumns} FROM usuarios WHERE id_usuario = $1`, [Number(recordId)]);
            if (!record.rows.length) return renderWorkspaceUser(res, 404, true, recordId, { values, notFound: true, submitted: true });
            values.foto = safeUserPhoto(record.rows[0].foto);
        }
        if (Object.keys(errors).length) return renderWorkspaceUser(res, 400, true, recordId, { values, errors, uploadNotice, submitted: true });
        const phone = values.telefone ? (values.telefone.startsWith('+') ? '+' : '') + values.telefone.replace(/\D/g, '') : null;
        const parameters = [values.nome, values.usuario, values.email.toLowerCase(), phone];
        let passwordClause = '';
        if (changingPassword) {
            parameters.push(await bcrypt.hash(password, 10));
            passwordClause = ', senha = $5';
        }
        let photoClause = '';
        if (upload.file || req.body?.remover_foto === '1') {
            const photo = upload.file ? await storeUserImage(upload.file) : null;
            parameters.push(photo);
            photoClause = ', foto = $' + parameters.length;
        }
        parameters.push(Number(recordId));
        const result = await bd.query(`UPDATE usuarios SET nome = $1, usuario = $2, email = $3, telefone = $4${passwordClause}${photoClause}
            WHERE id_usuario = $${parameters.length} AND senha <> '' RETURNING ${safeUserColumns}`, parameters);
        if (!result.rows.length) return renderWorkspaceUser(res, 404, true, recordId, { values, notFound: true, submitted: true });
        if (currentUserId === recordId) {
            req.session.user.usuario = result.rows[0].usuario;
            req.session.user.nome = typeof result.rows[0].nome === 'string' ? result.rows[0].nome : '';
            req.session.user.foto = safeUserPhoto(result.rows[0].foto);
            if (typeof req.session.save === 'function') {
                try {
                    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
                } catch (err) {
                    console.error('Usuário salvo; erro ao atualizar sessão.');
                    return res.redirect('/usuarios/listar?aviso=sessao');
                }
            }
        }
        return res.redirect('/usuarios/listar?aviso=alterado');
    } catch (err) {
        const { status, ...feedback } = userWriteError(err);
        return renderWorkspaceUser(res, status, true, recordId, { values, ...feedback, uploadNotice, submitted: true });
    }
});

router.post('/excluir/:id_usuario', async (req, res) => {
    const currentUserId = currentWorkspaceUser(req);
    if (!currentUserId) return res.redirect('/usuarios/login');
    const recordId = workspaceUserId(req.params?.id_usuario);
    const redirectNotice = code => res.redirect('/usuarios/listar?aviso=' + code);
    if (!recordId) return redirectNotice('nao-encontrado');
    if (recordId === currentUserId) return redirectNotice('propria-conta');
    try {
        const deleted = await bd.query(`DELETE FROM usuarios u WHERE u.id_usuario = $1
            AND NOT EXISTS (SELECT 1 FROM movimentacoes m WHERE m.id_usuario = u.id_usuario)
            RETURNING u.id_usuario`, [Number(recordId)]);
        if (!deleted.rows.length) {
            const remaining = await bd.query('SELECT EXISTS (SELECT 1 FROM usuarios WHERE id_usuario = $1) AS user_exists', [Number(recordId)]);
            return redirectNotice(remaining.rows[0]?.user_exists ? 'em-uso' : 'nao-encontrado');
        }
        return redirectNotice('excluido');
    } catch (err) {
        if (err.code === '23503') return redirectNotice('em-uso');
        console.error('Erro ao excluir usuário:', err.code || 'unknown');
        return redirectNotice('falha');
    }
});

module.exports = router;
