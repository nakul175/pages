import {z} from 'zod';
import {api,localPreview,readJson} from '../../../../../../lib/auth';
import {repository} from '../../../../../../lib/repository';
import {DocumentError} from '../../../../../../lib/document';

type Context={params:Promise<{id:string}>};
const body=z.object({pageId:z.string().min(1).max(200),action:z.enum(['preview','archive','restore'])}).strict();
const unavailable=()=>new DocumentError('Page is restricted or unavailable','not_found',404);
export async function GET(request:Request,context:Context){return api(request,async actor=>{
 const workspaceId=(await context.params).id,r=await repository(localPreview(request));
 const result=await r.db.query<{id:string;title:string;space_name:string}>(`SELECT p.id,p.title,s.name AS space_name FROM hs_pages p JOIN hs_spaces s ON s.id=p.space_id JOIN hs_members m ON m.workspace_id=p.workspace_id AND m.user_id=$2 AND m.active=true LEFT JOIN hs_pages parent ON parent.id=p.parent_id WHERE p.workspace_id=$1 AND p.archived_at IS NOT NULL AND p.deleted_at IS NULL AND (parent.id IS NULL OR parent.archived_at IS NULL) AND (m.role IN ('owner','admin') OR p.owner_id=$2) ORDER BY p.archived_at DESC LIMIT 200`,[workspaceId,actor.id]);
 return {pages:result.rows};
 });}
export async function POST(request:Request,context:Context){return api(request,async actor=>{
 const workspaceId=(await context.params).id,parsed=body.safeParse(await readJson(request,8192));
 if(!parsed.success)throw new DocumentError('Invalid archive request','invalid_archive',422);
 const {pageId,action}=parsed.data,r=await repository(localPreview(request));
 return r.db.transaction(async tx=>{
  await tx.query('SELECT id FROM hs_workspaces WHERE id=$1 FOR UPDATE',[workspaceId]);
  const row=await tx.query<{id:string;owner_id:string;role:string;archived_at:string|null;home_page_id:string|null}>(`SELECT p.id,p.owner_id,m.role,p.archived_at,s.home_page_id FROM hs_pages p JOIN hs_members m ON m.workspace_id=p.workspace_id AND m.user_id=$3 AND m.active=true JOIN hs_spaces s ON s.id=p.space_id WHERE p.id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NULL FOR UPDATE OF p`,[pageId,workspaceId,actor.id]);
  const page=row.rows[0];if(!page||page.role!=='owner'&&page.role!=='admin'&&page.owner_id!==actor.id)throw unavailable();
  if(page.home_page_id===pageId)throw new DocumentError('Choose another space home before archiving this page.','space_home',422);
  const descendants=await tx.query<{id:string;owner_id:string}>(`WITH RECURSIVE branch AS (SELECT id,owner_id FROM hs_pages WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT p.id,p.owner_id FROM hs_pages p JOIN branch b ON p.parent_id=b.id WHERE p.workspace_id=$2 AND p.deleted_at IS NULL) SELECT id,owner_id FROM branch`,[pageId,workspaceId]);
  if(page.role!=='owner'&&page.role!=='admin'&&descendants.rows.some(item=>item.owner_id!==actor.id))throw unavailable();
  if(action==='archive'){
   const homes=await tx.query<{id:string}>(`SELECT id FROM hs_spaces WHERE home_page_id=ANY($1::text[]) LIMIT 1`,[descendants.rows.map(item=>item.id)]);
   if(homes.rows.length)throw new DocumentError('Choose another space home before archiving these pages.','space_home',422);
  }
  if(action==='preview')return {pageId,count:descendants.rows.length,archived:!!page.archived_at};
  const changed=await tx.query<{id:string}>(action==='archive'
   ?`UPDATE hs_pages SET archived_at=now() WHERE id=ANY($1::text[]) AND archived_at IS NULL RETURNING id`
   :`UPDATE hs_pages SET archived_at=NULL WHERE id=ANY($1::text[]) AND archived_at=$2 RETURNING id`,action==='archive'?[descendants.rows.map(item=>item.id)]:[descendants.rows.map(item=>item.id),page.archived_at]);
  await tx.query('UPDATE hs_workspaces SET tree_version=tree_version+1 WHERE id=$1',[workspaceId]);
  await tx.query(`INSERT INTO hs_audit(id,actor_id,action,page_id,correlation_id,before_value,after_value) VALUES(gen_random_uuid(),$1,$2,$3,gen_random_uuid(),$4::jsonb,$5::jsonb)`,[actor.id,`page.${action}`,pageId,JSON.stringify({archived:!!page.archived_at}),JSON.stringify({archived:action==='archive',count:changed.rows.length})]);
  return {pageId,count:changed.rows.length,archived:action==='archive'};
 });
 },true);}
