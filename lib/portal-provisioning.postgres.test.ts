import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createDatabase,type Database} from './database';
import {portalProvision} from './portal-provisioning';
const url=process.env.HS_TEST_POSTGRES_URL;
describe.skipIf(!url)('Portal creation on real PostgreSQL',()=>{
 let db:Database;
 const actor='provision-reviewer-'+crypto.randomUUID(),target='provision-target-'+crypto.randomUUID(),workspace='provision-workspace-'+crypto.randomUUID();
 const scope={enabled:true,issuer:'https://accounts.synthetic.invalid',workspace};
 const data={actor_subject:actor,target_subject:target,name:'Synthetic exact new subject'};
 beforeAll(async()=>{
  const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/holy_sheet_acceptance')throw Error('Dedicated loopback acceptance database required');
  vi.stubEnv('DATABASE_URL',url!);db=await createDatabase();
  await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[actor]);
  await db.query('INSERT INTO hs_workspaces(id,name) VALUES($1,$1)',[workspace]);
  await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner')",[workspace,actor]);
  await db.query("INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,'synthetic')",[workspace,scope.issuer,actor]);
 });
 afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
 it('serializes simultaneous new-account creation and leaves one receipt/membership',async()=>{
  const expected=await portalProvision(db,scope,{...data,operation:'provision_preview'});
  const results=await Promise.allSettled([1,2].map(()=>portalProvision(db,scope,{...data,operation:'provision_apply',expected,request_id:crypto.randomUUID()})));
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
  expect((await db.query('SELECT role,active FROM hs_members WHERE user_id=$1',[target])).rows).toEqual([{role:'observer',active:true}]);
  expect((await db.query('SELECT request_id FROM hs_portal_provision_receipts WHERE target_id=$1',[target])).rows).toHaveLength(1);
 });
 it('cannot enroll an existing subject into another workspace through Create',async()=>{
  const other=workspace+'-other';await db.query('INSERT INTO hs_workspaces(id,name) VALUES($1,$1)',[other]);
  await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner')",[other,actor]);
  await db.query("INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,'synthetic')",[other,scope.issuer,actor]);
  await expect(portalProvision(db,{...scope,workspace:other},{...data,operation:'provision_preview'})).rejects.toMatchObject({code:'provision_authority_denied'});
  expect((await db.query('SELECT workspace_id FROM hs_members WHERE user_id=$1',[target])).rows).toEqual([{workspace_id:workspace}]);
 });
});
