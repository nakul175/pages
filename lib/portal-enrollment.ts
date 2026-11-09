/** Add an existing exact native identity as Observer; never create a user or infer email. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,Sql} from './database';
import {DocumentError,stableStringify} from './document';
import {portalScope,type PortalScope} from './portal-workspace-permissions';
const id=z.string().min(1).max(200);
const fields={actor_subject:id,target_subject:id};
const request=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('enrollment_preview'),...fields}).strict(),
 z.object({operation:z.literal('enrollment_apply'),...fields,request_id:z.string().uuid(),expected:z.record(z.string(),z.unknown())}).strict(),
]);
const hash=(v:unknown)=>createHash('sha256').update(stableStringify(v)).digest('hex');
const deny=()=>new DocumentError('Reviewed existing identity and absent workspace membership required','enrollment_denied',403);
async function preview(tx:Sql,s:PortalScope,actor:string,target:string){
 if(actor===target)throw deny();
 const w=(await tx.query<{version:number;revision:string}>('SELECT access_version AS version,portal_access_revision::text AS revision FROM hs_workspaces WHERE id=$1 FOR UPDATE',[s.workspace])).rows[0];
 if(!w)throw deny();
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,730217440))',[target]);
 const reviewer=(await tx.query<{review_reference:string}>('SELECT review_reference FROM hs_portal_reviewers WHERE workspace_id=$1 AND issuer=$2 AND subject=$3 AND enabled=true FOR UPDATE',[s.workspace,s.issuer,actor])).rows[0];
 const a=(await tx.query<{role:string}>("SELECT role FROM hs_members WHERE workspace_id=$1 AND user_id=$2 AND active=true FOR UPDATE",[s.workspace,actor])).rows[0];
 const user=(await tx.query<{id:string;name:string}>('SELECT id,name FROM hs_users WHERE id=$1 FOR UPDATE',[target])).rows[0];
 const memberships=(await tx.query<{workspace_id:string;role:string;active:boolean}>('SELECT workspace_id,role,active FROM hs_members WHERE user_id=$1 ORDER BY workspace_id FOR UPDATE',[target])).rows;
 if(!reviewer?.review_reference.trim()||!a||!['owner','admin'].includes(a.role)||!user||!memberships.some(m=>m.active)||memberships.some(m=>m.workspace_id===s.workspace))throw deny();
 // Dormant grants must not silently activate when membership is added.
 await tx.query('LOCK TABLE hs_grants,hs_space_members,hs_access_invitations,hs_data_tenant_grants,hs_data_collection_grants,hs_data_record_grants,hs_data_field_permissions IN SHARE MODE');
 for(const table of ['hs_data_tenant_grants','hs_data_collection_grants','hs_data_record_grants','hs_data_field_permissions']){
  if((await tx.query(`SELECT g.user_id FROM ${table} g JOIN hs_data_workspaces w ON w.tenant_id=g.tenant_id WHERE w.workspace_id=$1 AND g.user_id=$2 LIMIT 1`,[s.workspace,target])).rows.length)throw deny();
 }
 if((await tx.query('SELECT id FROM hs_pages WHERE workspace_id=$1 AND owner_id=$2 LIMIT 1',[s.workspace,target])).rows.length)throw deny();
 if((await tx.query('SELECT g.subject FROM hs_grants g JOIN hs_pages p ON p.id=g.page_id JOIN hs_spaces s ON s.id=p.space_id WHERE s.workspace_id=$1 AND g.subject=$2 LIMIT 1',[s.workspace,target])).rows.length||
    (await tx.query('SELECT m.user_id FROM hs_space_members m JOIN hs_spaces s ON s.id=m.space_id WHERE s.workspace_id=$1 AND m.user_id=$2 LIMIT 1',[s.workspace,target])).rows.length||
    (await tx.query('SELECT id FROM hs_access_invitations WHERE workspace_id=$1 AND invitee_subject=$2 LIMIT 1',[s.workspace,target])).rows.length)throw deny();
 const origins=(await tx.query<{request_id:string;issuer:string;workspace_id:string}>('SELECT request_id,issuer,workspace_id FROM hs_portal_provision_receipts WHERE target_id=$1 ORDER BY request_id',[target])).rows;
 if(origins.length>1||origins.some(o=>o.issuer!==s.issuer))throw deny();
 return {issuer:s.issuer,workspace:s.workspace,actor_subject:actor,target_subject:target,actor_role:a.role,version:w.version,revision:w.revision,review_reference:reviewer.review_reference,name:user.name,existing_memberships:memberships,origin:origins[0]??null,role:'observer',active:true,absent:true};
}
export async function portalEnrollment(db:Database,configuration:unknown,input:unknown){
 const s=portalScope.parse(configuration),r=request.parse(input),u=new URL(s.issuer);
 if(u.protocol!=='https:'||u.origin!==s.issuer||u.username||u.password)throw deny();
 return db.transaction(async tx=>{
  const before=await preview(tx,s,r.actor_subject,r.target_subject);
  if(r.operation==='enrollment_preview')return before;
  if(hash(before)!==hash(r.expected))throw new DocumentError('Enrollment review changed','access_conflict',409);
  if((await tx.query('SELECT request_id FROM hs_portal_permission_receipts WHERE request_id=$1',[r.request_id])).rows.length)throw deny();
  await tx.query("INSERT INTO hs_members(workspace_id,user_id,role,active) VALUES($1,$2,'observer',true)",[s.workspace,r.target_subject]);
  await tx.query('UPDATE hs_workspaces SET access_version=access_version+1 WHERE id=$1',[s.workspace]);
  const after={request_id:r.request_id,issuer:s.issuer,workspace:s.workspace,subject:r.target_subject,role:'observer',active:true};
  await tx.query('INSERT INTO hs_portal_permission_receipts(request_id,workspace_id,actor_id,target_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[r.request_id,s.workspace,r.actor_subject,r.target_subject,JSON.stringify(before),JSON.stringify(after)]);
  return {before,after};
 });
}
