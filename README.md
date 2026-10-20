# Madero — Gestão de estoque

Aplicação web educacional para gerenciar produtos, categorias, usuários e movimentações de estoque. Desenvolvida com Node.js, Express, EJS e PostgreSQL.

**[Acessar a demonstração](https://madero-three.vercel.app)**

> Projeto independente de estudo, inspirado na identidade visual do Madero. Não possui vínculo oficial com a marca. Os dados de demonstração não representam a operação real da empresa.

## Funcionalidades

- Cadastro e login com senhas protegidas por bcrypt.
- Sessões persistidas no PostgreSQL em produção.
- Painel de gestão, produtos, categorias, saldos e movimentações de entrada e saída.
- Cadastro e edição de usuários e perfil.
- Upload de fotos de produtos e avatares, com validação e conversão para WebP.
- Exclusão da própria conta com senha atual e confirmação explícita.
- Layout adaptado para computador e celular.

### Exclusão da própria conta

Clique no nome ou avatar no cabeçalho para editar seu perfil. Na seção **Encerrar minha conta**, selecione **Excluir minha conta**.

- **Sem movimentações:** o cadastro é apagado completamente.
- **Com movimentações:** o histórico e o ID são preservados; nome, usuário de acesso, e-mail, telefone, senha e avatar são removidos. A identificação passa a ser **Conta excluída**.
- O avatar é removido do armazenamento e as sessões são revogadas. A conta excluída não pode entrar novamente.
- IDs não são reiniciados nem reutilizados. Intervalos na numeração são normais.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Servidor | Node.js 24, Express 5 |
| Interface | EJS, HTML, CSS e JavaScript |
| Banco | PostgreSQL |
| Autenticação | bcrypt, express-session, connect-pg-simple |
| Imagens | Multer, Sharp, Supabase Storage em produção |
| Hospedagem | Vercel e Supabase, sem recursos pagos contratados nesta publicação |
| Testes | Test runner nativo do Node.js |

## Executar localmente

Pré-requisitos: **Node.js 24**, npm e um banco PostgreSQL para desenvolvimento. Utilize um banco local separado da produção.

```powershell
git clone https://github.com/MatheusAcademics/Madero.git
cd Madero
# Enquanto a mesclagem na main não estiver concluída:
git switch deploy/vercel-supabase
npm ci
```

Copie `.env.example` para `.env` **apenas se o arquivo ainda não existir**. Preencha as configurações do seu PostgreSQL local:

```dotenv
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=madero
DB_USER=postgres
DB_PASSWORD=SUA_SENHA_LOCAL
DB_SSL=disable
TRUST_PROXY_HOPS=0
UPLOAD_STORAGE=local
UPLOAD_DIR=./public/uploads
```

Crie o banco indicado em `DB_NAME` antes de aplicar as migrações. `DB_SSL=disable` é somente para desenvolvimento local; conexões pela internet devem validar TLS.

```powershell
npm run db:migrate
npm start
```

Abra **http://localhost:3000** e crie uma conta. Para iniciar sem recarga automática, use `npm run serve`.

O comando de migração usa transação e verifica checksums. Ele não importa automaticamente dados ou imagens locais. Não altere arquivos de migrações já aplicadas e não execute scripts de limpeza sobre produção.

## Testes e saúde

```powershell
npm test
```

Na implementação da exclusão de conta, a suíte registrou **594 testes aprovados e um ignorado**. A contagem pode mudar conforme o projeto evolui.

O endpoint **`GET /healthz`** retorna `200` com `{"status":"ok"}` quando suas dependências estão disponíveis. Em produção com Supabase, verifica o banco, a tabela de sessões e o acesso ao bucket de imagens. Falhas retornam uma resposta genérica, sem credenciais.

## Publicação

O guia da publicação atual está em **[DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)**. Ele descreve variáveis, migrações, Supabase Storage e validação do deploy.

- Use Vercel Hobby e Supabase Free para esta demonstração.
- **Não aplique `render.yaml`** para reproduzir esta publicação: ele descreve outra configuração, com recursos pagos.
- Configure credenciais somente em variáveis privadas do servidor. Nunca envie `.env`, senhas ou chaves para o GitHub.
- O bucket `madero-uploads` possui leitura pública e aceita WebP. Somente o servidor deve enviar arquivos.
- Na Vercel, prefira fotos menores que 4 MB, considerando o limite total da requisição.
- Dados e fotos não são transferidos automaticamente entre o ambiente local e a hospedagem.

### Limites da demonstração

O cadastro é livre e a área interna ainda não possui cargos ou permissões diferenciadas. Use somente dados fictícios na demonstração pública. As imagens são públicas. As cotas e a disponibilidade dependem dos serviços gratuitos; o Supabase pode pausar o projeto por inatividade.

## Organização

```text
app.js                  Configuração do Express e endpoint de saúde
routes/                 Rotas e regras da aplicação
middleware/             Proteção de acesso
lib/                    Configuração, segurança e armazenamento de imagens
views/                  Templates EJS
public/                 CSS, JavaScript e imagens públicas
database/migrations/    Migrações versionadas do banco
scripts/                Migrações, empacotamento e dados de demonstração
tests/                  Testes automatizados
```

Mais informações sobre dados de demonstração e imagens: [database/README.md](database/README.md).

## Mesclar a branch publicada na main

A branch `deploy/vercel-supabase` contém a adaptação da hospedagem e as melhorias posteriores. Para levar essas alterações à branch principal pelo GitHub:

1. Abra a [comparação de branches](https://github.com/MatheusAcademics/Madero/compare/main...deploy/vercel-supabase).
2. Confira **base: `main`** e **compare: `deploy/vercel-supabase`**.
3. Clique em **Create pull request**, descreva as alterações e crie o pedido.
4. Confira os arquivos alterados e os checks disponíveis. Resolva conflitos antes de continuar, se houver.
5. Clique em **Merge pull request** e depois em **Confirm merge**.

O merge integra o código; ele não apaga nem reinicia o banco. Se a Vercel estiver configurada para publicar a `main` automaticamente, o merge pode iniciar um novo deploy.

Depois da mesclagem, atualize seu computador, com o diretório de trabalho limpo:

```powershell
git switch main
git pull --ff-only origin main
```

Não é necessário apagar a branch de desenvolvimento para concluir o merge.
