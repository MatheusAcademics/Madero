const express = require('express');
const router = express.Router();
const bd = require('../conexao');

// As quatro colunas numéricas envolvidas no cadastro são NUMERIC(12, 2).
const productFields = ['nome', 'estoque', 'estoque_minimo', 'valor', 'imagem', 'id_categoria'];
const productText = value => typeof value === 'string' ? value.trim() : '';
const productId = value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647;
const categoryOptionsQuery = 'SELECT id_categoria, nome FROM categorias ORDER BY nome ASC, id_categoria ASC';
const receiveProductImage = (req, res) => req.is?.('multipart/form-data')
    ? require('../lib/product-images').receive(req, res) : { file: null, error: '' };
const storeProductImage = file => require('../lib/product-images').store(file);

function productDecimal(value) {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
    const [rawInteger, fraction] = value.replace(',', '.').split('.');
    const integer = rawInteger.replace(/^0+(?=\d)/, '');
    if (integer.length > 10) return null;
    return fraction === undefined ? integer : integer + '.' + fraction;
}

function validProductImage(value) {
    if (!value) return true;
    if (value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { return false; }
    if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return false;
    if (value.startsWith('/')) return !value.startsWith('//') && !decoded.startsWith('//');
    try {
        const image = new URL(value);
        return ['http:', 'https:'].includes(image.protocol) && /^https?:\/\//i.test(value)
            && Boolean(image.hostname) && !image.username && !image.password;
    } catch {
        return false;
    }
}

async function renderProductForm(res, { values, errors = {}, formError = '', status = 200, submitted = false, preselectedCategory = '', uploadNotice = '' }) {
    let categorias = [];
    let loadError = '';
    try {
        const result = await bd.query(categoryOptionsQuery);
        categorias = result.rows;
        if (preselectedCategory && categorias.some(category => String(category.id_categoria) === preselectedCategory)) {
            values = { ...values, id_categoria: preselectedCategory };
        }
    } catch (err) {
        console.error('Erro ao carregar categorias do produto:', err.code || 'unknown');
        loadError = 'Não foi possível carregar as categorias. Os dados foram mantidos; tente novamente em instantes.';
        status = 503;
    }
    return res.status(status).render('novo_produto', {
        mainClass: 'main-product-form', categorias, values, errors, formError, loadError, submitted, uploadNotice
    });
}

router.get('/novo_produto', async (req, res) => {
    const userId = req.session?.user?.id_usuario;
    if (!['string', 'number'].includes(typeof userId) || !productId(String(userId))) return res.status(401).send('Usuário não autenticado.');
    const requestedCategory = productText(req.query?.categoria);
    return renderProductForm(res, {
        values: { nome: '', estoque: '0', estoque_minimo: '0', valor: '', imagem: '', id_categoria: '' },
        preselectedCategory: productId(requestedCategory) ? String(Number(requestedCategory)) : ''
    });
});

router.post('/cadastro', async (req, res) => {
    const userId = req.session?.user?.id_usuario;
    if (!['string', 'number'].includes(typeof userId) || !productId(String(userId))) return res.status(401).send('Usuário não autenticado.');
    const upload = await receiveProductImage(req, res);
    const values = Object.fromEntries(productFields.map(field => [field, productText(req.body?.[field])]));
    const errors = {};
    let uploadNotice = upload.file ? 'Selecione o arquivo novamente antes de salvar. Os demais campos foram mantidos.' : '';
    if (upload.error) errors.imagem_arquivo = upload.error;
    if (!values.nome) errors.nome = 'Informe o nome do produto.';
    else if (values.nome.length > 100) errors.nome = 'Use no máximo 100 caracteres no nome.';
    const decimals = {};
    for (const field of ['estoque', 'estoque_minimo', 'valor']) {
        decimals[field] = productDecimal(values[field]);
        if (decimals[field] === null) {
            errors[field] = 'Informe um valor de 0 a 9.999.999.999,99, com até 2 casas decimais.';
        }
    }
    if (!productId(values.id_categoria)) errors.id_categoria = 'Selecione uma categoria.';
    if (!upload.file && ((req.body?.imagem !== undefined && typeof req.body.imagem !== 'string') || !validProductImage(values.imagem))) {
        errors.imagem = 'Use um endereço http/https ou um caminho local iniciado por /, com até 2048 caracteres.';
    }
    if (Object.keys(errors).length) return renderProductForm(res, { values, errors, status: 400, submitted: true, uploadNotice });

    let client;
    let releaseError;
    let transactionStarted = false;
    let formError = '';
    let status = 400;
    try {
        client = await bd.connect();
        await client.query('BEGIN');
        transactionStarted = true;
        // Os bloqueios preservam categoria e responsável até o registro da entrada.
        const category = await client.query('SELECT id_categoria FROM categorias WHERE id_categoria = $1 FOR KEY SHARE', [Number(values.id_categoria)]);
        const user = await client.query('SELECT id_usuario FROM usuarios WHERE id_usuario = $1 FOR KEY SHARE', [Number(userId)]);
        if (!category.rows.length) errors.id_categoria = 'Esta categoria não está mais disponível. Selecione outra.';
        if (!user.rows.length) {
            status = 401;
            formError = 'Sua sessão não corresponde a um usuário disponível. Entre novamente antes de cadastrar.';
        }
        if (Object.keys(errors).length || formError) {
            await client.query('ROLLBACK');
            transactionStarted = false;
        } else {
            if (upload.file) {
                values.imagem = await storeProductImage(upload.file);
                uploadNotice = ''; // Em caso de falha do banco, a imagem local fica disponível no rascunho.
            }
            const product = await client.query(
                `INSERT INTO produtos (nome, estoque, estoque_minimo, valor, imagem, id_categoria)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_produto`,
                [values.nome, decimals.estoque, decimals.estoque_minimo, decimals.valor, values.imagem, Number(values.id_categoria)]
            );
            await client.query(
                `INSERT INTO movimentacoes (tipo_movimentacao, data_movimentacao, quantidade, descricao, id_produto, id_usuario)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['Entrada', new Date(), decimals.estoque, 'Entrada de produto novo', product.rows[0].id_produto, Number(userId)]
            );
            await client.query('COMMIT');
            transactionStarted = false;
        }
    } catch (err) {
        releaseError = err;
        console.error('Erro ao cadastrar produto:', err.code || 'unknown');
        if (client && transactionStarted) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Erro ao desfazer cadastro de produto:', rollbackError.code || 'unknown');
            }
        }
        if (err.code === 'PRODUCT_IMAGE_INVALID') {
            errors.imagem_arquivo = err.message;
            status = 400;
        } else if (err.code === '23503' && typeof err.constraint === 'string' && /categoria/i.test(err.constraint)) {
            errors.id_categoria = 'Esta categoria não está mais disponível. Selecione outra.';
            status = 400;
        } else {
            formError = 'Não foi possível concluir o cadastro. Os dados foram mantidos; tente novamente em instantes.';
            status = 503;
        }
    } finally {
        if (client) client.release(releaseError);
    }
    if (formError || Object.keys(errors).length) return renderProductForm(res, { values, errors, formError, status, submitted: true, uploadNotice });
    return res.redirect('/produtos/listar?mensagem=' + encodeURIComponent('Produto criado com sucesso e movimentação de entrada registrada!'));
});

router.get('/listar', async (req, res) => {
    const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
    const query = req.query || {};
    const category = text(query.categoria, 20);
    const orders = {
        nome: 'produtos.nome ASC, produtos.id_produto ASC',
        'nome-desc': 'produtos.nome DESC, produtos.id_produto ASC',
        saldo: 'produtos.estoque ASC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        valor: 'produtos.valor DESC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        recentes: 'produtos.id_produto DESC'
    };
    const requestedOrder = text(query.ordem, 30);
    const requestedStatus = text(query.status, 30);
    const filters = {
        q: text(query.q, 120),
        categoria: /^\d+$/.test(category) && Number(category) > 0 && Number(category) <= 2147483647 ? String(Number(category)) : '',
        status: ['todos', 'repor', 'sem-saldo'].includes(requestedStatus) ? requestedStatus : 'todos',
        ordem: Object.hasOwn(orders, requestedOrder) ? requestedOrder : 'nome'
    };
    const requestedPage = text(query.pagina, 20);
    const page = /^\d+$/.test(requestedPage) && Number.isSafeInteger(Number(requestedPage)) && Number(requestedPage) > 0 ? Number(requestedPage) : 1;
    const pagination = { page, pageSize: 20, total: 0, totalPages: 1 };
    const deletionNotices = {
        'em-uso': 'Este produto possui movimentações e não pode ser excluído. O histórico e o saldo foram preservados.',
        'nao-encontrado': 'Produto não encontrado. Ele pode já ter sido excluído.',
        'id-invalido': 'Não foi possível identificar o produto. Atualize a lista e tente novamente.',
        falha: 'Não foi possível excluir o produto. Tente novamente em instantes.'
    };
    const requestedNotice = text(query.aviso, 30);
    const noticeType = Object.hasOwn(deletionNotices, requestedNotice) ? 'error' : 'success';
    const mensagem = noticeType === 'error' ? deletionNotices[requestedNotice] : text(query.mensagem, 300);
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
    if (filters.status === 'sem-saldo') conditions.push('produtos.estoque <= 0');
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

    try {
        const categories = await bd.query('SELECT id_categoria, nome FROM categorias ORDER BY nome ASC, id_categoria ASC');
        const totals = await bd.query(`
            SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE estoque < estoque_minimo) AS below_minimum,
                COUNT(*) FILTER (WHERE estoque <= 0) AS non_positive
            FROM produtos
        `);
        const count = await bd.query('SELECT COUNT(*) AS total FROM produtos' + where, values);
        pagination.total = Number(count.rows[0]?.total || 0);
        pagination.totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
        pagination.page = Math.min(pagination.page, pagination.totalPages);
        const result = await bd.query(`
            SELECT produtos.id_produto, produtos.nome AS nome_produto, produtos.estoque,
                produtos.estoque_minimo, produtos.valor, produtos.imagem, produtos.id_categoria,
                categorias.nome AS nome_categoria
            FROM produtos
            LEFT JOIN categorias ON produtos.id_categoria = categorias.id_categoria
            ${where}
            ORDER BY ${orders[filters.ordem]}
            LIMIT $${values.length + 1} OFFSET $${values.length + 2}
        `, [...values, pagination.pageSize, (pagination.page - 1) * pagination.pageSize]);
        const summary = totals.rows[0] || {};
        res.render('produto', {
            mainClass: 'main-products', produtos: result.rows, categorias: categories.rows,
            filters, pagination, mensagem, noticeType, productsError: null,
            summary: {
                total: Number(summary.total || 0),
                belowMinimum: Number(summary.below_minimum || 0),
                nonPositive: Number(summary.non_positive || 0)
            }
        });
    } catch (err) {
        console.error('Erro ao listar produtos:', err);
        res.status(503).render('produto', {
            mainClass: 'main-products', produtos: [], categorias: [], filters, pagination,
            summary: null, mensagem: '', noticeType: 'error',
            productsError: 'Não foi possível consultar os produtos. Tente novamente em instantes.'
        });
    }
});

router.post('/pesquisar', (req, res) => {
    const pesquisa = typeof req.body?.pesquisa === 'string' ? req.body.pesquisa.trim().slice(0, 120) : '';
    res.redirect(pesquisa ? '/produtos/listar?q=' + encodeURIComponent(pesquisa) : '/produtos/listar');
});

async function loadProductEdit(id) {
    const [product, categories] = await Promise.all([
        bd.query(`SELECT produtos.id_produto, produtos.nome AS nome_produto, produtos.estoque,
            produtos.estoque_minimo, produtos.valor, produtos.imagem, produtos.id_categoria,
            categorias.nome AS nome_categoria
            FROM produtos LEFT JOIN categorias ON produtos.id_categoria = categorias.id_categoria
            WHERE produtos.id_produto = $1`, [Number(id)]),
        bd.query(categoryOptionsQuery)
    ]);
    return { produto: product.rows[0] || null, categorias: categories.rows };
}

const productEditFields = ['nome_produto', 'estoque_minimo', 'valor', 'imagem', 'id_categoria'];
function editProductValues(product) {
    return Object.fromEntries(productEditFields.map(field => [field, String(product?.[field] ?? '')]));
}

async function renderProductEdit(res, id, options = {}) {
    const { values, errors = {}, formError = '', submitted = false, uploadNotice = '' } = options;
    let data = options.data;
    let status = options.status || 200;
    let loadError = '';
    let notFound = !productId(id);
    if (!notFound && !data) {
        try { data = await loadProductEdit(id); }
        catch (err) {
            console.error('Erro ao carregar edição do produto:', err.code || 'unknown');
            loadError = 'Não foi possível carregar o produto e suas categorias. Tente novamente em instantes.';
            status = 503;
        }
    }
    if (data && !data.produto) notFound = true;
    if (notFound) status = 404;
    return res.status(status).render('alterar_produto', {
        mainClass: 'main-product-edit', productId: productId(id) ? String(Number(id)) : '',
        produto: data?.produto || null, categorias: data?.categorias || [],
        values: values || editProductValues(data?.produto), errors, formError, loadError, submitted, notFound, uploadNotice
    });
}

router.get('/alterar/:id_produto', async (req, res) => {
    const userId = req.session?.user?.id_usuario;
    if (!['string', 'number'].includes(typeof userId) || !productId(String(userId))) return res.status(401).send('Usuário não autenticado.');
    return renderProductEdit(res, productText(req.params?.id_produto));
});

router.post('/alterar/:id_produto', async (req, res) => {
    const userId = req.session?.user?.id_usuario;
    if (!['string', 'number'].includes(typeof userId) || !productId(String(userId))) return res.status(401).send('Usuário não autenticado.');
    const id = productText(req.params?.id_produto);
    if (!productId(id)) return renderProductEdit(res, id);
    const upload = await receiveProductImage(req, res);
    const values = Object.fromEntries(productEditFields.map(field => [field, productText(req.body?.[field])]));
    const errors = {};
    let uploadNotice = upload.file ? 'Selecione o arquivo novamente antes de salvar. Os demais campos foram mantidos.' : '';
    if (upload.error) errors.imagem_arquivo = upload.error;
    if (!values.nome_produto) errors.nome_produto = 'Informe o nome do produto.';
    else if (values.nome_produto.length > 100) errors.nome_produto = 'Use no máximo 100 caracteres no nome.';
    const minimum = productDecimal(values.estoque_minimo);
    const price = productDecimal(values.valor);
    if (minimum === null) errors.estoque_minimo = 'Informe um valor de 0 a 9.999.999.999,99, com até 2 casas decimais.';
    if (price === null) errors.valor = 'Informe um valor de 0 a 9.999.999.999,99, com até 2 casas decimais.';
    if (!productId(values.id_categoria)) errors.id_categoria = 'Selecione uma categoria.';
    if (!upload.file && ((req.body?.imagem !== undefined && typeof req.body.imagem !== 'string') || !validProductImage(values.imagem))) {
        errors.imagem = 'Use um endereço http/https ou um caminho local iniciado por /, com até 2048 caracteres.';
    }
    let data;
    try {
        data = await loadProductEdit(id);
    } catch (err) {
        console.error('Erro ao carregar edição do produto:', err.code || 'unknown');
        // Mantém o rascunho sem tentar repetir uma consulta já indisponível.
        return res.status(503).render('alterar_produto', {
            mainClass: 'main-product-edit', productId: String(Number(id)), produto: null, categorias: [],
            values, errors, formError: '', submitted: true, notFound: false, uploadNotice,
            loadError: 'Não foi possível carregar o produto e suas categorias. Seus dados foram mantidos abaixo.'
        });
    }
    if (!data.produto) return renderProductEdit(res, id, { data, values, errors, submitted: true, uploadNotice });
    if (!errors.id_categoria && !data.categorias.some(category => String(category.id_categoria) === String(Number(values.id_categoria)))) {
        errors.id_categoria = 'Esta categoria não está mais disponível. Selecione outra.';
    }
    if (Object.keys(errors).length) return renderProductEdit(res, id, { data, values, errors, submitted: true, status: 400, uploadNotice });
    try {
        if (upload.file) {
            values.imagem = await storeProductImage(upload.file);
            uploadNotice = '';
        }
        // O saldo só muda por movimentações; campos adicionais do POST não são usados.
        const result = await bd.query(
            `UPDATE produtos SET nome = $1, estoque_minimo = $2, valor = $3, imagem = $4, id_categoria = $5
             WHERE id_produto = $6 RETURNING id_produto`,
            [values.nome_produto, minimum, price, values.imagem, Number(values.id_categoria), Number(id)]
        );
        if (!result.rows.length) return renderProductEdit(res, id, { data: { ...data, produto: null }, values, submitted: true });
        return res.redirect('/produtos/listar?mensagem=' + encodeURIComponent('Produto alterado com sucesso!'));
    } catch (err) {
        console.error('Erro ao editar produto:', err.code || 'unknown');
        if (err.code === 'PRODUCT_IMAGE_INVALID') {
            errors.imagem_arquivo = err.message;
            return renderProductEdit(res, id, { data, values, errors, submitted: true, status: 400, uploadNotice });
        }
        if (err.code === '23503' && typeof err.constraint === 'string' && /categoria/i.test(err.constraint)) {
            errors.id_categoria = 'Esta categoria não está mais disponível. Selecione outra.';
            return renderProductEdit(res, id, { data, values, errors, submitted: true, status: 400, uploadNotice });
        }
        return renderProductEdit(res, id, {
            data, values, submitted: true, status: 503, uploadNotice,
            formError: 'Não foi possível salvar as alterações. Seus dados foram mantidos; tente novamente em instantes.'
        });
    }
});

router.post('/excluir/:id_produto', async (req, res) => {
    const userId = req.session?.user?.id_usuario;
    if (!['string', 'number'].includes(typeof userId) || !productId(String(userId))) return res.redirect('/usuarios/login');
    const id = productText(req.params?.id_produto);
    const redirectNotice = aviso => res.redirect('/produtos/listar?aviso=' + aviso);
    if (!productId(id)) return redirectNotice('id-invalido');
    try {
        // Protege o histórico no mesmo comando; a FK cobre vínculos concorrentes.
        const result = await bd.query(`DELETE FROM produtos p WHERE p.id_produto = $1
            AND NOT EXISTS (SELECT 1 FROM movimentacoes m WHERE m.id_produto = p.id_produto)
            RETURNING p.id_produto`, [Number(id)]);
        if (!result.rows.length) {
            const remaining = await bd.query('SELECT EXISTS (SELECT 1 FROM produtos WHERE id_produto = $1) AS product_exists', [Number(id)]);
            return redirectNotice(remaining.rows[0]?.product_exists ? 'em-uso' : 'nao-encontrado');
        }
        return res.redirect('/produtos/listar?mensagem=' + encodeURIComponent('Produto excluído com sucesso!'));
    } catch (err) {
        if (err.code === '23503') return redirectNotice('em-uso');
        console.error('Erro ao excluir produto:', err.code || 'unknown');
        return redirectNotice('falha');
    }
});

module.exports = router;
