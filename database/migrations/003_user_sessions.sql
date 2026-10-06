-- Esquema de connect-pg-simple/table.sql, com nome exclusivo desta aplicação.
-- OIDS=FALSE foi omitido: PostgreSQL moderno já não oferece OIDs em tabelas.
CREATE TABLE IF NOT EXISTS public.user_sessions (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT user_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON public.user_sessions (expire);
