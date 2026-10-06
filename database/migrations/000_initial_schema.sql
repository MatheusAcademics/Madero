-- Base para um banco vazio. Tabelas existentes e seus registros são preservados.
-- Contatos e fotos são acrescentados pelas migrações 001 e 002.
CREATE TABLE IF NOT EXISTS public.usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE,
    senha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.categorias (
    id_categoria SERIAL PRIMARY KEY,
    nome TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.produtos (
    id_produto SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    estoque NUMERIC(12, 2),
    estoque_minimo NUMERIC(12, 2),
    valor NUMERIC(12, 2),
    imagem TEXT,
    id_categoria INTEGER REFERENCES public.categorias (id_categoria) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.movimentacoes (
    id_movimentacao SERIAL PRIMARY KEY,
    tipo_movimentacao TEXT NOT NULL,
    data_movimentacao TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    quantidade NUMERIC(12, 2) NOT NULL,
    descricao TEXT,
    id_produto INTEGER REFERENCES public.produtos (id_produto) ON DELETE RESTRICT,
    id_usuario INTEGER REFERENCES public.usuarios (id_usuario) ON DELETE RESTRICT
);
