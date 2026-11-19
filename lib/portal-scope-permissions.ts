/** Local, operator-pinned connector. All writes reuse native access operations. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,Sql} from './database';
import {DocumentError,stableStringify} from './document';
import {Repository} from './repository';
import {portalScope,type PortalScope} from './portal-workspace-permissions';
import {previewSpaceMemberChange,changeSpaceMember} from './space-administration';
import {sharingState,changeSharing} from './sharing';

const id=z.string().min(1).max(200);
const kind=z.enum(['page','space']);
const role=z.enum(['leader','editor','commenter','viewer']);
const actorFields={actor_subject:id,target_subject:id};
const schema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('scope_inventory'),...actorFields}).strict(),
 z.object({operation:z.literal('scope_preview'),...actorFields,kind,resource_id:id}).strict(),
 z.object({operation:z.literal('scope_apply'),...actorFields,kind,resource_id:id,role:role.nullable(),
   request_id:z.string().uuid(),expected:z.record(z.string(),z.unknown())}).strict(),
]);
const hash=(v:unknown)=>createHash('sha256').update(stableStringify(v)).digest('hex');
const deny=()=>new DocumentError('Reviewed native scope authority is required','portal_authority_denied',403);
const bound=(tx:Sql):Database=>({query:tx.query.bind(tx),transaction:fn=>fn(tx),close:async()=>{}});
async function authority(tx:Sql,s:PortalScope,actor:string,target:string){
 if(actor===target)throw deny();
 const w=(await tx.query<{version:number;revision:string}>(
  'SELECT access_version AS version,portal_access_revision::text AS revision FROM hs_workspaces WHERE id=$1 FOR UPDATE',[s.workspace])).rows[0];
 const reviewer=(await tx.query<{review_reference:string}>(
  'SELECT review_reference FROM hs_portal_reviewers WHERE workspace_id=$1 AND issuer=$2 AND subject=$3 AND enabled=true FOR UPDATE',[s.workspace,s.issuer,actor])).rows[0];
 const m=(await tx.query<{user_id:string;role:string;active:boolean}>(
  'SELECT user_id,role,active FROM hs_members WHERE workspace_id=$1 AND user_id IN ($2,$3) ORDER BY user_id FOR UPDATE',[s.workspace,actor,target])).rows;
 const a=m.find(x=>x.user_id===actor),t=m.find(x=>x.user_id===target);
 if(!w||!reviewer?.review_reference.trim()||!a?.active||!['owner','admin'].includes(a.role)||!t?.active||t.role==='owner')throw deny();
 return {issuer:s.issuer,workspace:s.workspace,actor_subject:actor,target_subject:target,
  actor_role:a.role,target_workspace_role:t.role,version:w.version,revision:w.revision,review_reference:reviewer.review_reference};
}
async function inspect(tx:Sql,s:PortalScope,actor:string,target:string,k:'page'|'space',resource:string){
 const auth=await authority(tx,s,actor,target),r=new Repository(bound(tx));
 if(k==='space'){
  const row=(await tx.query<{name:string;workspace_id:string}>('SELECT name,workspace_id FROM hs_spaces WHERE id=$1 FOR UPDATE',[resource])).rows[0];
  if(!row||row.workspace_id!==s.workspace)throw deny();
  const p=await previewSpaceMemberChange(r,{id:actor},resource,{subjectId:target,role:null});
  return {...auth,kind:k,resource_id:resource,name:row.name,resource_version:p.version,
   role:p.before.role,effective_role:p.before.workspaceRole==='observer'?'viewer':p.before.workspaceRole==='admin'?'editor':p.before.role,
   inherited_access:p.before.workspaceRole==='admin',native_digest:hash(p)};
 }
 const page=await r.access(tx,resource,{id:actor},false,true);
 if(page.workspace_id!==s.workspace||page.owner_id!==actor||page.owner_id===target)throw deny();
 const shared=await sharingState(r,{id:actor},resource,tx);
 let effective:string|null=null;
 try{effective=(await r.access(tx,resource,{id:target})).role;}catch(e){if(!(e instanceof DocumentError&&e.status===404))throw e;}
 const lineage=(await tx.query(`WITH RECURSIVE ancestors AS (
  SELECT id,parent_id,owner_id,visibility,acl_version,version,archived_at,deleted_at,ARRAY[id] AS path FROM hs_pages WHERE id=$1
  UNION ALL SELECT p.id,p.parent_id,p.owner_id,p.visibility,p.acl_version,p.version,p.archived_at,p.deleted_at,a.path||p.id
   FROM hs_pages p JOIN ancestors a ON p.id=a.parent_id WHERE p.workspace_id=$2 AND NOT p.id=ANY(a.path)
 ) SELECT id,parent_id,owner_id,visibility,acl_version,version,archived_at,deleted_at FROM ancestors ORDER BY id`,[resource,s.workspace])).rows;
 const direct=shared.direct.find(x=>x.id===target)?.role??null;
 // Include inherited grants and current effective result. A changed ancestor
 // invalidates the exact review; separate grants are never silently removed.
 return {...auth,kind:k,resource_id:resource,name:page.title,resource_version:shared.version,
  role:direct,effective_role:effective,inherited_access:shared.inherited.some(x=>x.recipientId===target||x.recipientId==='space')||auth.target_workspace_role==='admin',
  native_digest:hash({shared,effective,lineage})};
}
export async function portalScopePermission(db:Database,configuration:unknown,input:unknown){
 const s=portalScope.parse(configuration),q=schema.parse(input),url=new URL(s.issuer);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw deny();
 return db.transaction(async tx=>{
  if(q.operation==='scope_inventory'){
   await authority(tx,s,q.actor_subject,q.target_subject);
   // Names are only exposed for scopes this reviewer may actually manage.
   const spaces=(await tx.query<{id:string;name:string}>('SELECT id,name FROM hs_spaces WHERE workspace_id=$1 ORDER BY name,id LIMIT 201',[s.workspace])).rows;
   const pages=(await tx.query<{id:string;name:string}>('SELECT id,title AS name FROM hs_pages WHERE workspace_id=$1 AND owner_id=$2 AND deleted_at IS NULL ORDER BY title,id LIMIT 201',[s.workspace,q.actor_subject])).rows;
   if(spaces.length>200||pages.length>200)throw new DocumentError('Scope list requires pagination','scope_limit',409);
   return {spaces,pages};
  }
  const before=await inspect(tx,s,q.actor_subject,q.target_subject,q.kind,q.resource_id);
  if(q.operation==='scope_preview')return before;
  if((q.kind==='page'&&q.role==='leader')||(q.kind==='space'&&q.role==='commenter'))throw deny();
  if(hash(before)!==hash(q.expected))throw new DocumentError('Native authority changed; review again','access_conflict',409);
  if((await tx.query('SELECT request_id FROM hs_portal_permission_receipts WHERE request_id=$1',[q.request_id])).rows.length)
   throw new DocumentError('Confirmation already consumed','operation_mismatch',409);
  const r=new Repository(bound(tx));
  if(q.kind==='page'){
   await changeSharing(r,{id:q.actor_subject},q.resource_id,{operationId:q.request_id,
    expectedVersion:before.resource_version,recipientId:q.target_subject,role:q.role as 'editor'|'commenter'|'viewer'|null});
  }else{
   const p=await previewSpaceMemberChange(r,{id:q.actor_subject},q.resource_id,{subjectId:q.target_subject,role:q.role as 'leader'|'editor'|'viewer'|null});
   await changeSpaceMember(r,{id:q.actor_subject},q.resource_id,{operationId:q.request_id,expectedVersion:p.version,
    previewDigest:p.digest,subjectId:q.target_subject,role:q.role as 'leader'|'editor'|'viewer'|null});
  }
  const after=await inspect(tx,s,q.actor_subject,q.target_subject,q.kind,q.resource_id);
  if(after.role!==q.role)throw new DocumentError('Native readback mismatch','readback_failed',409);
  await tx.query('INSERT INTO hs_portal_permission_receipts(request_id,workspace_id,actor_id,target_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',
   [q.request_id,s.workspace,q.actor_subject,q.target_subject,JSON.stringify(before),JSON.stringify(after)]);
  return {request_id:q.request_id,before,after};
 });
}
