# Atualização do cadastro

## Executar e testar

Use Node.js 24 (versão usada na validação). `npm install` instala as dependências,
`npm start` inicia com recarga nativa do Node, e `npm run serve` inicia sem
recarga. `npm test` executa a suíte isolada. O antigo `nodemon` foi removido
para eliminar dependências vulneráveis sem perder a recarga no desenvolvimento.

Se outro projeto estiver usando a porta 3000, no PowerShell execute
`$env:PORT = '3001'` antes de `npm start` e abra `http://localhost:3001`.
Sem `PORT`, o site mantém a porta 3000.

A conexão usa as variáveis `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` e
`DB_PASSWORD` do `.env`. Não coloque senhas nos arquivos SQL nem no Git.

## Foto do usuário

Execute `migrations/002_user_avatar.sql` no mesmo banco do projeto. Essa
migração já foi aplicada no ambiente de demonstração em 6 de outubro de 2026.
Ela adiciona apenas `usuarios.foto TEXT`, opcional, sem mudar contas ou senhas.

A foto é opcional no cadastro público e interno. Na área interna, clique no
seu nome/foto no cabeçalho para editar o perfil; também é possível editar
pelo menu **Usuários**. Aceita JPG, PNG e WebP de até 5 MB e 25 megapixels.
Sem foto, aparecem as iniciais. O controle **Remover foto atual** só aplica
a remoção ao salvar, e nunca apaga o arquivo físico automaticamente.

Os arquivos ficam em `public/uploads/avatars/` (WebP, até 512 pixels).
Inclua essa pasta nos backups, além do banco e das imagens dos produtos.
Fotos são servidas como arquivos públicos, por isso não envie imagens sensíveis.

## Dados de demonstração

Foram criadas 4 categorias, 8 produtos com fotografias oficiais reais e 16
movimentações fictícias, com marcações `[DEMO]`. Não são preços nem saldos
oficiais do Madero. Os registros que já existiam foram preservados.

```powershell
npm run demo:images
npm run demo:seed -- --user 1 --date 2026-10-06
```

`--user` deve ser o ID de um usuário existente, que ficará associado aos
movimentos identificados explicitamente como fictícios. `--date` define a
data de referência dos exemplos; os movimentos ficam nos dias anteriores.
A carga foi aplicada com o usuário de ID 1, a única conta existente.

A execução é transacional e pode ser repetida sem duplicar os exemplos nem
repor quantidades já editadas. Os movimentos de origem também identificam
produtos renomeados. A carga nunca atualiza ou apaga registros existentes.
Confira a origem das fotografias em `public/img/demo/FONTES.md`.

## Imagens dos produtos

O cadastro e a edição de produtos aceitam um arquivo JPG, PNG ou WebP de até
5 MB e 25 megapixels. Basta selecionar a foto e salvar o formulário. Também
é possível usar um link direto para uma imagem (não o endereço de uma página).
Se ambos forem preenchidos, o arquivo escolhido tem prioridade.

Não há migração: a coluna existente `produtos.imagem` guarda o caminho da foto.
Os arquivos enviados são validados, convertidos em WebP e salvos em
`public/uploads/products/`, pasta criada automaticamente no primeiro envio.
O lado maior é limitado a 2400 pixels, sem ampliar fotos pequenas.

Inclua essa pasta no backup junto com o banco: somente copiar o PostgreSQL
não copia as fotos. A pasta não entra no Git. Em uma hospedagem, ela precisa
de armazenamento persistente e permissão de escrita. As fotos são servidas
como arquivos públicos; não envie documentos ou imagens sensíveis.

Ao corrigir outros campos após um erro de validação, selecione o arquivo
novamente quando solicitado. Se a imagem já foi salva antes de uma falha do
banco, seu caminho é preservado no formulário para permitir uma nova tentativa.
Imagens antigas não são excluídas automaticamente ao substituir ou excluir um
produto, pois podem estar sendo usadas por outro registro.

## E-mail e telefone

No pgAdmin, abra o **Query Tool do banco configurado em `DB_NAME`** e execute
`migrations/001_registration_contact.sql`. A tabela `public.usuarios` deve
existir. O script é transacional, não apaga dados e pode ser reaplicado.

- Acrescenta `email` e `telefone`, ambos do tipo `TEXT`.
- Mantém `NULL` para as contas antigas, que continuam podendo fazer login.
- Exige e-mail nos novos cadastros pela validação do servidor.
- Impede e-mails repetidos por índice único, ignorando maiúsculas e espaços
  no início e no fim.
- Telefone é opcional. A aplicação salva somente os dígitos, preservando o
  sinal `+` quando informado no início.
- Confirmação de senha é apenas uma validação; não existe coluna para ela.

Se houver um erro, não apague tabelas nem contas para contorná-lo. Execute
`ROLLBACK;` se a transação ainda estiver aberta e confira a mensagem. Caso
as colunas já existam com outro formato ou haja e-mails duplicados, revise
esses dados antes de reaplicar.

Essa migração não configura envio de e-mail, recuperação de senha, convites
ou aprovação de acesso. O cadastro permanece livre para a demonstração.

## Teste de integração opcional

`npm test` executa os testes isolados, sem depender do banco. Para conferir
cadastro, duplicidade de e-mail e login usando o PostgreSQL real da demonstração,
rode no PowerShell:

```powershell
$env:MADERO_DB_INTEGRATION = '1'
node --test tests/registration-postgres.test.cjs
Remove-Item Env:\MADERO_DB_INTEGRATION
```

O teste usa apenas dados fictícios e desfaz as inserções com `ROLLBACK`, mesmo
em caso de falha. Não deixa contas de teste salvas; as sequências de IDs podem
avançar, porque o PostgreSQL não desfaz números já reservados.
