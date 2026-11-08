/** Private connector primitive. The Portal separately verifies the central person,
 * current session, exact subject and application assignment. No email matching.
 */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,Sql} from './database';
import {DocumentError,stableStringify} from './document';
import {portalScope} from './portal-workspace-permissions';

const subject=z.string().min(1).max(200).refine(s=>s===s.trim()&&!/[\x00-\x1f\x7f]/.test(s));
const identity=z.object({actor_subject:subject,target_subject:subject,name:z.string().trim().min(1).max(200)});
const planSchema=identity.extend({issuer:z.string(),workspace:subject,actor_role:z.enum(['owner','admin']),
 version:z.number().int().nonnegative().safe(),revision:z.string().regex(/^\d+$/),review_reference:subject,
 role:z.literal('observer'),active:z.literal(true),absent:z.literal(true)}).strict();
const requestSchema=z.discriminatedUnion('operation',[
 identity.extend({operation:z.literal('provision_preview')}).strict(),
 identity.extend({operation:z.literal('provision_apply'),request_id:z.string().uuid(),expected:planSchema}).strict(),
]);
type Plan=z.infer<typeof planSchema>;
const hash=(v:unknown)=>createHash('sha256').update(stableStringify(v)).digest('hex');
const deny=()=>new DocumentError('Exact new subject and reviewed workspace authority required','provision_authority_denied',403);

async function plan(tx:Sql,scope:z.infer<typeof portalScope>,input:z.infer<typeof identity>):Promise<Plan>{
 if(input.actor_subject===input.target_subject||input.target_subject==='space')throw deny();
 const w=(await tx.query<{version:number;revision:string}>('SELECT access_version AS version,portal_access_revision::text AS revision FROM hs_workspaces WHERE id=$1 FOR UPDATE',[scope.workspace])).rows[0];
 if(!w)throw deny();
 // Serializes creation of this exact subject even across different workspaces.
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,730217440))',[input.target_subject]);
 const a=(await tx.query<{role:string}>('SELECT role FROM hs_members WHERE workspace_id=$1 AND user_id=$2 AND active=true FOR UPDATE',[scope.workspace,input.actor_subject])).rows[0];
 const reviewer=(await tx.query<{review_reference:string}>('SELECT review_reference FROM hs_portal_reviewers WHERE workspace_id=$1 AND issuer=$2 AND subject=$3 AND enabled=true FOR UPDATE',[scope.workspace,scope.issuer,input.actor_subject])).rows[0];
 if(!a||!['owner','admin'].includes(a.role)||!reviewer?.review_reference.trim())throw deny();
 if((await tx.query('SELECT id FROM hs_users WHERE id=$1',[input.target_subject])).rows.length)throw deny();
 // Direct grants and pending invitations can predate a native user. Never let
 // creating that user silently activate authority left behind under its subject.
 await tx.query('LOCK TABLE hs_grants,hs_access_invitations IN SHARE MODE');
 if((await tx.query('SELECT subject FROM hs_grants WHERE subject=$1 LIMIT 1',[input.target_subject])).rows.length||
    (await tx.query('SELECT invitee_subject FROM hs_access_invitations WHERE invitee_subject=$1 LIMIT 1',[input.target_subject])).rows.length)throw deny();
 return planSchema.parse({...identity.parse(input),issuer:scope.issuer,workspace:scope.workspace,actor_role:a.role,
  version:w.version,revision:w.revision,review_reference:reviewer.review_reference,role:'observer',active:true,absent:true});
}

export async function portalProvision(db:Database,configuration:unknown,input:unknown){
 const scope=portalScope.parse(configuration),request=requestSchema.parse(input),issuer=new URL(scope.issuer);
 if(issuer.protocol!=='https:'||issuer.origin!==scope.issuer||issuer.username||issuer.password)throw deny();
 return db.transaction(async tx=>{
  const before=await plan(tx,scope,request);
  if(request.operation==='provision_preview')return before;
  if(hash(before)!==hash(request.expected))throw new DocumentError('Creation review changed','access_conflict',409);
  if((await tx.query('SELECT request_id FROM hs_portal_provision_receipts WHERE request_id=$1',[request.request_id])).rows.length)throw deny();
  await tx.query('INSERT INTO hs_users(id,name) VALUES($1,$2)',[request.target_subject,request.name]);
  await tx.query("INSERT INTO hs_members(workspace_id,user_id,role,active) VALUES($1,$2,'observer',true)",[scope.workspace,request.target_subject]);
  await tx.query('UPDATE hs_workspaces SET access_version=access_version+1 WHERE id=$1',[scope.workspace]);
  const after={request_id:request.request_id,issuer:scope.issuer,workspace:scope.workspace,
   subject:request.target_subject,name:request.name,role:'observer',active:true};
  await tx.query('INSERT INTO hs_portal_provision_receipts(request_id,workspace_id,issuer,actor_id,target_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [request.request_id,scope.workspace,scope.issuer,request.actor_subject,request.target_subject,JSON.stringify(before),JSON.stringify(after)]);
  return after;
 });
}
