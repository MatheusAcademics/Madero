const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { deleteAccount } = require('../lib/delete-account');

async function fixture({history=false, missing=false, storageFails=false, writeFails=false}={}) {
 const calls=[];
 const hash=await bcrypt.hash('fixture-password',4);
 const photo='/uploads/avatars/12345678-1234-1234-1234-123456789abc.webp';
 const client={async query(sql,values){calls.push({sql,values});
  if(sql.startsWith('SELECT id_usuario'))return {rows:missing?[]:[{id_usuario:7,senha:hash,foto:photo}]};
  if(sql.startsWith('SELECT 1 FROM movimentacoes'))return {rows:history?[{one:1}]:[]};
  if(sql.startsWith('SELECT to_regclass'))return {rows:[{name:'user_sessions'}]};
  if(writeFails && /^(UPDATE|DELETE FROM usuarios)/.test(sql))throw Error('write failed');
  return {rows:[]};},release(){calls.push({sql:'RELEASE'});}};
 const pool={async connect(){return client;}};
 const remove=async p=>{calls.push({sql:'REMOVE_AVATAR',photo:p});if(storageFails)throw Error('storage failed');};
 return {calls,run:(password='fixture-password',confirmed='excluir')=>deleteAccount(pool,7,password,confirmed,remove),photo};
}
test('self deletion: password and explicit confirmation required before destructive writes',async()=>{
 for(const [password,confirmation] of [['fixture-password',''],['wrong','excluir'],['','excluir']]){
  const h=await fixture();await assert.rejects(h.run(password,confirmation));
  assert.equal(h.calls.some(c=>/^(UPDATE|DELETE|REMOVE)/.test(c.sql)),false);
 }
});
test('self deletion: no history deletes account, avatar and every stored session without resetting IDs',async()=>{
 const h=await fixture();assert.deepEqual(await h.run(),{anonymized:false});
 assert.ok(h.calls.some(c=>c.sql.includes('FOR UPDATE')));
 assert.deepEqual(h.calls.find(c=>c.sql==='DELETE FROM usuarios WHERE id_usuario = $1').values,[7]);
 assert.equal(h.calls.find(c=>c.sql==='REMOVE_AVATAR').photo,h.photo);
 assert.deepEqual(h.calls.find(c=>c.sql.startsWith('DELETE FROM public.user_sessions')).values,['7']);
 assert.equal(h.calls.at(-2).sql,'COMMIT');assert.equal(h.calls.at(-1).sql,'RELEASE');
 assert.equal(h.calls.some(c=>/RESTART|setval|TRUNCATE/i.test(c.sql)),false);
});
test('self deletion: history keeps same ID but removes identity and credentials',async()=>{
 const h=await fixture({history:true});assert.deepEqual(await h.run(),{anonymized:true});
 const update=h.calls.find(c=>c.sql.startsWith('UPDATE'));
 assert.match(update.sql,/nome = 'Conta excluída'/);assert.match(update.sql,/senha = ''/);
 for(const column of ['email','telefone','foto'])assert.ok(update.sql.includes(column+' = NULL'));
 assert.equal(update.values[0],7);assert.match(update.values[1],/^conta_excluida_[a-f0-9-]{36}$/);
 assert.equal(h.calls.some(c=>/^DELETE FROM (usuarios|movimentacoes)/.test(c.sql)),false);
});
test('self deletion: missing accounts, storage and database failures rollback and release',async()=>{
 for(const config of [{missing:true},{storageFails:true},{writeFails:true}]){
  const h=await fixture(config);await assert.rejects(h.run());
  assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(h.calls.at(-1).sql,'RELEASE');
  assert.equal(h.calls.some(c=>c.sql==='COMMIT'),false);
 }
});
