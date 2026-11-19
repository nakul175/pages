import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createDatabase,type Database} from './database';
import {portalWorkspacePermission} from './portal-workspace-permissions';
const url=process.env.HS_TEST_POSTGRES_URL;
describe.skipIf(!url)('Portal workspace real PostgreSQL serialization',()=>{
 let db:Database;
 const workspace='portal-pg-'+crypto.randomUUID(),actor='reviewer-'+crypto.randomUUID(),target='target-'+crypto.randomUUID();
 const scope={enabled:true,issuer:'https://accounts.synthetic.invalid',workspace},subjects={actor_subject:actor,target_subject:target};
 const preview=()=>portalWorkspacePermission(db,scope,{...subjects,operation:'preview'});
 beforeAll(async()=>{
  const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/holy_sheet_acceptance')throw Error('Dedicated loopback acceptance database required');
  vi.stubEnv('DATABASE_URL',url!);db=await createDatabase();
  for(const id of [actor,target])await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[id]);
  await db.query('INSERT INTO hs_workspaces(id,name) VALUES($1,$1)',[workspace]);
  await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",[workspace,actor,target]);
  await db.query("INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,'synthetic')",[workspace,scope.issuer,actor]);
 });
 afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
 it('commits exactly one of two simultaneous stale confirmations and preserves durable native receipt',async()=>{
  const expected=await preview();
  const changes=await Promise.allSettled(['admin','observer'].map(choice=>portalWorkspacePermission(db,scope,
   {...subjects,operation:'apply',choice,expected,request_id:crypto.randomUUID()})));
  expect(changes.filter(v=>v.status==='fulfilled')).toHaveLength(1);
  expect(changes.filter(v=>v.status==='rejected')).toHaveLength(1);
  const receipts=await db.query('SELECT before_value,after_value FROM hs_portal_permission_receipts WHERE workspace_id=$1',[workspace]);
  expect(receipts.rows).toHaveLength(1);
  expect(receipts.rows[0].before_value).toEqual(expected);
  expect(receipts.rows[0].after_value).toEqual(await preview());
 });
});
