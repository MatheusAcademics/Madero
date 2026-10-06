const express = require('express');
const router = express.Router();
const bd = require('../conexao');

const numero = value => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

router.get('/', async (req, res) => {
    const mensagem = typeof req.query?.mensagem === 'string'
        ? req.query.mensagem.trim().slice(0, 240)
        : '';

    try {
        // Independent, read-only queries: loading the dashboard never changes stock.
        const [resumo, reposicao, categorias, produtos, movimentacoes] = await Promise.all([
            bd.query(`
                SELECT COUNT(*) AS total_produtos,
                    COALESCE(SUM(estoque), 0) AS total_estoque,
                    COALESCE(SUM(valor * estoque), 0) AS valor_total_estoque,
                    COUNT(*) FILTER (WHERE estoque < estoque_minimo) AS produtos_abaixo_minimo,
                    (SELECT COUNT(*) FROM categorias) AS total_categorias,
                    (SELECT COUNT(*) FROM movimentacoes) AS total_movimentacoes
                FROM produtos
            `),
            bd.query(`
                SELECT p.id_produto, p.nome AS nome_produto, p.estoque,
                    p.estoque_minimo, p.valor, p.imagem, c.nome AS nome_categoria
                FROM produtos p
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                WHERE p.estoque < p.estoque_minimo
                ORDER BY (p.estoque_minimo - p.estoque) DESC,
                    p.estoque ASC, p.id_produto ASC
            `),
            bd.query(`
                SELECT c.id_categoria, c.nome,
                    COALESCE(SUM(p.valor * p.estoque), 0) AS valor_total
                FROM categorias c
                LEFT JOIN produtos p ON p.id_categoria = c.id_categoria
                GROUP BY c.id_categoria, c.nome
                ORDER BY valor_total DESC, c.nome ASC, c.id_categoria ASC
            `),
            bd.query(`
                SELECT p.id_produto, p.nome, p.estoque, c.nome AS nome_categoria
                FROM produtos p
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                ORDER BY p.estoque DESC, p.nome ASC, p.id_produto ASC
                LIMIT $1
            `, [5]),
            bd.query(`
                SELECT m.id_movimentacao, m.tipo_movimentacao, m.data_movimentacao,
                    m.quantidade, m.descricao, p.nome AS nome_produto,
                    u.usuario AS nome_usuario
                FROM movimentacoes m
                LEFT JOIN produtos p ON m.id_produto = p.id_produto
                LEFT JOIN usuarios u ON m.id_usuario = u.id_usuario
                ORDER BY m.data_movimentacao DESC, m.id_movimentacao DESC
                LIMIT $1
            `, [5])
        ]);

        const totais = resumo.rows[0] || {};
        const valorTotalEstoqueNumero = numero(totais.valor_total_estoque);
        const produtosRanking = produtos.rows.map(row => ({
            ...row,
            estoque: numero(row.estoque)
        }));

        const data = {
            totalProdutos: numero(totais.total_produtos),
            totalEstoque: numero(totais.total_estoque),
            totalCategorias: numero(totais.total_categorias),
            totalMovimentacoes: numero(totais.total_movimentacoes),
            valorTotalEstoqueNumero,
            // Keep the original formatted field for existing dashboard consumers.
            valorTotalEstoque: valorTotalEstoqueNumero.toFixed(2).replace('.', ','),
            produtosAbaixoMinimo: numero(totais.produtos_abaixo_minimo),
            produtosAbaixoMinimoList: reposicao.rows.map(row => ({
                ...row,
                estoque: numero(row.estoque),
                estoque_minimo: numero(row.estoque_minimo),
                valor: numero(row.valor)
            })),
            categorias: {
                labels: categorias.rows.map(row => row.nome),
                values: categorias.rows.map(row => numero(row.valor_total))
            },
            produtos: {
                labels: produtosRanking.map(row => row.nome),
                values: produtosRanking.map(row => row.estoque)
            },
            produtosRanking,
            ultimasMovimentacoes: movimentacoes.rows.map(row => ({
                ...row,
                quantidade: numero(row.quantidade)
            })),
            geradoEm: new Date().toISOString()
        };

        return res.render('painel', {
            mensagem,
            data,
            dashboardError: null,
            mainClass: 'main-dashboard'
        });
    } catch (error) {
        // Do not expose query details, credentials or account data in the response/log.
        console.error('Erro ao carregar os dados do painel:', error.code || 'UNKNOWN');
        return res.status(503).render('painel', {
            mensagem,
            data: null,
            dashboardError: 'Não foi possível carregar os dados do estoque. Atualize a página para tentar novamente.',
            mainClass: 'main-dashboard'
        });
    }
});

module.exports = router;
