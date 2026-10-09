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
    estoque NUMERIC(12, 2) NOT NULL DEFAULT 0,
    estoque_minimo NUMERIC(12, 2) NOT NULL DEFAULT 0,
    valor NUMERIC(12, 2) NOT NULL DEFAULT 0,
    imagem TEXT,
    id_categoria INTEGER NOT NULL REFERENCES public.categorias (id_categoria) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.movimentacoes (
    id_movimentacao SERIAL PRIMARY KEY,
    tipo_movimentacao TEXT NOT NULL CHECK (tipo_movimentacao IN ('Entrada', 'Saída')),
    data_movimentacao TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    quantidade NUMERIC(12, 2) NOT NULL,
    descricao TEXT,
    id_produto INTEGER NOT NULL REFERENCES public.produtos (id_produto) ON DELETE RESTRICT,
    id_usuario INTEGER NOT NULL REFERENCES public.usuarios (id_usuario) ON DELETE RESTRICT
);
