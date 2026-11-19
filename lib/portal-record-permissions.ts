/** Local connector for the existing record permission contract; no role inference. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,Sql} from './database';
import {Repository} from './repository';
import {DocumentError,stableStringify} from './document';
import {portalScope,type PortalScope} from './portal-workspace-permissions';
import {SharedRecordPermissionRepository,recordPermissionCommand} from './shared-record-permissions';
import type {CurrentSuiteTenantAuthority,RecordContext} from './shared-records';
import {recordCapabilities,recordGrantCapabilities} from './shared-record-types';
const id=z.string().min(1).max(200),uuid=z.string().uuid();
const configuration=portalScope.extend({tenant:uuid});
const common={actor_subject:id,target_subject:id,actor_uid:id};
const selection={collection:z.string().min(1).max(100),record_id:uuid.nullable()};
const schema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('record_inventory'),...common}).strict(),
 z.object({operation:z.literal('record_preview'),...common,...selection}).strict(),
 z.object({operation:z.literal('record_apply'),...common,...selection,request_id:uuid,
  change:recordPermissionCommand.omit({operationId:true,collection:true,subjectId:true}),expected:z.record(z.string(),z.unknown())}).strict(),
]);
const hash=(x:unknown)=>createHash('sha256').update(stableStringify(x)).digest('hex');
const denied=()=>new DocumentError('Current native record authority required','record_authority_denied',403);
const bound=(tx:Sql):Database=>({query:tx.query.bind(tx),transaction:fn=>fn(tx),close:async()=>{}});
export function accountsRecordAuthority(issuer:string,secret:string,actor:string,uid:string):CurrentSuiteTenantAuthority{
 const url=new URL(issuer);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||secret.length<32)throw denied();
 return {verify:async(ctx:RecordContext)=>{
  if(ctx.actor.id!==actor)throw denied();
  const response=await fetch(new URL('/internal/tenant/status',issuer),{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(3000),
   headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:'holy-sheet',client_secret:secret,sub:actor,uid,tenant_id:ctx.tenantId,workspace_id:ctx.workspaceId})});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw denied();
  const reader=response.body?.getReader();if(!reader)throw denied();const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)throw denied();parts.push(value);}}finally{await reader.cancel();}
  const bytes=Buffer.concat(parts);
  const result=z.object({active:z.literal(true),subject:id,tenantId:uuid,workspaceId:id,tenantAdministrator:z.boolean(),revision:z.string().regex(/^[0-9a-f]{64}$/)}).strict().parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  if(result.subject!==actor||result.tenantId!==ctx.tenantId||result.workspaceId!==ctx.workspaceId)throw denied();return result;
 }};
}
async function nativeAuthority(tx:Sql,s:PortalScope,actor:string,target:string){
 if(actor===target)throw denied();
 const w=(await tx.query<{version:number;revision:string}>('SELECT access_version AS version,portal_access_revision::text AS revision FROM hs_workspaces WHERE id=$1 FOR UPDATE',[s.workspace])).rows[0];
 const reviewer=(await tx.query<{review_reference:string}>('SELECT review_reference FROM hs_portal_reviewers WHERE workspace_id=$1 AND issuer=$2 AND subject=$3 AND enabled=true FOR UPDATE',[s.workspace,s.issuer,actor])).rows[0];
 const members=(await tx.query<{user_id:string;role:string;active:boolean}>('SELECT user_id,role,active FROM hs_members WHERE workspace_id=$1 AND user_id IN ($2,$3) ORDER BY user_id FOR UPDATE',[s.workspace,actor,target])).rows;
 const a=members.find(m=>m.user_id===actor),t=members.find(m=>m.user_id===target);
 if(!w||!reviewer?.review_reference.trim()||!a?.active||!['owner','admin'].includes(a.role)||!t?.active||t.role==='owner')throw denied();
 return {...w,review_reference:reviewer.review_reference,actor_role:a.role,target_workspace_role:t.role};
}
export async function portalRecordPermission(db:Database,config:unknown,input:unknown,authority:CurrentSuiteTenantAuthority){
 const s=configuration.parse(config),q=schema.parse(input),url=new URL(s.issuer);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw denied();
 const ctx={actor:{id:q.actor_subject},tenantId:s.tenant,workspaceId:s.workspace};
 const initial=await authority.verify(ctx);if(!initial.active||!initial.tenantAdministrator||initial.subject!==ctx.actor.id||initial.tenantId!==ctx.tenantId||initial.workspaceId!==ctx.workspaceId||!/^[a-f0-9]{64}$/.test(initial.revision))throw denied();
 return db.transaction(async tx=>{
  const auth=await nativeAuthority(tx,s,q.actor_subject,q.target_subject);
  const r=new SharedRecordPermissionRepository(new Repository(bound(tx)),authority);
  const verify=async()=>{const p=await authority.verify(ctx);if(!p.active||!p.tenantAdministrator||hash(p)!==hash(initial))throw denied();return p;};
  if(q.operation==='record_inventory'){
   // Do not reveal a collection or record unless the native manager contract allows it.
   const collections=(await tx.query<{id:string;name:string}>(`SELECT c.id,c.name FROM hs_data_collections c JOIN hs_data_collection_grants g ON g.tenant_id=c.tenant_id AND g.collection=c.id AND g.user_id=$2 WHERE c.tenant_id=$1 AND 'manage-permissions'=ANY(g.capabilities) AND NOT EXISTS(SELECT 1 FROM hs_data_collection_settings x WHERE x.tenant_id=c.tenant_id AND x.collection=c.id AND x.removed_at IS NOT NULL) ORDER BY c.name,c.id LIMIT 101`,[s.tenant,q.actor_subject])).rows;
   if(collections.length>100)throw denied();
   for(const c of collections)await r.readMatrix(ctx,c.id);
   await verify();return {collections,collection_capabilities:recordCapabilities,record_capabilities:recordGrantCapabilities};
  }
  const read=async()=>{
   const matrix=await r.readMatrix(ctx,q.collection,q.record_id??undefined);
   const target=matrix.members.find(m=>m.id===q.target_subject);if(!target)throw denied();
   const versions=(await tx.query('SELECT schema_version,policy_version,data_revision::text FROM hs_data_tenants WHERE id=$1 FOR UPDATE',[s.tenant])).rows;
   const manager=(await tx.query('SELECT capabilities,version FROM hs_data_collection_grants WHERE tenant_id=$1 AND collection=$2 AND user_id=$3',[s.tenant,q.collection,q.actor_subject])).rows;
   const records=(await tx.query<{id:string;name:string}>("SELECT id,name FROM hs_data_records WHERE tenant_id=$1 AND collection=$2 AND state<>'trashed' ORDER BY name,id LIMIT 101",[s.tenant,q.collection])).rows;
   if(records.length>100)throw new DocumentError('Record scope requires pagination','scope_limit',409);
   return {issuer:s.issuer,workspace:s.workspace,tenant:s.tenant,actor_subject:q.actor_subject,target_subject:q.target_subject,
    ...auth,collection:q.collection,record:matrix.record,records,sensitive_fields:matrix.sensitiveFields,target,
    authority_revision:initial.revision,native_digest:hash({matrix,versions,manager,initial,records})};
  };
  const before=await read();await verify();
  if(q.operation==='record_preview')return before;
  if(hash(before)!==hash(q.expected))throw new DocumentError('Record access changed; review again','access_conflict',409);
  if(q.change.recordGrant?.recordId!==undefined&&q.change.recordGrant.recordId!==q.record_id)throw denied();
  if((await tx.query('SELECT request_id FROM hs_portal_permission_receipts WHERE request_id=$1',[q.request_id])).rows.length)throw new DocumentError('Confirmation consumed','operation_mismatch',409);
  // Exact field/grant versions are part of both reviewed plan and native command.
  if(q.change.collectionGrant&&q.change.collectionGrant.expectedVersion!==before.target.collection.version)throw denied();
  if(q.change.recordGrant&&q.change.recordGrant.expectedVersion!==before.target.record?.version)throw denied();
  if(q.change.fields?.some(f=>f.expectedVersion!==before.target.fields.find(p=>p.key===f.key)?.version))throw denied();
  await r.apply(ctx,{...q.change,operationId:q.request_id,collection:q.collection,subjectId:q.target_subject});
  const after=await read();await verify();
  await tx.query('INSERT INTO hs_portal_permission_receipts(request_id,workspace_id,actor_id,target_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[q.request_id,s.workspace,q.actor_subject,q.target_subject,JSON.stringify(before),JSON.stringify(after)]);
  return {request_id:q.request_id,before,after};
 });
}
