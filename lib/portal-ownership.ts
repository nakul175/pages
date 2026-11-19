/** Local connector: request the native recipient-accepted handover; never force acceptance. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,Sql} from './database';
import {DocumentError,stableStringify} from './document';
import {Repository} from './repository';
import {portalScope,type PortalScope} from './portal-workspace-permissions';
import {previewOwnershipTransfer,requestOwnershipTransfer} from './ownership-transfer';
const id=z.string().min(1).max(200),fields={actor_subject:id,target_subject:id};
const requestSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('ownership_preview'),...fields}).strict(),
 z.object({operation:z.literal('ownership_request'),...fields,request_id:z.string().uuid(),expected:z.record(z.string(),z.unknown())}).strict(),
 z.object({operation:z.literal('ownership_status'),...fields,request_id:z.string().uuid()}).strict(),
]);
const hash=(v:unknown)=>createHash('sha256').update(stableStringify(v)).digest('hex');
const denied=()=>new DocumentError('Reviewed native ownership authority required','portal_authority_denied',403);
const bound=(tx:Sql):Database=>({query:tx.query.bind(tx),transaction:fn=>fn(tx),close:async()=>{}});
async function authority(tx:Sql,s:PortalScope,actor:string,target:string){
 if(actor===target)throw denied();
 const w=(await tx.query<{version:number;revision:string}>('SELECT access_version AS version,portal_access_revision::text AS revision FROM hs_workspaces WHERE id=$1 FOR UPDATE',[s.workspace])).rows[0];
 const reviewer=(await tx.query<{review_reference:string}>('SELECT review_reference FROM hs_portal_reviewers WHERE workspace_id=$1 AND issuer=$2 AND subject=$3 AND enabled=true FOR UPDATE',[s.workspace,s.issuer,actor])).rows[0];
 const members=(await tx.query<{user_id:string;role:string;active:boolean}>('SELECT user_id,role,active FROM hs_members WHERE workspace_id=$1 AND user_id IN ($2,$3) ORDER BY user_id FOR UPDATE',[s.workspace,actor,target])).rows;
 const a=members.find(m=>m.user_id===actor),t=members.find(m=>m.user_id===target);
 if(!w||!reviewer?.review_reference.trim()||!a?.active||!['owner','admin'].includes(a.role)||!t?.active)throw denied();
 return {issuer:s.issuer,workspace:s.workspace,actor_subject:actor,target_subject:target,actor_role:a.role,target_role:t.role,version:w.version,revision:w.revision,review_reference:reviewer.review_reference};
}
async function preview(tx:Sql,s:PortalScope,actor:string,target:string){
 const a=await authority(tx,s,actor,target);
 if(a.actor_role!=='owner')throw denied();
 const pending=await tx.query("SELECT id FROM hs_ownership_transfers WHERE workspace_id=$1 AND from_user_id=$2 AND state='pending'",[s.workspace,actor]);
 if(pending.rows.length)throw new DocumentError('Reconcile existing native ownership request','pending_transfer',409);
 const p=await previewOwnershipTransfer(new Repository(bound(tx)),{id:actor},s.workspace,target);
 return {...a,from:p.from,to:p.to,page_count:p.pageCount,native_digest:p.digest,acceptance_required:true,expires_in_days:7};
}
export async function portalOwnership(db:Database,configuration:unknown,input:unknown){
 const s=portalScope.parse(configuration),r=requestSchema.parse(input),url=new URL(s.issuer);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw denied();
 return db.transaction(async tx=>{
  if(r.operation==='ownership_status'){
   const current=await authority(tx,s,r.actor_subject,r.target_subject);
   const receipt=(await tx.query<{after_value:{transfer_id:string;state:string}}>('SELECT after_value FROM hs_portal_permission_receipts WHERE request_id=$1 AND workspace_id=$2 AND actor_id=$3 AND target_id=$4',[r.request_id,s.workspace,r.actor_subject,r.target_subject])).rows[0];
   if(!receipt?.after_value?.transfer_id)throw denied();
   const t=(await tx.query<{id:string;state:string;expires_at:string;from_user_id:string;to_user_id:string}>("SELECT id,CASE WHEN state='pending' AND expires_at<=clock_timestamp() THEN 'expired' ELSE state END AS state,expires_at,from_user_id,to_user_id FROM hs_ownership_transfers WHERE id=$1 AND workspace_id=$2 FOR UPDATE",[receipt.after_value.transfer_id,s.workspace])).rows[0];
   if(!t||t.from_user_id!==r.actor_subject||t.to_user_id!==r.target_subject)throw denied();
   return {request_id:r.request_id,transfer_id:t.id,state:t.state,expires_at:new Date(t.expires_at).toISOString(),current};
  }
  const before=await preview(tx,s,r.actor_subject,r.target_subject);
  if(r.operation==='ownership_preview')return before;
  if(hash(before)!==hash(r.expected))throw new DocumentError('Ownership review changed','access_conflict',409);
  if((await tx.query('SELECT request_id FROM hs_portal_permission_receipts WHERE request_id=$1',[r.request_id])).rows.length)throw new DocumentError('Consumed review','operation_mismatch',409);
  const result=await requestOwnershipTransfer(new Repository(bound(tx)),{id:r.actor_subject},s.workspace,{targetId:r.target_subject,operationId:r.request_id,expectedVersion:before.version,previewDigest:before.native_digest});
  const current=await authority(tx,s,r.actor_subject,r.target_subject);
  if(!result.id||result.replayed||current.actor_role!=='owner'||current.target_role!==before.target_role||current.version!==before.version+1||current.revision!==before.revision)throw new DocumentError('Native readback mismatch','readback_failed',409);
  const after={transfer_id:result.id,state:'pending',expires_at:result.expiresAt,current};
  await tx.query('INSERT INTO hs_portal_permission_receipts(request_id,workspace_id,actor_id,target_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[r.request_id,s.workspace,r.actor_subject,r.target_subject,JSON.stringify(before),JSON.stringify(after)]);
  return {request_id:r.request_id,before,after};
 });
}
