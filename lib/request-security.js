'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameOriginRequest(req) {
    let expected;
    try { expected = new URL(`${req.protocol}://${req.get('host')}`).origin; }
    catch (_) { return false; }

    // Origin is authoritative when present, including the opaque "null" origin.
    const origin = req.get('origin');
    const referer = req.get('referer');
    if (origin || referer) {
        try {
            const source = new URL(origin || referer);
            return ['https:', 'http:'].includes(source.protocol)
                && !source.username && !source.password && source.origin === expected;
        } catch (_) { return false; }
    }
    // Native same-origin forms in browsers without Origin can use Fetch Metadata.
    // No public write API is exposed: unidentified production writes fail closed.
    return req.get('sec-fetch-site') === 'same-origin';
}

function createRequestSecurity(config, { loginLimit = 30, registrationLimit = 20, writeLimit = 120 } = {}) {
    const router = express.Router();
    if (!config.production) return router;

    router.use((req, res, next) => {
        if (SAFE_METHODS.has(req.method) || sameOriginRequest(req)) return next();
        res.status(403).type('text').send('Solicitação não permitida. Volte ao site e tente novamente.');
    });

    const limiter = (limit, windowMs, message, extra = {}) => rateLimit({
        limit, windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
        message, ...extra
    });
    // In-memory counters are appropriate for the single-instance disk-backed demo.
    // They reset on restart; multi-instance hosting needs a shared limiter store.
    router.use(limiter(writeLimit, 60_000,
        'Muitas solicitações. Aguarde um minuto antes de tentar novamente.',
        { skip: req => SAFE_METHODS.has(req.method) }));
    router.post('/usuarios/login', limiter(loginLimit, 15 * 60_000,
        'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.',
        { skipSuccessfulRequests: true }));
    router.post('/usuarios/cadastro', limiter(registrationLimit, 60 * 60_000,
        'Limite temporário de cadastros nesta conexão. Tente novamente em uma hora.'));
    return router;
}

module.exports = { createRequestSecurity, sameOriginRequest };
