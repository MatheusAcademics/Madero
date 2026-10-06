-- Execute no banco configurado em DB_NAME. Preserva todas as contas existentes.
-- E-mail obrigatorio para novos cadastros e validado pela aplicacao; contas
-- anteriores continuam com NULL ate que seus dados sejam informados.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS telefone TEXT;

-- Garante exclusividade mesmo com diferencas de maiusculas e espacos externos.
-- NULL e permitido para nao inventar enderecos para as contas antigas.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unique
    ON public.usuarios (lower(btrim(email)))
    WHERE email IS NOT NULL;

COMMIT;
