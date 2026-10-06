const express = require('express');
const router = express.Router();
const bd = require('../conexao');

// NUMERIC(12, 2): centésimos permanecem inteiros seguros no JavaScript.
const MAX_STOCK_CENTS = 999999999999;
const movementFields = ['tipo_movimentacao', 'data_movimentacao', 'quantidade', 'descricao', 'id_produto', 'id_usuario'];
const inputText = value => typeof value === 'string' ? value.trim() : '';
const validId = value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647;

function stockCents(value) {
    const text = String(value ?? '');
    if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
    const [integer, fraction = ''] = text.replace(/^-/, '').split('.');
    const cents = Number(integer) * 100 + Number(fraction.padEnd(2, '0'));
    return text.startsWith('-') ? -cents : cents;
}

function validMovementDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function currentMovementDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

async function renderMovementForm(req, res, { values, errors = {}, formError = '', status = 200, submitted = false, preselectedProduct = '' }) {
    let produtos = [];
    let usuarios = [];
    let loadError = '';
    try {
        const [productResult, userResult] = await Promise.all([
            bd.query('SELECT id_produto, nome, estoque, estoque_minimo FROM produtos ORDER BY nome ASC, id_produto ASC'),
            bd.query('SELECT id_usuario, usuario AS nome_usuario FROM usuarios ORDER BY usuario ASC, id_usuario ASC')
        ]);
        produtos = productResult.rows;
        usuarios = userResult.rows;
        if (preselectedProduct && produtos.some(produto => String(produto.id_produto) === preselectedProduct)) {
            values = { ...values, id_produto: preselectedProduct };
        }
    } catch (err) {
        console.error('Erro ao carregar opções de movimentação:', err.code || 'unknown');
        loadError = 'Não foi possível carregar os produtos e responsáveis. Tente novamente em instantes.';
        status = 503;
    }
    return res.status(status).render('nova_movimentacao', {
        mainClass: 'main-movement-form', produtos, usuarios,
        usuarioID: req.session.user.id_usuario, values, errors, formError, loadError, submitted
    });
}

router.get('/listar', async (req, res) => {
    const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
    const query = req.query || {};
    const requestedUser = text(query.usuario, 20);
    const requestedType = text(query.tipo, 20);
    const requestedOrder = text(query.ordem, 20);
    const orders = {
        recentes: 'm.data_movimentacao DESC NULLS LAST, m.id_movimentacao DESC',
        antigas: 'm.data_movimentacao ASC NULLS LAST, m.id_movimentacao ASC'
    };
    const filters = {
        q: text(query.q, 120),
        tipo: ['todos', 'entrada', 'saida', 'outros'].includes(requestedType) ? requestedType : 'todos',
        usuario: validId(requestedUser) ? String(Number(requestedUser)) : '',
        de: text(query.de, 40),
        ate: text(query.ate, 40),
        ordem: Object.hasOwn(orders, requestedOrder) ? requestedOrder : 'recentes'
    };
    const filterErrors = {};
    for (const field of ['de', 'ate']) {
        if ((query[field] !== undefined && typeof query[field] !== 'string') || (filters[field] && !validMovementDate(filters[field]))) {
            filterErrors[field] = 'Informe uma data válida no formato dia/mês/ano.';
        }
    }
    if (!filterErrors.de && !filterErrors.ate && filters.de && filters.ate && filters.de > filters.ate) {
        filterErrors.ate = 'A data final deve ser igual ou posterior à data inicial.';
    }
    const requestedPage = text(query.pagina, 20);
    const page = /^\d+$/.test(requestedPage) && Number.isSafeInteger(Number(requestedPage)) && Number(requestedPage) > 0 ? Number(requestedPage) : 1;
    const pagination = { page, pageSize: 20, total: 0, totalPages: 1 };
    const mensagem = text(query.mensagem, 300);
    const values = [];
    const conditions = [];
    if (filters.q) {
        values.push('%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%');
        conditions.push(`(p.nome ILIKE $${values.length} OR m.descricao ILIKE $${values.length} OR m.id_movimentacao::text ILIKE $${values.length})`);
    }
    if (filters.tipo === 'entrada' || filters.tipo === 'saida') {
        values.push(filters.tipo === 'entrada' ? 'Entrada' : 'Saída');
        conditions.push(`m.tipo_movimentacao = $${values.length}`);
    } else if (filters.tipo === 'outros') {
        conditions.push("(m.tipo_movimentacao IS NULL OR m.tipo_movimentacao NOT IN ('Entrada', 'Saída'))");
    }
    if (filters.usuario) {
        values.push(Number(filters.usuario));
        conditions.push(`m.id_usuario = $${values.length}`);
    }
    if (filters.de && !filterErrors.de) {
        values.push(filters.de);
        conditions.push(`m.data_movimentacao >= $${values.length}::date`);
    }
    if (filters.ate && !filterErrors.ate) {
        values.push(filters.ate);
        conditions.push(`m.data_movimentacao < ($${values.length}::date + interval '1 day')`);
    }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const joins = `FROM movimentacoes m
        LEFT JOIN produtos p ON m.id_produto = p.id_produto
        LEFT JOIN usuarios u ON m.id_usuario = u.id_usuario`;

    try {
        const users = await bd.query('SELECT id_usuario, usuario AS nome_usuario FROM usuarios ORDER BY usuario ASC, id_usuario ASC');
        const totals = await bd.query(`
            SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE tipo_movimentacao = 'Entrada') AS entries,
                COUNT(*) FILTER (WHERE tipo_movimentacao = 'Saída') AS exits,
                COUNT(*) FILTER (WHERE tipo_movimentacao IS NULL OR tipo_movimentacao NOT IN ('Entrada', 'Saída')) AS other
            FROM movimentacoes
        `);
        const totalsRow = totals.rows[0] || {};
        const summary = {
            total: Number(totalsRow.total || 0),
            entries: Number(totalsRow.entries || 0),
            exits: Number(totalsRow.exits || 0),
            other: Number(totalsRow.other || 0)
        };
        const locals = {
            mainClass: 'main-movements', movimentacoes: [], usuarios: users.rows,
            filters, filterErrors, pagination, summary, mensagem, listError: '',
            geradoEm: new Date().toISOString()
        };
        if (Object.keys(filterErrors).length) {
            pagination.page = 1;
            return res.status(400).render('movimentacao', locals);
        }

        const count = await bd.query('SELECT COUNT(*) AS total ' + joins + where, values);
        pagination.total = Number(count.rows[0]?.total || 0);
        pagination.totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
        pagination.page = Math.min(pagination.page, pagination.totalPages);
        // O banco guarda um timestamp sem fuso: não o converter para UTC.
        const result = await bd.query(`
            SELECT m.id_movimentacao, m.tipo_movimentacao,
                TO_CHAR(m.data_movimentacao, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_movimentacao,
                m.quantidade, m.descricao, m.id_produto, m.id_usuario,
                p.nome AS nome_produto, u.usuario AS nome_usuario
            ${joins}
            ${where}
            ORDER BY ${orders[filters.ordem]}
            LIMIT $${values.length + 1} OFFSET $${values.length + 2}
        `, [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
        return res.render('movimentacao', { ...locals, movimentacoes: result.rows });
    } catch (err) {
        console.error('Erro ao consultar movimentações:', err.code || 'unknown');
        return res.status(503).render('movimentacao', {
            mainClass: 'main-movements', movimentacoes: [], usuarios: [],
            filters, filterErrors,
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
            summary: null, mensagem: '', geradoEm: null,
            listError: 'Não foi possível consultar as movimentações. Tente novamente em instantes.'
        });
    }
});

//rota para a página de cadastro de movimentações
router.get('/nova_movimentacao', async (req, res) => {
    const usuarioID = req.session?.user?.id_usuario;
    if (!usuarioID) return res.status(401).send('Usuário não autenticado');
    const requestedProduct = inputText(req.query?.produto);
    return renderMovementForm(req, res, {
        preselectedProduct: validId(requestedProduct) ? String(Number(requestedProduct)) : '',
        values: {
            tipo_movimentacao: 'Entrada', data_movimentacao: currentMovementDate(),
            quantidade: '', descricao: '', id_produto: '', id_usuario: String(usuarioID)
        }
    });
});

router.post('/cadastro', async (req, res) => {
    if (!req.session?.user?.id_usuario) return res.status(401).send('Usuário não autenticado');
    const values = Object.fromEntries(movementFields.map(field => [field, inputText(req.body?.[field])]));
    const errors = {};
    if (!['Entrada', 'Saída'].includes(values.tipo_movimentacao)) errors.tipo_movimentacao = 'Escolha entrada ou saída.';
    if (!validMovementDate(values.data_movimentacao)) errors.data_movimentacao = 'Informe uma data válida.';
    const quantityCents = stockCents(values.quantidade);
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(values.quantidade) || quantityCents === null || quantityCents <= 0 || quantityCents > MAX_STOCK_CENTS) {
        errors.quantidade = 'Informe uma quantidade maior que zero, com até 2 casas decimais e no máximo 9.999.999.999,99.';
    }
    if (!validId(values.id_produto)) errors.id_produto = 'Selecione um produto.';
    if (!validId(values.id_usuario)) errors.id_usuario = 'Selecione um responsável.';
    if (values.descricao.length > 1000) errors.descricao = 'Use no máximo 1000 caracteres na observação.';
    if (Object.keys(errors).length) return renderMovementForm(req, res, { values, errors, status: 400, submitted: true });

    let client;
    let releaseError;
    let transactionStarted = false;
    let formError = '';
    try {
        client = await bd.connect();
        await client.query('BEGIN');
        transactionStarted = true;
        const productResult = await client.query('SELECT id_produto, estoque FROM produtos WHERE id_produto = $1 FOR UPDATE', [Number(values.id_produto)]);
        const userResult = await client.query('SELECT id_usuario FROM usuarios WHERE id_usuario = $1', [Number(values.id_usuario)]);
        if (!productResult.rows.length) errors.id_produto = 'Este produto não está mais disponível. Selecione outro.';
        if (!userResult.rows.length) errors.id_usuario = 'Este responsável não está mais disponível. Selecione outro.';
        if (productResult.rows.length) {
            const currentCents = stockCents(productResult.rows[0].estoque);
            if (currentCents === null) throw new Error('Invalid stored stock');
            const projectedCents = currentCents + (values.tipo_movimentacao === 'Entrada' ? quantityCents : -quantityCents);
            if (Math.abs(projectedCents) > MAX_STOCK_CENTS) {
                errors.quantidade = 'Esta quantidade ultrapassa o limite de saldo do produto. Informe um valor menor.';
            }
        }
        if (Object.keys(errors).length) {
            await client.query('ROLLBACK');
            transactionStarted = false;
        } else {
            await client.query(`
                INSERT INTO movimentacoes (tipo_movimentacao, data_movimentacao, quantidade, descricao, id_produto, id_usuario)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [values.tipo_movimentacao, values.data_movimentacao, values.quantidade, values.descricao || null, Number(values.id_produto), Number(values.id_usuario)]);
            // O mesmo client e o bloqueio do produto mantêm registro e saldo consistentes.
            const operation = values.tipo_movimentacao === 'Entrada' ? '+' : '-';
            await client.query(`UPDATE produtos SET estoque = estoque ${operation} $1 WHERE id_produto = $2`, [values.quantidade, Number(values.id_produto)]);
            await client.query('COMMIT');
            transactionStarted = false;
        }
    } catch (err) {
        releaseError = err;
        console.error('Erro ao cadastrar movimentação:', err.code || 'unknown');
        if (client && transactionStarted) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Erro ao desfazer movimentação:', rollbackError.code || 'unknown');
            }
        }
        formError = 'Não foi possível registrar a movimentação. Os dados foram mantidos; tente novamente em instantes.';
    } finally {
        if (client) client.release(releaseError);
    }
    if (formError || Object.keys(errors).length) return renderMovementForm(req, res, { values, errors, formError, status: formError ? 503 : 400, submitted: true });
    return res.redirect(`/movimentacoes/listar?mensagem=${encodeURIComponent('Movimentação cadastrada com sucesso!')}`);
});

router.get('/listar_estoque', async (req, res) => {
    const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
    const query = req.query || {};
    const category = text(query.categoria, 20);
    const orders = {
        nome: 'produtos.nome ASC, produtos.id_produto ASC',
        saldo: 'produtos.estoque ASC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        'saldo-desc': 'produtos.estoque DESC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        reposicao: 'CASE WHEN produtos.estoque IS NULL OR produtos.estoque_minimo IS NULL THEN NULL ELSE GREATEST(produtos.estoque_minimo - produtos.estoque, 0) END DESC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC'
    };
    const requestedOrder = text(query.ordem, 30);
    const requestedStatus = text(query.status, 30);
    const filters = {
        q: text(query.q, 120),
        categoria: validId(category) ? String(Number(category)) : '',
        status: ['todos', 'repor', 'zerado', 'negativo'].includes(requestedStatus) ? requestedStatus : 'todos',
        ordem: Object.hasOwn(orders, requestedOrder) ? requestedOrder : 'nome'
    };
    const requestedPage = text(query.pagina, 20);
    const page = /^\d+$/.test(requestedPage) && Number.isSafeInteger(Number(requestedPage)) && Number(requestedPage) > 0 ? Number(requestedPage) : 1;
    const pagination = { page, pageSize: 20, total: 0, totalPages: 1 };
    const mensagem = text(query.mensagem, 300);
    const values = [];
    const conditions = [];
    if (filters.q) {
        values.push('%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%');
        conditions.push(`(produtos.nome ILIKE $${values.length} OR produtos.id_produto::text ILIKE $${values.length})`);
    }
    if (filters.categoria) {
        values.push(Number(filters.categoria));
        conditions.push(`produtos.id_categoria = $${values.length}`);
    }
    if (filters.status === 'repor') conditions.push('produtos.estoque < produtos.estoque_minimo');
    if (filters.status === 'zerado') conditions.push('produtos.estoque = 0');
    if (filters.status === 'negativo') conditions.push('produtos.estoque < 0');
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

    try {
        const categories = await bd.query('SELECT id_categoria, nome FROM categorias ORDER BY nome ASC, id_categoria ASC');
        const totals = await bd.query(`
            SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE estoque < estoque_minimo) AS below_minimum,
                COUNT(*) FILTER (WHERE estoque = 0) AS zero,
                COUNT(*) FILTER (WHERE estoque < 0) AS negative
            FROM produtos
        `);
        const count = await bd.query('SELECT COUNT(*) AS total FROM produtos' + where, values);
        pagination.total = Number(count.rows[0]?.total || 0);
        pagination.totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
        pagination.page = Math.min(pagination.page, pagination.totalPages);
        // O saldo atual vem da mesma coluna atualizada pelo cadastro transacional.
        // Recalcular o histórico aqui divergiria dos ajustes e do saldo inicial.
        const result = await bd.query(`
            SELECT produtos.id_produto, produtos.nome, produtos.estoque, produtos.estoque_minimo,
                produtos.imagem, produtos.id_categoria, categorias.nome AS nome_categoria
            FROM produtos
            LEFT JOIN categorias ON produtos.id_categoria = categorias.id_categoria
            ${where}
            ORDER BY ${orders[filters.ordem]}
            LIMIT $${values.length + 1} OFFSET $${values.length + 2}
        `, [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
        const summary = totals.rows[0] || {};
        return res.render('estoque', {
            mainClass: 'main-stock', produtos: result.rows, categorias: categories.rows,
            filters, pagination, mensagem, stockError: '', geradoEm: new Date().toISOString(),
            summary: {
                total: Number(summary.total || 0),
                belowMinimum: Number(summary.below_minimum || 0),
                zero: Number(summary.zero || 0),
                negative: Number(summary.negative || 0)
            }
        });
    } catch (err) {
        console.error('Erro ao consultar estoque atual:', err.code || 'unknown');
        return res.status(503).render('estoque', {
            mainClass: 'main-stock', produtos: [], categorias: [], filters,
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
            summary: null, mensagem: '', geradoEm: null,
            stockError: 'Não foi possível consultar o estoque. Tente novamente em instantes.'
        });
    }
});

router.post('/pesquisar_estoque', (req, res) => {
    const pesquisa = typeof req.body?.pesquisa === 'string' ? req.body.pesquisa.trim().slice(0, 120) : '';
    return res.redirect(pesquisa ? '/movimentacoes/listar_estoque?q=' + encodeURIComponent(pesquisa) : '/movimentacoes/listar_estoque');
});

router.post('/pesquisar', (req, res) => {
    const pesquisa = typeof req.body?.pesquisa === 'string' ? req.body.pesquisa.trim().slice(0, 120) : '';
    return res.redirect(pesquisa ? '/movimentacoes/listar?q=' + encodeURIComponent(pesquisa) : '/movimentacoes/listar');
});

module.exports = router;
