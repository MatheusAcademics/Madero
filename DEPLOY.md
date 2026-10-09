# Colocar o Madero na internet

O projeto está preparado para **Render + PostgreSQL + disco de imagens**. Nada foi publicado e nenhum serviço pago foi contratado nesta preparação.

**Atenção: o `render.yaml` cria recursos pagos quando você aprovar o Blueprint no Render.** Confira o total no painel antes de confirmar. Não é necessário comprar um domínio para começar.

Este é um projeto de demonstração, não o site oficial do Madero. O cadastro continua livre: quem criar uma conta terá acesso à área interna e às mesmas operações dos demais usuários. Publique somente dados fictícios, senhas exclusivas e imagens que você tem autorização para disponibilizar. Não use estoque real, contatos de clientes ou informações confidenciais.

## 1. Conferir o projeto local

Abra o terminal **na pasta que contém `app.js` e `package.json`**. Instale Node.js 24 atualizado. O `.node-version` mantém a série 24 no Render, permitindo suas atualizações de correção; `engines` impede mudança automática para outra versão principal. [Configuração de Node no Render](https://render.com/docs/node-version).

```powershell
npm ci
npm test
```

Para configurar outro computador, crie um `.env` usando `.env.example` como modelo **apenas se ainda não existir `.env`**. Não sobrescreva suas configurações atuais. Preencha os campos `DB_*` com o banco local e mantenha `NODE_ENV=development`.

Depois de conferir o banco de destino e guardar um backup se ele já contiver dados:

```powershell
npm run db:migrate
npm run serve
```

`db:migrate` cria as tabelas em um banco vazio e aplica atualizações pendentes em um banco compatível. Não cria o banco PostgreSQL em si, não importa registros, não cadastra usuários e não carrega os exemplos. O histórico é registrado em `schema_migrations`; não edite uma migração já aplicada. Se houver incompatibilidade, pare e revise o erro, sem apagar tabelas para contornar o problema.

`serve` inicia sem recarga automática. Para desenvolver, continue usando `npm start`. Se a porta 3000 estiver ocupada, defina `$env:PORT = '3001'` antes de iniciar.

## 2. Separar o código dos seus dados

```powershell
npm run release:pack
```

O comando gera um arquivo `.tar.gz` em `artifacts/` com o código necessário. **Não inclui `.env`, senhas de ambiente, `node_modules`, arquivos enviados por usuários nem o banco de dados.** As imagens de demonstração em `public/img/demo` fazem parte do código. Ainda assim, revise o conteúdo antes de compartilhá-lo: o empacotador não substitui uma revisão de segredos escritos diretamente em código.

Guarde separadamente, em local privado:

- Um backup do PostgreSQL, se quiser conservar os cadastros atuais.
- Uma cópia de `public/uploads/products/` e `public/uploads/avatars/`, ou do diretório indicado por `UPLOAD_DIR`.
- As configurações necessárias do `.env`, sem enviá-lo ao GitHub.

Código, banco e uploads são três coisas diferentes. Copiar somente o projeto não transfere as contas ou o estoque; copiar somente o banco não transfere as fotos enviadas.

## 3. Criar um repositório só deste site

O projeto já possui um repositório local na pasta correta. Antes de publicar, confirme com `git rev-parse --show-toplevel` que a raiz é exatamente a pasta que contém `app.js` e `package.json`. Se aparecer `C:/Users/ALUNO3B` ou outra pasta acima do projeto, **pare**: não faça `git add .` nem publique um repositório que possa incluir arquivos pessoais.

Você pode abrir o repositório atual no GitHub Desktop usando **File → Add local repository**, revisar os arquivos e publicar. Se preferir uma cópia separada e sem histórico antigo, extraia o pacote de `artifacts/` em **uma pasta nova e vazia**, escolhida só para esta publicação:

1. Escolha **File → New repository** e confira que a pasta do repositório é exatamente a pasta extraída, não `C:/Users/ALUNO3B`, Desktop inteiro ou outra pasta ampla.
2. Revise a lista de arquivos. Na raiz devem aparecer `app.js`, `package.json`, `render.yaml`, `.node-version` e `.gitignore`. Não deve aparecer `.env`, `public/uploads`, backups ou arquivos pessoais.
3. Faça o primeiro commit e use **Publish repository**, preferencialmente privado. Conceda ao Render acesso apenas a esse repositório quando conectar as contas.

Se preferir Git no terminal, confirme primeiro o resultado de `git rev-parse --show-toplevel`. Só prossiga quando a raiz for exatamente a pasta de publicação. O `.gitignore` protege arquivos ainda não rastreados; não remove segredos que já tenham sido enviados em commits antigos. Se alguma senha foi publicada antes, troque-a.

## 4. Criar os recursos no Render

No [painel do Render](https://dashboard.render.com/), escolha **New → Blueprint**, conecte o repositório e selecione o `render.yaml` da raiz. Revise a proposta antes de aprovar:

| Recurso | Configuração preparada |
| --- | --- |
| Site `madero-estoque` | Node.js, plano pago `0.5c-512mb`, uma instância |
| Banco `madero-db` | PostgreSQL, plano pago `0.1c-256mb`, 1 GB inicial |
| Fotos | Disco persistente de 1 GB, montado em `/var/data` |
| Região | Site e banco em `ohio` |
| Instalação | `npm ci` |
| Inicialização | `npm run db:migrate && npm run serve` |
| Verificação | `/healthz` |

Os identificadores de planos e campos foram conferidos em 9 de outubro de 2026. O preço e a disponibilidade apresentados pelo painel na contratação prevalecem. `autoDeployTrigger: "off"` desliga deploys automáticos por novos commits; **não impede a primeira publicação ao aprovar o Blueprint nem elimina cobranças**. [Referência de Blueprints](https://render.com/docs/blueprint-spec).

As variáveis do serviço são preenchidas pelo Blueprint:

| Variável | Valor/origem |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Conexão interna gerada a partir de `madero-db` |
| `SESSION_SECRET` | Segredo aleatório gerado pelo Render; nunca coloque no Git |
| `DB_SSL` | `disable`, somente para esta conexão privada interna |
| `TRUST_PROXY_HOPS` | `1`, para o proxy HTTPS do Render |
| `UPLOAD_DIR` | `/var/data/uploads` |

Não copie o `.env` local inteiro para o Render. A porta é fornecida pela plataforma e a aplicação escuta em `0.0.0.0`. As sessões ficam no PostgreSQL em produção; o cookie é protegido por HTTPS. Sem um `SESSION_SECRET` de pelo menos 32 bytes, a aplicação não inicia em produção.

O banco começa sem acesso externo (`ipAllowList: []`). O aplicativo usa sua rede privada, pois ambos estão na mesma região. Se conectar a um banco externo pela internet, use `DB_SSL=require` e um certificado válido; neste projeto essa opção **verifica** o certificado. Não use `disable` nem desligue a validação TLS para contornar erros em conexões externas. [Conexões do PostgreSQL no Render](https://render.com/docs/postgresql-creating-connecting).

Depois de aprovar a criação, acompanhe os logs. O endereço público aparece no painel, como `https://nome-do-servico.onrender.com`; use exatamente o endereço que o Render fornecer. Este projeto precisa de servidor Node e PostgreSQL, portanto não funciona como um simples upload no GitHub Pages. [Deploy de Express no Render](https://render.com/docs/deploy-node-express-app).

## 5. Escolher os dados da demonstração

### Opção A — começar com banco novo (mais simples)

Ao iniciar, as migrações criam a estrutura vazia. Acesse o site publicado e crie uma conta de demonstração com senha exclusiva. Cadastre categorias e produtos pela interface; as fotos enviadas já serão guardadas no disco persistente.

Para carregar os exemplos, abra **Shell** no serviço web e execute manualmente, apenas se desejar:

```sh
npm run demo:seed -- --user ID_DO_USUARIO --date AAAA-MM-DD
```

Substitua os dois marcadores pelo ID de uma conta existente e por uma data real, por exemplo `2026-10-09`. Confira o ID no banco; não suponha que será sempre `1`. A carga cria os registros `[DEMO]` e movimentações fictícias; não roda automaticamente ao publicar. As fotografias locais já acompanham o pacote. Veja [os dados de exemplo](database/README.md) e [as fontes das imagens](public/img/demo/FONTES.md).

### Opção B — levar os registros deste computador

Faça isso **antes de criar registros no site novo**. É um procedimento separado da publicação: as migrações não transferem o banco local.

1. Pare as alterações no sistema local durante a transferência. No pgAdmin, faça um backup completo em formato **Custom** e guarde-o fora do repositório. Ele contém dados pessoais e hashes de senha; trate-o como confidencial.
2. Deixe a primeira inicialização criar as tabelas no banco novo, transfira as fotos seguindo a seção 6 e suspenda temporariamente o serviço web para impedir cadastros durante a importação. O banco deve continuar disponível. Confirme que as quatro tabelas de negócio estão vazias: `categorias`, `usuarios`, `produtos` e `movimentacoes`. Se não estiverem, **pare**; não limpe tabelas nem restaure por cima.
3. No pgAdmin local, gere outro backup **Custom somente dos dados dessas quatro tabelas**: selecione-as na aba **Objects**, ative **Only data** em **Data Options** e **Use Column INSERTS** em **Table Options**. Isso evita depender da ordem física das colunas. Não inclua `schema_migrations` ou `user_sessions`. [Opções de backup do pgAdmin](https://www.pgadmin.org/docs/pgadmin4/latest/backup_dialog.html).
4. Para conectar o pgAdmin ao Render, permita temporariamente **apenas seu IP público** nas regras de acesso do banco, usando `/32` para IPv4. Use as informações da conexão externa do painel e TLS com verificação do certificado (`verify-full` no pgAdmin). Não compartilhe a URL, a senha ou capturas de tela desses campos.
5. Restaure o backup de dados no banco novo, em **uma única transação** (**Single transaction**, em **Query Options**), sem restaurar proprietário ou privilégios. Não ative **Clean before restore**, não desative os gatilhos e não use `DROP`/`TRUNCATE`. Uma falha deve interromper e reverter a importação; não ignore erros para continuar. Se necessário, peça ajuda com a mensagem sem incluir credenciais. [Opções de restauração do pgAdmin](https://www.pgadmin.org/docs/pgadmin4/latest/restore_dialog.html).
6. Antes de retomar o uso, ajuste as sequências de IDs no banco **de destino recém-importado** com o SQL abaixo. Isso evita que um novo cadastro tente reutilizar um ID trazido do banco local.

```sql
BEGIN;
SELECT setval(pg_get_serial_sequence('public.categorias', 'id_categoria'),
  COALESCE((SELECT MAX(id_categoria) FROM public.categorias), 1),
  EXISTS (SELECT 1 FROM public.categorias));
SELECT setval(pg_get_serial_sequence('public.usuarios', 'id_usuario'),
  COALESCE((SELECT MAX(id_usuario) FROM public.usuarios), 1),
  EXISTS (SELECT 1 FROM public.usuarios));
SELECT setval(pg_get_serial_sequence('public.produtos', 'id_produto'),
  COALESCE((SELECT MAX(id_produto) FROM public.produtos), 1),
  EXISTS (SELECT 1 FROM public.produtos));
SELECT setval(pg_get_serial_sequence('public.movimentacoes', 'id_movimentacao'),
  COALESCE((SELECT MAX(id_movimentacao) FROM public.movimentacoes), 1),
  EXISTS (SELECT 1 FROM public.movimentacoes));
COMMIT;
```

7. Compare quantidades de registros e saldos com o sistema local. Desfaça a permissão temporária do seu IP e deixe novamente o banco sem acesso externo. Retome o serviço web após concluir também a transferência das fotos descrita abaixo.

Não restaure o backup completo sobre tabelas que as migrações já criaram: isso causa conflitos. Para uma restauração completa de schema e dados, use outro banco totalmente vazio, revisado separadamente, antes de apontar a aplicação para ele. Mantenha o backup original até terminar todas as verificações. [Backups e restauração no Render](https://render.com/docs/postgresql-backups).

## 6. Conservar e transferir as fotos

As URLs continuam iguais, mas os arquivos físicos mudam de lugar:

| No computador | No disco do Render |
| --- | --- |
| `public/uploads/products/` | `/var/data/uploads/products/` |
| `public/uploads/avatars/` | `/var/data/uploads/avatars/` |

Copie os arquivos privados de backup por **SFTP/SCP**, usando o usuário/host SSH exibidos pelo serviço Render. Não coloque fotos de usuários no GitHub nem em um link público temporário. Preserve exatamente os nomes UUID e a extensão dos arquivos. Não sobreponha arquivos diferentes com o mesmo nome: confira antes de copiar.

Se estiver usando um `UPLOAD_DIR` diferente no computador, copie os subdiretórios `products` e `avatars` dele. Imagens de demonstração em `/img/demo/` já estão no código e não precisam dessa transferência. Links externos de imagens dependem do site original continuar disponível.

Faça backups do banco **e** dessas duas pastas. O disco só persiste dados dentro de `/var/data`; o restante do filesystem do serviço é temporário. Com disco local o serviço fica limitado a uma instância e poderá ter uma breve interrupção durante deploys. Se precisar escalar, migre as imagens para armazenamento de objetos em uma etapa futura. [Discos e transferência de arquivos no Render](https://render.com/docs/disks).

## 7. Verificar antes de compartilhar o link

- Abra `/healthz`: deve retornar HTTP 200 e `{"status":"ok"}` quando banco e pasta de uploads estiverem acessíveis.
- Teste Home, Cardápio e Sobre nós em celular e computador.
- Cadastre uma conta fictícia, entre e saia. Confira se a área interna exige login.
- Teste uma categoria, um produto com foto, uma movimentação e a foto de perfil.
- Faça um deploy manual e confira se cadastros e fotos continuam presentes.
- Revise todos os registros antes de permitir acesso público. Troque senhas simples ou reutilizadas.
- Não publique contatos reais; e-mail e telefone cadastrados são visíveis na área interna conforme as permissões atuais. Fotos em `/uploads/` são arquivos públicos.

Em produção há validação de origem das requisições que alteram dados e limites por IP: 120 alterações por minuto, 30 tentativas de login malsucedidas em 15 minutos e 20 cadastros por hora. Os contadores ficam na memória de uma instância, reiniciam com o processo e podem afetar colegas que usam o mesmo IP da escola. Essas medidas **não substituem** controle de permissões, auditoria de segurança ou proteção contra abuso em um sistema comercial.

Ainda não existem cargos de administrador/operador, aprovação de contas, verificação de e-mail ou recuperação de senha por e-mail. Antes de transformar a demonstração em sistema real, essas regras precisam ser definidas e implementadas.

## Atualizações e problemas comuns

Depois de testar uma alteração, envie somente o código ao repositório escolhido e use **Manual Deploy** no Render. Se mudar o `render.yaml`, revise a sincronização do Blueprint separadamente: ela pode alterar recursos cobrados. Não altere a região/nome do banco nem o caminho do disco sem planejar a migração.

| Problema | O que conferir |
| --- | --- |
| Falha antes de iniciar | `SESSION_SECRET`, `DATABASE_URL` e logs das migrações, sem compartilhar seus valores |
| `/healthz` retorna 503 | Conexão do banco e permissão/espaço do disco de uploads |
| Login volta para a tela inicial | HTTPS público, `NODE_ENV=production`, `TRUST_PROXY_HOPS=1` e migração de sessões aplicada |
| Imagem antiga não aparece | Banco foi importado, mas o arquivo correspondente talvez não tenha sido copiado |
| Fotos desaparecem após deploy | `UPLOAD_DIR` deve ficar dentro do disco montado, em `/var/data/uploads` |
| HTTP 403 ao enviar formulário | Abra o endereço HTTPS correto diretamente; não use iframe, domínio intermediário ou cliente sem origem válida |
| HTTP 429 | Aguarde o limite por IP; não desative a proteção só para repetir tentativas |
| Erro ao reaplicar uma migração | Não edite migrações antigas; crie uma nova atualização e mantenha o histórico |

Nenhum comando desta preparação cria conta no Render, faz push no GitHub ou contrata hospedagem automaticamente. A publicação depende da sua aprovação no painel.
