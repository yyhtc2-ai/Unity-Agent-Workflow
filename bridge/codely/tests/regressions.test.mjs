import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runCommand } from '../dist/exec.js';
import { replaceFile } from '../dist/atomic-file.js';

const temp = label => mkdtempSync(join(tmpdir(), label));
const text = r => r.content?.map(c => c.text || '').join('\n') || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(state = temp('codely-state-'), extraEnv = {}) {
 const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server.js')],
  env: {...process.env, BRIDGE_STATE_DIR: state, BRIDGE_EXPOSE: 'codely', BRIDGE_CODELY_ENTRY: resolve('tests/fake-codely.mjs'),
   BRIDGE_MAX_OUTPUT_BYTES: '4096', BRIDGE_MAX_EVENT_BYTES: '65536', BRIDGE_MAX_ARTIFACT_BYTES: '50000',
   BRIDGE_WAIT_CAP_MS: '500', BRIDGE_JOB_TIMEOUT_MS: '15000', ...extraEnv}, stderr: 'pipe' });
 const client = new Client({name:'regression-client',version:'1'});
 await client.connect(transport);
 return {client, transport, state, close:()=>client.close()};
}
const call = (h,name,args) => h.client.callTool({name,arguments:args});
const ask = (h,cwd,task,background=false) => call(h,'ask_codely',{cwd,task_type:'implementation',task,background});
const recover = (h,id) => call(h,'recover_job',{job_id:id,confirm_no_writers:true,evidence:'Isolated fixture: recorded bridge and CLI stopped, no descendants or real project changes'});

test('P0: full task and fixed policy use argv; oversized tasks never spawn',async()=>{
 const h=await open(), cwd=temp('prompt-space-中文-');
 try{
  const r=await ask(h,cwd,'RECEIPT_X79 Technical task: $(literal) & echo NOT_EXECUTED');
  assert.equal(r.isError,undefined,text(r));assert.match(text(r),/RECEIPT_X79/);assert.match(text(r),/"policyOk":true/);
  const tooLarge=await ask(h,cwd,'X'.repeat(25000));
  assert.equal(tooLarge.isError,true);assert.match(text(tooLarge),/nothing was dispatched/);
  assert.equal(tooLarge.structuredContent.pid,undefined);
 }finally{await h.close();}
});

test('P1: null and malformed event payloads fail one job; bridge stays usable',async()=>{
 const h=await open(),cwd=temp('bad-event-');
 try{
  for(const task of ['TEST_NULL','TEST_BAD_CONTENT','TEST_OVERSIZE_EVENT']){
   const r=await ask(h,cwd,task);assert.equal(r.isError,true,text(r));
   assert.match(text(r),/Invalid Codely stream event shape|exceeds BRIDGE_MAX_EVENT_BYTES/);
   assert.equal((await h.client.listTools()).tools.length,5);
  }
  assert.equal((await ask(h,cwd,'valid technical task')).isError,undefined);
 }finally{await h.close();}
});

test('P2: large single event keeps a prefix and full artifact, flags incomplete, caps UTF-8 response bytes',async()=>{
 const h=await open(),cwd=temp('output-cap-');
 try{
  for(const [task,expected] of [['TEST_LARGE','X'.repeat(20000)],['TEST_UNICODE','测'.repeat(4000)]]){
   const r=await ask(h,cwd,task);
   assert.equal(r.isError,true);assert.equal(r.structuredContent.status,'incomplete');
   assert.equal(r.structuredContent.execution_success,true);
   assert.equal(r.structuredContent.independent_acceptance,false);
   assert.ok(Buffer.byteLength(text(r))<=4096);
   assert.ok(!text(r).includes('\uFFFD'));
   assert.ok(text(r).includes(expected.slice(0,10)));
   assert.equal(readFileSync(r.structuredContent.result_path,'utf8'),expected);
  }
  const split=await ask(h,cwd,'TEST_UTF8_SPLIT');
  assert.equal(split.isError,undefined,text(split));assert.match(text(split),/中文🙂/);
 }finally{await h.close();}
});

test('P1: two bridge processes share one exclusive project lease',async()=>{
 const state=temp('shared-state-'), a=await open(state),b=await open(state),cwd=temp('shared-project-');
 let id;
 try{
  const started=await ask(a,cwd,'TEST_SLOW',true);id=started.structuredContent.job_id;
  const conflict=await ask(b,cwd,'another writer',true);
  assert.equal(conflict.isError,true);assert.match(text(conflict),/active or unresolved job/);
  assert.equal((await recover(b,id)).isError,true,'must not recover a live owner');
  assert.equal((await call(b,'cancel_job',{job_id:id})).isError,true,'cannot kill a foreign owner');
  await call(a,'cancel_job',{job_id:id});await call(a,'wait_job',{job_id:id});id=undefined;
  assert.equal((await ask(b,cwd,'new technical task')).isError,undefined);
 }finally{
  if(id){await call(a,'cancel_job',{job_id:id});await call(a,'wait_job',{job_id:id});}
  await a.close();await b.close();
 }
});

test('P1: snapshots survive restart and job UUIDs are never reused',async()=>{
 const state=temp('restart-state-'),cwd=temp('restart-project-');
 let h=await open(state),first;
 try{first=await ask(h,cwd,'RECEIPT_OLD');}finally{await h.close();}
 h=await open(state);
 try{
  const previous=await call(h,'check_job',{job_id:first.structuredContent.job_id});
  assert.equal(previous.structuredContent.status,'done');assert.match(text(previous),/RECEIPT_OLD/);
  const next=await ask(h,cwd,'RECEIPT_NEW');
  assert.notEqual(next.structuredContent.job_id,first.structuredContent.job_id);
  assert.match(text(next),/RECEIPT_NEW/);
 }finally{await h.close();}
});

test('P1: crash retains the lease, exposes interrupted state and requires explicit recovery',async()=>{
 const state=temp('crash-state-'),cwd=temp('crash-project-');
 const a=await open(state);let b,cliPid;
 try{
  const started=await ask(a,cwd,'TEST_SLOW',true),id=started.structuredContent.job_id;
  cliPid=started.structuredContent.pid;
  await sleep(200);process.kill(a.transport.pid,'SIGKILL');await a.close();
  b=await open(state);
  const old=await call(b,'check_job',{job_id:id});
  assert.equal(old.structuredContent.status,'interrupted');
  assert.equal((await ask(b,cwd,'do not replay',true)).isError,true);
  // The direct process may already be gone on some hosts. Stop only the PID created by this fixture.
  try{process.kill(cliPid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  for(let i=0;i<50;i++){
   try{process.kill(cliPid,0);await sleep(50);}catch{break;}
  }
  const fixed=await recover(b,id);assert.equal(fixed.structuredContent.status,'failed',text(fixed));
  assert.match(text(fixed),/not replayed/);
  assert.equal((await ask(b,cwd,'RECEIPT_RECOVERED')).isError,undefined);
 }finally{
  if(cliPid)try{process.kill(cliPid,'SIGKILL');}catch{}
  await a.close();if(b)await b.close();
 }
});

test('P2: native output capture counts bytes, handles split UTF-8 and isolates callback errors',async()=>{
 const r=await runCommand(process.execPath,['-e',"process.stdout.write('测测测');process.stderr.write('🙂🙂🙂')"],
  {direct:true,timeoutMs:5000,maxOutputBytes:5});
 assert.ok(Buffer.byteLength(r.stdout)<=5);assert.equal(r.stdout,'测');assert.equal(r.stderr,'🙂');assert.equal(r.truncated,true);
 await assert.rejects(runCommand(process.execPath,['-e',"console.log('hello')"],
  {direct:true,timeoutMs:5000,maxOutputBytes:4096,onStdoutChunk(){throw new Error('fixture callback error');}}),/output handler failed/);
});

test('P2: legacy setup refuses all config mutations, including --dry-run',()=>{
 const home=temp('legacy-config-');
 for(const args of [['setup'],['setup','--dry-run']]){
  const r=spawnSync(process.execPath,['dist/cli.js',...args],{env:{...process.env,CODEX_HOME:home},encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/Legacy qantara setup is disabled/);
  assert.deepEqual(readdirSync(home),[]);
 }
});

test('P2: bounded disk artifacts explicitly report incomplete preservation',async()=>{
 const h=await open(temp('small-artifact-state-'),{BRIDGE_MAX_ARTIFACT_BYTES:'100'}),cwd=temp('small-artifact-project-');
 try{
  const r=await ask(h,cwd,'TEST_UNICODE');
  assert.equal(r.structuredContent.status,'incomplete');assert.equal(r.structuredContent.artifact_truncated,true);
  assert.ok(Buffer.byteLength(readFileSync(r.structuredContent.result_path))<=100);
  assert.ok(!readFileSync(r.structuredContent.result_path,'utf8').includes('\uFFFD'));
 }finally{await h.close();}
});

test('real account test requires explicit opt-in before probing any CLI',()=>{
 const r=spawnSync(process.execPath,['tests/live-e2e.mjs'],{
  env:{...process.env,BRIDGE_CODELY_ENTRY:resolve('not-installed-codely.mjs')},encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stderr,/explicit user authorization/);
});

test('Windows sharing violations retry without deleting the previous execution snapshot',()=>{
 const root=temp('replace-retry-'),source=join(root,'new.json'),target=join(root,'old.json');
 writeFileSync(source,'new');writeFileSync(target,'old');let attempts=0;
 replaceFile(source,target,(a,b)=>{
  attempts++;
  if(attempts<=2)throw Object.assign(new Error('fixture sharing violation'),{code:'EPERM'});
  renameSync(a,b);
 },()=>{});
 assert.equal(attempts,3);assert.equal(readFileSync(target,'utf8'),'new');
 writeFileSync(source,'next');attempts=0;
 assert.throws(()=>replaceFile(source,target,()=>{attempts++;throw Object.assign(new Error('locked'),{code:'EACCES'});},()=>{}),/locked/);
 assert.equal(attempts,8);assert.equal(readFileSync(target,'utf8'),'new');assert.equal(readFileSync(source,'utf8'),'next');
 attempts=0;
 assert.throws(()=>replaceFile(source,target,()=>{attempts++;throw Object.assign(new Error('disk error'),{code:'EIO'});},()=>{}),/disk error/);
 assert.equal(attempts,1);
});

test('execution snapshots tolerate rapid updates while another bridge queries them',async()=>{
 const state=temp('snapshot-stress-'),a=await open(state),b=await open(state),cwd=temp('snapshot-project-');
 try{
  const r=await ask(a,cwd,'TEST_PROGRESS_BURST',true),id=r.structuredContent.job_id;
  for(let i=0;i<20;i++){
   const progress=await call(b,'check_job',{job_id:id});
   if(progress.structuredContent.status==='done')break;
   assert.equal(progress.structuredContent.status,'running',text(progress));
   await sleep(10);
  }
  const finished=await call(a,'wait_job',{job_id:id});
  assert.equal(finished.isError,undefined,text(finished));assert.match(text(finished),/burst completed/);
 }finally{await a.close();await b.close();}
});
