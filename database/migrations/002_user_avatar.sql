-- Foto opcional. Preserva as contas existentes e não modifica senhas ou permissões.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS foto TEXT;
COMMIT;
