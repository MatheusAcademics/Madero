
const express = require('express');
const router = express.Router();
const bd = require('../conexao');

// Exibe o formulário de cadastro de categoria
router.get('/cadastro', (req, res) => {
    res.render('nova_categoria', {
        mainClass: 'main-category-form', nome: '', fieldError: '', formError: ''
    });
});

// rota para efetuar o cadastro
router.post('/cadastro', async (req, res) => {
    const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
    const fieldError = !nome ? 'Informe o nome da categoria.'
        : nome.length > 100 ? 'Use no máximo 100 caracteres no nome da categoria.' : '';
    const renderForm = (status, errors) => res.status(status).render('nova_categoria', {
        mainClass: 'main-category-form', nome, fieldError: '', formError: '', ...errors
    });
    if (fieldError) return renderForm(400, { fieldError });

    try {
        await bd.query('INSERT INTO categorias (nome) VALUES ($1)', [nome]);
        const mensagem = 'Categoria cadastrada com sucesso!';
        res.redirect(`/categorias/listar?mensagem=${encodeURIComponent(mensagem)}`);
    } catch (err) {
        // Não envia detalhes do banco nem o conteúdo do formulário para o cliente/log.
        console.error('Erro ao cadastrar categoria:', err.code || 'unknown');
        return renderForm(503, { formError: 'Não foi possível salvar a categoria. O nome foi mantido; tente novamente em instantes.' });
    }
});

const categoryText = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const categoryNotices = Object.freeze({
    'em-uso': 'Esta categoria tem produtos vinculados. Altere a categoria desses produtos antes de excluir.',
    'nao-encontrada': 'A categoria não foi encontrada. Ela pode já ter sido excluída.',
    'id-invalido': 'Não foi possível identificar a categoria. Atualize a lista e tente novamente.',
    falha: 'Não foi possível excluir a categoria. Tente novamente em instantes.'
});

// Consulta paginada. Os resumos contam categorias, não unidades em estoque.
router.get('/listar', async (req, res) => {
    const query = req.query || {};
    const orders = {
        nome: 'c.nome ASC NULLS LAST, c.id_categoria ASC',
        'nome-desc': 'c.nome DESC NULLS LAST, c.id_categoria DESC',
        produtos: 'total_produtos DESC, c.nome ASC NULLS LAST, c.id_categoria ASC',
        recentes: 'c.id_categoria DESC'
    };
    const filters = {
        q: categoryText(query.q, 120),
        status: ['todas', 'com-produtos', 'sem-produtos'].includes(query.status) ? query.status : 'todas',
        ordem: typeof query.ordem === 'string' && Object.prototype.hasOwnProperty.call(orders, query.ordem) ? query.ordem : 'nome'
    };
    const aviso = typeof query.aviso === 'string' && Object.prototype.hasOwnProperty.call(categoryNotices, query.aviso) ? query.aviso : '';
    const pageNumber = typeof query.pagina === 'string' && /^\d+$/.test(query.pagina) ? Number(query.pagina) : 1;
    const requestedPage = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
    const pageSize = 20;
    const base = {
        mainClass: 'main-categories', categorias: [], filters,
        pagination: { page: requestedPage, pageSize, total: 0, totalPages: 1 }, summary: null,
        mensagem: aviso ? categoryNotices[aviso] : categoryText(query.mensagem, 300),
        noticeType: aviso ? 'error' : 'success', categoriesError: null
    };
    const values = [];
    const conditions = [];
    if (filters.q) {
        const search = filters.q.replace(/[\\%_]/g, '\\$&');
        values.push(`%${search}%`);
        conditions.push(`(c.nome ILIKE $${values.length} OR c.id_categoria::text ILIKE $${values.length})`);
    }
    const linkedProducts = 'EXISTS (SELECT 1 FROM produtos p WHERE p.id_categoria = c.id_categoria)';
    if (filters.status === 'com-produtos') conditions.push(linkedProducts);
    if (filters.status === 'sem-produtos') conditions.push(`NOT ${linkedProducts}`);
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    try {
        const totals = await bd.query(`SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE ${linkedProducts}) AS with_products,
            COUNT(*) FILTER (WHERE NOT ${linkedProducts}) AS without_products
            FROM categorias c`);
        const summary = {
            total: Number(totals.rows[0].total),
            withProducts: Number(totals.rows[0].with_products),
            withoutProducts: Number(totals.rows[0].without_products)
        };
        const count = await bd.query(`SELECT COUNT(*) AS total FROM categorias c${where}`, values);
        const total = Number(count.rows[0].total);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(requestedPage, totalPages);
        const resultado = await bd.query(`SELECT c.id_categoria, c.nome,
            (SELECT COUNT(*) FROM produtos p WHERE p.id_categoria = c.id_categoria) AS total_produtos
            FROM categorias c${where}
            ORDER BY ${orders[filters.ordem]}
            LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
        return res.render('categoria', {
            ...base, categorias: resultado.rows, summary,
            pagination: { page, pageSize, total, totalPages }
        });
    } catch (err) {
        console.error('Erro ao listar categorias:', err.code || 'unknown');
        return res.status(503).render('categoria', {
            ...base, mensagem: '', noticeType: 'error',
            categoriesError: 'Não foi possível carregar as categorias. Tente novamente em instantes.'
        });
    }
});

// Compatibilidade com formulários antigos: uma única URL para consultar a lista.
router.post('/pesquisar', (req, res) => {
    const q = categoryText(req.body?.pesquisa, 120);
    return res.redirect('/categorias/listar' + (q ? `?q=${encodeURIComponent(q)}` : ''));
});

// Edição mantém os vínculos dos produtos e altera somente o nome.
const categoryEditId = value => typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647;
const renderCategoryEdit = (res, status, data = {}) => res.status(status).render('alterar_categoria', {
    mainClass: 'main-category-edit', isEditing: true, id_categoria: '', nome: '',
    fieldError: '', formError: '', loadError: '', notFound: false, submitted: false, ...data
});

router.get('/alterar/:id_categoria', async (req, res) => {
    const id = req.params.id_categoria;
    if (!categoryEditId(id)) return renderCategoryEdit(res, 404, { notFound: true });
    try {
        const result = await bd.query('SELECT id_categoria, nome FROM categorias WHERE id_categoria = $1', [Number(id)]);
        if (!result.rows.length) return renderCategoryEdit(res, 404, { notFound: true });
        return renderCategoryEdit(res, 200, { id_categoria: String(Number(id)), nome: result.rows[0].nome || '' });
    } catch (err) {
        console.error('Erro ao abrir categoria:', err.code || 'unknown');
        return renderCategoryEdit(res, 503, { id_categoria: String(Number(id)), loadError: 'Não foi possível consultar a categoria. Tente novamente em instantes.' });
    }
});

router.post('/alterar/:id_categoria', async (req, res) => {
    const id = req.params.id_categoria;
    if (!categoryEditId(id)) return renderCategoryEdit(res, 404, { notFound: true });
    const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
    const data = { id_categoria: String(Number(id)), nome, submitted: true };
    const fieldError = !nome ? 'Informe o nome da categoria.'
        : nome.length > 100 ? 'Use no máximo 100 caracteres no nome da categoria.' : '';
    if (fieldError) return renderCategoryEdit(res, 400, { ...data, fieldError });
    try {
        const result = await bd.query('UPDATE categorias SET nome = $1 WHERE id_categoria = $2 RETURNING id_categoria', [nome, Number(id)]);
        if (!result.rows.length) return renderCategoryEdit(res, 404, { ...data, notFound: true });
        return res.redirect('/categorias/listar?mensagem=' + encodeURIComponent('Categoria alterada com sucesso!'));
    } catch (err) {
        console.error('Erro ao alterar categoria:', err.code || 'unknown');
        return renderCategoryEdit(res, 503, { ...data, formError: 'Não foi possível salvar. O nome foi mantido; tente novamente em instantes.' });
    }
});

// A condição é verificada no próprio DELETE; a FK também protege vínculos concorrentes.
router.post('/excluir/:id_categoria', async (req, res) => {
    const rawId = req.params.id_categoria;
    const id = typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
    const redirectNotice = aviso => res.redirect(`/categorias/listar?aviso=${aviso}`);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return redirectNotice('id-invalido');

    try {
        const result = await bd.query(`DELETE FROM categorias c WHERE c.id_categoria = $1
            AND NOT EXISTS (SELECT 1 FROM produtos p WHERE p.id_categoria = c.id_categoria)
            RETURNING c.id_categoria`, [id]);
        if (result.rows.length === 0) {
            const remaining = await bd.query('SELECT EXISTS (SELECT 1 FROM categorias WHERE id_categoria = $1) AS category_exists', [id]);
            return redirectNotice(remaining.rows[0]?.category_exists ? 'em-uso' : 'nao-encontrada');
        }
        const mensagem = 'Categoria excluída com sucesso!';
        return res.redirect(`/categorias/listar?mensagem=${encodeURIComponent(mensagem)}`);
    } catch (err) {
        if (err.code === '23503') return redirectNotice('em-uso');
        console.error('Erro ao excluir categoria:', err.code || 'unknown');
        return redirectNotice('falha');
    }
});

module.exports = router;
