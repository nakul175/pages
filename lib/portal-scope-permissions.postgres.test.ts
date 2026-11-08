import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createDatabase,type Database} from './database';
import {Repository} from './repository';
import {portalScopePermission} from './portal-scope-permissions';
const url=process.env.HS_TEST_POSTGRES_URL;
describe.skipIf(!url)('Portal scope changes on real PostgreSQL',()=>{
 let db:Database,page:string;
 const actor='scope-reviewer-'+crypto.randomUUID(),target='scope-target-'+crypto.randomUUID();
 const workspace='scope-workspace-'+crypto.randomUUID(),space='scope-space-'+crypto.randomUUID();
 const config={enabled:true,issuer:'https://accounts.synthetic.invalid',workspace};
 const fields={actor_subject:actor,target_subject:target,kind:'page'};
 beforeAll(async()=>{
  const u=new URL(url!);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/holy_sheet_acceptance')throw Error('Isolated acceptance database required');
  vi.stubEnv('DATABASE_URL',url!);db=await createDatabase();
  for(const id of [actor,target])await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[id]);
  await db.query('INSERT INTO hs_workspaces(id,name) VALUES($1,$1)',[workspace]);
  await db.query('INSERT INTO hs_spaces(id,name,workspace_id) VALUES($1,$1,$2)',[space,workspace]);
  await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",[workspace,actor,target]);
  await db.query("INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,'synthetic')",[workspace,config.issuer,actor]);
  page=(await new Repository(db).create({id:actor},'Synthetic scoped page',space)).id;
 });
 afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
 it('serializes competing grant and downgrade; stale confirmation cannot commit',async()=>{
  const expected=await portalScopePermission(db,config,{...fields,operation:'scope_preview',resource_id:page});
  const results=await Promise.allSettled(['editor','viewer'].map(role=>portalScopePermission(db,config,{...fields,operation:'scope_apply',resource_id:page,role,expected,request_id:crypto.randomUUID()})));
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
  expect((await db.query('SELECT request_id FROM hs_portal_permission_receipts WHERE target_id=$1',[target])).rows).toHaveLength(1);
 });
});
