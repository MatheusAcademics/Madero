# Madero gratuito: Vercel e Supabase

Use Vercel Hobby e Supabase Free para esta demonstração pessoal/escolar. Não aplique o `render.yaml`: ele descreve recursos pagos no Render.

## Configuração no Supabase

1. Mantenha o projeto no plano Free e a Data API das tabelas desativada.
2. Crie um bucket público `madero-uploads`, com MIME permitido `image/webp`. As fotos já eram públicas em `/uploads/`; não envie imagens privadas.
3. Copie a URL do projeto e a chave privada `service_role` somente para as variáveis do servidor na Vercel. Não use prefixos de variáveis públicas nem publique a chave no Git/chat. Não crie políticas de upload anônimo: somente o servidor envia arquivos.
4. Aplique as migrações antes de receber cadastros. Use `npm run db:migrate` em um ambiente privado configurado para o banco de destino, preferindo Session pooler (porta 5432) para essa operação. O comando usa uma transação e verifica checksums; não sobrescreva tabelas ou histórico existente. Não importa usuários, produtos ou fotos locais.

## Variáveis da Vercel (Production)

| Nome | Valor |
| --- | --- |
| NODE_ENV | production |
| DATABASE_URL | URI do Transaction pooler, porta 6543, senha codificada para URL |
| DB_SSL | require |
| DB_SSL_CA | Certificado CA do projeto, se necessário para validar TLS |
| DB_POOL_MAX | 2 |
| SESSION_SECRET | Segredo aleatório exclusivo de pelo menos 32 bytes |
| TRUST_PROXY_HOPS | 1 |
| UPLOAD_STORAGE | supabase |
| SUPABASE_URL | URL HTTPS do projeto |
| SUPABASE_STORAGE_BUCKET | madero-uploads |
| SUPABASE_SERVICE_ROLE_KEY | Chave privada de servidor do projeto |

Configure Framework Preset Express, Node 24 e instalação `npm ci`. Remova overrides antigos de build/output directory, se existirem. `app.js` exporta o Express; na Vercel não inicia listener nem depende de disco gravável. As views EJS acompanham a função e `public/` é servido pela plataforma.

Faça Redeploy apenas depois das migrações e das variáveis. Confira `/healthz`, cadastro, login, sessão, produto com foto e avatar. As URLs `/uploads/products/UUID.webp` e `/uploads/avatars/UUID.webp` redirecionam ao bucket; imagens antigas só funcionam após copiar seus arquivos para as mesmas pastas no bucket. Dados e fotos locais não são transferidos automaticamente.

## Limites

- Fotos e dados seguem as cotas gratuitas do Supabase. O projeto pode pausar por inatividade; mantenha backups separados.
- A Vercel limita o tamanho total da requisição (incluindo formulário). Para esta publicação, escolha fotos menores que 4 MB, mesmo que a validação local aceite até 5 MB. Arquivos acima do limite da plataforma podem ser rejeitados antes de chegar ao Express.
- Os limites de requisições do aplicativo ficam na memória de cada função; não constituem limite global entre instâncias. Esta publicação continua sendo uma demonstração com cadastro livre e sem cargos de acesso.
- Nenhuma migração ou criação de bucket roda automaticamente no deploy. Nenhum recurso pago deve ser contratado.

Referências: [Express na Vercel](https://vercel.com/docs/frameworks/backend/express), [uploads no Supabase](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [controle de acesso](https://supabase.com/docs/guides/storage/security/access-control).
