'use strict';

const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');

class AccountDeletionError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

async function deleteAccount(pool, id, password, confirmed, removeAvatar) {
    if (confirmed !== 'excluir' || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
        throw new AccountDeletionError(400, 'Informe sua senha atual e marque a confirmação.');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        const result = await client.query('SELECT id_usuario, senha, foto FROM usuarios WHERE id_usuario = $1 FOR UPDATE', [id]);
        const account = result.rows[0];
        if (!account?.senha || !await bcrypt.compare(password, account.senha)) {
            throw new AccountDeletionError(403, 'A senha atual está incorreta.');
        }
        const history = await client.query('SELECT 1 FROM movimentacoes WHERE id_usuario = $1 LIMIT 1', [id]);
        // Remove only the server-generated avatar path; a storage failure aborts deletion.
        await removeAvatar(account.foto);
        if (history.rows.length) {
            // An empty hash cannot authenticate and is the tombstone for an anonymized account.
            await client.query("UPDATE usuarios SET nome = 'Conta excluída', usuario = $2, senha = '', email = NULL, telefone = NULL, foto = NULL WHERE id_usuario = $1",
                [id, 'conta_excluida_' + randomUUID()]);
        } else {
            await client.query('DELETE FROM usuarios WHERE id_usuario = $1', [id]);
        }
        const sessions = await client.query("SELECT to_regclass('public.user_sessions') AS name");
        if (sessions.rows[0]?.name) await client.query("DELETE FROM public.user_sessions WHERE sess->'user'->>'id_usuario' = $1", [String(id)]);
        await client.query('COMMIT');
        return { anonymized: history.rows.length > 0 };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* Preserve original error. */ }
        throw error;
    } finally { client.release(); }
}

module.exports = { deleteAccount, AccountDeletionError };
