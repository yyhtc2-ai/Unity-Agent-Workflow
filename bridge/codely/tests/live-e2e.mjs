// Opt-in real account test. Never invoked by npm test, verify.py or offline CI.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const existingFlag=process.argv.indexOf('--verify-existing');
const existing=existingFlag>=0?JSON.parse(readFileSync(join(resolve(process.argv[existingFlag+1]),'summary.json'),'utf8')):null;
if (!process.argv.includes('--allow-model-call') && !existing) {
 console.error('Real Codely calls consume account quota and require explicit user authorization. Re-run with --allow-model-call only within that authorized scope.');
 process.exit(2);
}
const temp = label => mkdtempSync(join(tmpdir(),label));
const project = existing?.project ?? join(temp('codely-live-project-'),'Unity Project 中文');
const evidence = existing?.evidence ?? temp('codely-live-evidence-'); // separate root; no verifier files are placed beside the project
const state = join(evidence,'state');
const nonce = existing?.receipt ?? 'TransportProbe_'+randomUUID().replaceAll('-','');
const taskId = existing?.task_id ?? 'E2E-'+randomUUID();
let entry = process.env.BRIDGE_CODELY_ENTRY;
if (!entry && !existing) {
 const npmRoot = (process.platform === 'win32'
  ? execFileSync('cmd.exe',['/d','/c','npm root -g'],{encoding:'utf8'})
  : execFileSync('npm',['root','-g'],{encoding:'utf8'})).trim();
 entry=join(npmRoot,'@codely/cli/bundle/gemini.js');
}
if(!existing)assert.ok(existsSync(entry),'Installed Codely CLI is required');
const cliVersion=existing?.cli_version ?? execFileSync(process.execPath,[entry,'--version'],{encoding:'utf8'}).trim();
const baselineFiles={
 'AGENTS.md':'Isolated technical fixture. Work only inside this project. Never read parent directories, host tests, evidence, user configuration or external files. Task specifications are in the user prompt. Only write the assigned module. No Unity Editor, shell commands, nested agents, visual design or image operations.\n',
 'Assets/Keep.txt':'KEEP_UNCHANGED\n',
 'Assets/Keep.txt.meta':'fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
 'Packages/manifest.json':'{"dependencies":{}}\n',
 'ProjectSettings/ProjectVersion.txt':'m_EditorVersion: 6000.0.0f1\n',
};
function put(root,name,body){const p=join(root,name);mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,body);}
if(!existing)for(const [name,body] of Object.entries(baselineFiles))put(project,name,body);
function files(root,prefix=''){
 return readdirSync(join(root,prefix),{withFileTypes:true}).flatMap(d=>{
  const name=prefix?`${prefix}/${d.name}`:d.name;
  return d.isDirectory()?files(root,name):[name];
 });
}
const digest = data=>createHash('sha256').update(data).digest('hex');
const baseline=Object.fromEntries(Object.entries(baselineFiles).map(([name,body])=>[name,digest(Buffer.from(body))]));
const task = `Task ${taskId}. Authorized project: ${project}. Implement one file audit-meta.mjs at the project root, using only Node built-ins. Export const dispatchReceipt = "${nonce}" and named async function auditUnityMeta(projectRoot). The receipt MUST match exactly; it exists only in this prompt, not in fixture files.
Specification: recursively inspect Assets inside projectRoot; return [] if Assets is absent. Skip all dot-prefixed entries and all symlinks/junctions. Never traverse or read outside Assets while auditing. For each regular non-.meta file with no adjacent .meta, report {kind:"missing-meta",path:<asset path>}; do not require .meta for directories. For each .meta with no corresponding file OR directory, report {kind:"orphan-meta",path:<meta path>}. A valid guid is a line "guid: " plus exactly 32 hex characters (normal whitespace and CRLF allowed); report {kind:"invalid-guid",path:<meta path>} if absent. For each GUID repeated case-insensitively, report ONE {kind:"duplicate-guid",guid:<lowercase>,paths:[<all matching meta paths sorted>]}. Paths are project-relative with forward slashes and Unicode preserved. Return only these defined fields in a deterministic array. The audit function must never write anything. No CLI entry point or dependencies needed.
Allowed writes: audit-meta.mjs only; preserve all baseline files. CLI-owned .codely-cli autosaves are a known separate side effect. Do not read parent directories, other projects, logs, host tests, task databases, evidence or user configuration. Do not run shell commands, Unity, external MCP/editor tools, nested agents, git operations, network or visual/image operations. If you lack this prompt/specification, stop rather than search for it. Codex owns architecture and will run independent tests AFTER you exit; no test files are provided to you. Final reply must include task ID, exact receipt, changed path, checks actually run, and limitations.`;
const summary=existing?{...existing,status:'reverifying',reverified_at:new Date().toISOString()}:{task_id:taskId,receipt:nonce,project,evidence,cli_version:cliVersion,started_at:new Date().toISOString(),status:'running'};
function save(){writeFileSync(join(evidence,'summary.json'),JSON.stringify(summary,null,2));}
save();console.log(JSON.stringify({project,evidence,task_id:taskId}));
const client = new Client({name:'real-codely-acceptance',version:'1'});
const transport = new StdioClientTransport({command:process.execPath,args:[resolve('dist/server.js')],
 env:{...process.env,BRIDGE_CODELY_ENTRY:entry||'',BRIDGE_EXPOSE:'codely',BRIDGE_STATE_DIR:state,
  BRIDGE_JOB_TIMEOUT_MS:'300000',BRIDGE_WAIT_CAP_MS:'10000',BRIDGE_MAX_OUTPUT_BYTES:'16000'},stderr:'pipe'});
const text=r=>r.content?.map(c=>c.text||'').join('\n')||'';
const call=(name,args)=>client.callTool({name,arguments:args});
const python=process.env.PYTHON || (process.platform==='win32'?'python':'python3');
const ledger=resolve('../../skills/cowork-collaboration/scripts/ledger.py');
const ledgerCall=(...args)=>JSON.parse(execFileSync(python,[ledger,'--db',join(evidence,'handoffs.sqlite3'),...args],{encoding:'utf8'}));
const handoff=existing?{id:existing.handoff_id}:ledgerCall('create','--project',project,'--session','Codely CLI','--objective',taskId,
 '--scope','Only audit-meta.mjs; no editor, external files, nested agents or visual work',
 '--acceptance','Full prompt receipt, 14 independent cases, preserved baseline and observed file scope',
 '--baseline','Five fresh fixture files; SHA256 held by host before dispatch');
summary.handoff_id=handoff.id;save();
let phase=existing?'reverification':'prepared';
const transition=(next,note,evidenceText)=>{
 if(existing){ledgerCall('note',handoff.id,'--text','No new CLI dispatch; independent '+next+': '+note+(evidenceText?' Evidence: '+evidenceText:''));return;}
 const args=['transition',handoff.id,'--from',phase,'--to',next,'--note',note];
 if(evidenceText)args.push('--evidence',evidenceText);
 ledgerCall(...args);phase=next;
};
let jobId;
try {
 let result;
 if(existing){
  result={structuredContent:existing.execution,content:[{type:'text',text:existing.answer}],...(existing.execution.status==='done'?{}:{isError:true})};
 }else{
 await client.connect(transport);
 transition('sending','Dispatch authorized isolated task through repository build');
 const started=await call('ask_codely',{cwd:project,task_type:'implementation',task,background:true});
 assert.ok(!started.isError,text(started));jobId=started.structuredContent.job_id;
 summary.job_id=jobId;save();
 transition('sent','Bridge job '+jobId);
 let last='';
 do {
  result=await call('wait_job',{job_id:jobId});
  const m=result.structuredContent;
  if(m.status==='running'||m.status==='cancelling'){
   if(phase==='sent')transition('running','Observed CLI PID '+m.pid+' session '+m.session_id);
   const progress=text(result);if(progress!==last){console.log(progress);last=progress;}
  }
 }while(['running','cancelling'].includes(result.structuredContent.status));
 }
 summary.execution=result.structuredContent;summary.answer=text(result);save();
 transition('awaiting_verification','CLI terminal result collected; independent acceptance pending');
 assert.equal(result.isError,undefined,text(result));assert.equal(result.structuredContent.status,'done');
 assert.match(text(result),new RegExp(nonce));
 // Verify actual received prompt, not an inferred model success message.
 const autosaves=join(project,'.codely-cli/auto-saves');
 const sessionFile=readdirSync(autosaves).find(n=>n.endsWith('.json'));
 const session=JSON.parse(readFileSync(join(autosaves,sessionFile),'utf8'));
 const users=session.conversationRecord.messages.filter(m=>m.type==='user' && !m.attachmentMeta?.isMeta);
 assert.ok(users.some(m=>typeof m.content==='string'&&m.content.includes(task)&&m.content.includes('[Codex delegation policy]')),'full brief and policy absent from actual received prompt');
 summary.prompt_delivery_verified=true;summary.model_usage=session.modelUsage;
 const outside=[];
 for(const message of session.conversationRecord.messages)for(const tool of message.toolCalls||[]){
  if(!['read_file','list_directory','write_file'].includes(tool.name))continue;
  const args=typeof tool.args==='string'?JSON.parse(tool.args):tool.args;
  assert.ok(args&&typeof args==='object','unrecognized filesystem tool argument schema');
  const path=args.absolute_path||args.file_path||args.path;
  assert.equal(typeof path,'string','cannot verify filesystem tool target');
  if(typeof path==='string'&&isAbsolute(path)){
   const rel=relative(project,path);
   if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))outside.push({tool:tool.name,path});
   if(tool.name==='write_file')assert.equal(rel.split(sep).join('/'),'audit-meta.mjs','worker wrote outside assigned file');
  }
 }
 assert.deepEqual(outside,[],'worker read outside isolated project');summary.outside_project_reads=outside;
 // Behavioral expectations are constructed in host memory after the worker has exited.
 const {auditUnityMeta,dispatchReceipt}=await import(pathToFileURL(join(project,'audit-meta.mjs')));
 assert.equal(dispatchReceipt,nonce);assert.equal(typeof auditUnityMeta,'function');
 const A='a'.repeat(32),B='b'.repeat(32),meta=g=>'fileFormatVersion: 2\nguid: '+g+'\n';
 let passed=0;
 const cases=[
  ['clean',{'Assets/a.asset':'x','Assets/a.asset.meta':meta(A)},[]],
  ['missing',{'Assets/a.asset':'x'},[{kind:'missing-meta',path:'Assets/a.asset'}]],
  ['orphan',{'Assets/a.asset.meta':meta(A)},[{kind:'orphan-meta',path:'Assets/a.asset.meta'}]],
  ['invalid',{'Assets/a.asset':'x','Assets/a.asset.meta':'guid: nope\n'},[{kind:'invalid-guid',path:'Assets/a.asset.meta'}]],
  ['empty',{'Assets/a.asset':'x','Assets/a.asset.meta':''},[{kind:'invalid-guid',path:'Assets/a.asset.meta'}]],
  ['duplicate',{'Assets/a.asset':'x','Assets/a.asset.meta':meta(A),'Assets/b.asset':'y','Assets/b.asset.meta':meta(A.toUpperCase())},[{kind:'duplicate-guid',guid:A,paths:['Assets/a.asset.meta','Assets/b.asset.meta']}]],
  ['unicode',{'Assets/目录/a.asset':'x','Assets/目录/a.asset.meta':meta(B)},[]],
  ['hidden',{'Assets/.hidden':'x','Assets/.cache/file':'x','Assets/.hidden.meta':'bad'},[]],
  ['folder-meta',{'Assets/Sub.meta':meta(A),'Assets/Sub/a.asset':'x','Assets/Sub/a.asset.meta':meta(B)},[]],
  ['absent-assets',{},[]],
  ['orphan-invalid-combined',{'Assets/ghost.meta':'guid: nope\n'},[{kind:'invalid-guid',path:'Assets/ghost.meta'},{kind:'orphan-meta',path:'Assets/ghost.meta'}]],
  ['crlf',{'Assets/a.asset':'x','Assets/a.asset.meta':'guid: '+A.toUpperCase()+'\r\n'},[]],
 ];
 const normalize=xs=>xs.map(x=>JSON.stringify(x,Object.keys(x).sort())).sort();
 for(const [name,data,expected] of cases){
  const root=temp('meta-live-case-');for(const [file,body] of Object.entries(data))put(root,file,body);
  const actual=await auditUnityMeta(root);assert.ok(Array.isArray(actual));assert.deepEqual(normalize(actual),normalize(expected),name);
  assert.deepEqual(await auditUnityMeta(root),actual,'deterministic '+name);
  for(const [file,body]of Object.entries(data))assert.equal(readFileSync(join(root,file),'utf8'),body,'read-only '+name);
  passed++;
 }
 const dirs=temp('meta-live-directories-');mkdirSync(join(dirs,'Assets/NoMeta'),{recursive:true});
 assert.deepEqual(await auditUnityMeta(dirs),[]);passed++;
 const linked=temp('meta-live-link-'),outsideRoot=temp('meta-live-outside-');
 put(outsideRoot,'SHOULD_NOT_SCAN.asset','x');mkdirSync(join(linked,'Assets'));
 symlinkSync(outsideRoot,join(linked,'Assets/External'),process.platform==='win32'?'junction':'dir');
 assert.deepEqual(await auditUnityMeta(linked),[]);passed++;
 for(const [name,hash]of Object.entries(baseline))assert.equal(digest(readFileSync(join(project,name))),hash,'baseline changed: '+name);
 const additions=files(project).filter(n=>!(n in baseline));
 const cliOwned=n=>n.startsWith('.codely-cli/auto-saves/')||n.startsWith('.codely-cli/UnityInsight/');
 assert.deepEqual(additions.filter(n=>!cliOwned(n)),['audit-meta.mjs']);
 summary.behavioral_cases_passed=passed;summary.baseline_unchanged=true;
 summary.cli_side_effects=additions.filter(n=>n.startsWith('.codely-cli/'));
 summary.core_hashes=Object.fromEntries(['server.ts','jobs.ts','runners/codely.ts','exec.ts','limits.ts','atomic-file.ts'].map(n=>[n,digest(readFileSync(join('src',n)))]));
 transition('completed','Host independently accepted bounded technical result','Actual user prompt contains full policy and exact task; nonce receipt verified; 14 cases passed; five baseline files unchanged; no observed outside-project reads');
 summary.status='passed';summary.verification_mode=existing?'existing completed CLI session; no additional model call':'fresh CLI dispatch';summary.finished_at=new Date().toISOString();delete summary.error;save();
 console.log(JSON.stringify({status:'passed',cases:passed,session_id:result.structuredContent.session_id,evidence},null,2));
} catch(error) {
 if(!['completed','failed'].includes(phase)){try{transition('failed','Real E2E failed: '+String(error));}catch{}}
 summary.status='failed';summary.error=String(error);summary.finished_at=new Date().toISOString();save();
 console.error('FAILED:',String(error),'Evidence:',evidence);process.exitCode=1;
} finally {
 if(jobId){
  try{
   const r=await call('check_job',{job_id:jobId});
   if(['running','cancelling'].includes(r.structuredContent?.status)){
    await call('cancel_job',{job_id:jobId});await call('wait_job',{job_id:jobId});
   }
  }catch{}
 }
 if(!existing)await client.close();
}
