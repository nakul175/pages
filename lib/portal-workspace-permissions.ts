/** Privileged local connector only. Never expose this function as an HTTP route.
 * Reuses native administration inside the same authority/receipt transaction.
 * Issuer/workspace are operator-pinned, never selected by browser input.
 */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,Sql} from './database';
import {DocumentError,stableStringify} from './document';
import {Repository} from './repository';
import {previewMemberChange,changeWorkspaceMember} from './workspace-administration';

const id=z.string().min(1).max(200);
const roles=z.enum(['admin','member','observer']);
export const portalScope=z.object({enabled:z.literal(true),issuer:z.string().url(),workspace:id}).strict();
export type PortalScope=z.infer<typeof portalScope>;
const planSchema=z.object({issuer:id,workspace:id,actor_subject:id,target_subject:id,
 actor_role:z.enum(['owner','admin']),role:roles,active:z.boolean(),
 version:z.number().int().nonnegative().safe(),revision:z.string().regex(/^\d+$/),
 review_reference:id}).strict();
export type PortalPlan=z.infer<typeof planSchema>;
export const portalRequest=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('preview'),actor_subject:id,target_subject:id}).strict(),
 z.object({operation:z.literal('apply'),actor_subject:id,target_subject:id,request_id:z.string().uuid(),
  choice:z.enum(['admin','member','observer','revoke']),expected:planSchema}).strict(),
]);
const denied=()=>new DocumentError('Reviewed native workspace authority is required','portal_authority_denied',403);
const hash=(value:unknown)=>createHash('sha256').update(stableStringify(value)).digest('hex');

async function plan(tx:Sql,scope:PortalScope,actor:string,target:string):Promise<PortalPlan>{
 if(actor===target)throw denied();
 // Native writer order is workspace, then membership. A competing role change
 // cannot commit between this check and the reused native mutation.
 const w=(await tx.query<{version:number;revision:string}>(
  'SELECT access_version AS version,portal_access_revision::text AS revision FROM hs_workspaces WHERE id=$1 FOR UPDATE',[scope.workspace])).rows[0];
 if(!w)throw denied();
 const reviewer=(await tx.query<{review_reference:string}>(
  'SELECT review_reference FROM hs_portal_reviewers WHERE workspace_id=$1 AND issuer=$2 AND subject=$3 AND enabled=true FOR UPDATE',
  [scope.workspace,scope.issuer,actor])).rows[0];
 const members=(await tx.query<{user_id:string;role:string;active:boolean}>(
  'SELECT user_id,role,active FROM hs_members WHERE workspace_id=$1 AND user_id IN ($2,$3) ORDER BY user_id FOR UPDATE',
  [scope.workspace,actor,target])).rows;
 const a=members.find(m=>m.user_id===actor),t=members.find(m=>m.user_id===target);
 if(!reviewer||!reviewer.review_reference.trim()||!a?.active||!['owner','admin'].includes(a.role)||!t||t.role==='owner')throw denied();
 return planSchema.parse({issuer:scope.issuer,workspace:scope.workspace,actor_subject:actor,target_subject:target,
  actor_role:a.role,role:t.role,active:t.active,version:w.version,revision:w.revision,review_reference:reviewer.review_reference});
}

export async function portalWorkspacePermission(db:Database,configuration:unknown,input:unknown){
 const scope=portalScope.parse(configuration),request=portalRequest.parse(input),url=new URL(scope.issuer);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw denied();
 return db.transaction(async tx=>{
  const before=await plan(tx,scope,request.actor_subject,request.target_subject);
  if(request.operation==='preview')return before;
  if(hash(before)!==hash(request.expected))throw new DocumentError('Native authority changed; review again','access_conflict',409);
  const used=await tx.query('SELECT request_id FROM hs_portal_permission_receipts WHERE request_id=$1',[request.request_id]);
  if(used.rows.length)throw new DocumentError('Confirmation is already consumed','operation_mismatch',409);
  const role=request.choice==='revoke'?before.role:request.choice,active=request.choice!=='revoke';
  // These methods expect a Database, but all their queries/transactions remain
  // on this already locked transaction. No nested connection or early commit.
  const bound:Database={query:tx.query.bind(tx),transaction:fn=>fn(tx),close:async()=>{}};
  const repository=new Repository(bound),actor={id:request.actor_subject},change={subjectId:request.target_subject,role,active};
  const preview=await previewMemberChange(repository,actor,scope.workspace,change);
  await changeWorkspaceMember(repository,actor,scope.workspace,{...change,operationId:request.request_id,
   expectedVersion:preview.version,previewDigest:preview.digest});
  const after=await plan(tx,scope,request.actor_subject,request.target_subject);
  if(after.role!==role||after.active!==active)throw new DocumentError('Native readback mismatch','readback_failed',409);
  await tx.query('INSERT INTO hs_portal_permission_receipts(request_id,workspace_id,actor_id,target_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',
   [request.request_id,scope.workspace,request.actor_subject,request.target_subject,JSON.stringify(before),JSON.stringify(after)]);
  return {request_id:request.request_id,changed:before.role!==after.role||before.active!==after.active,before,after};
 });
}
