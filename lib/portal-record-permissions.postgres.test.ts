import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {createDatabase,type Database} from './database';
import {portalRecordPermission} from './portal-record-permissions';
import type {CurrentSuiteTenantAuthority} from './shared-records';
const url=process.env.HS_TEST_POSTGRES_URL;
describe.skipIf(!url)('Record confirmation on isolated real PostgreSQL',()=>{
 let db:Database;
 const actor='record-reviewer-'+crypto.randomUUID(),target='record-target-'+crypto.randomUUID(),workspace='record-ws-'+crypto.randomUUID(),tenant=crypto.randomUUID();
 const config={enabled:true,issuer:'https://accounts.synthetic.invalid',workspace,tenant};
 const request={actor_subject:actor,target_subject:target,actor_uid:'synthetic',collection:'contacts',record_id:null};
 const authority:CurrentSuiteTenantAuthority={verify:async c=>({active:true,tenantAdministrator:true,subject:c.actor.id,workspaceId:c.workspaceId,tenantId:c.tenantId,revision:'a'.repeat(64)})};
 beforeAll(async()=>{
  const u=new URL(url!);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/holy_sheet_acceptance')throw Error('Isolated acceptance database required');
  vi.stubEnv('DATABASE_URL',url!);db=await createDatabase();
  for(const id of [actor,target])await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[id]);
  await db.query('INSERT INTO hs_workspaces(id,name) VALUES($1,$1)',[workspace]);
  await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",[workspace,actor,target]);
  await db.query("INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,'synthetic')",[workspace,config.issuer,actor]);
  await db.query("INSERT INTO hs_data_tenants(id,name) VALUES($1,'Synthetic')",[tenant]);
  await db.query("INSERT INTO hs_data_workspaces(workspace_id,tenant_id,review_reference) VALUES($1,$2,'synthetic')",[workspace,tenant]);
  await db.query("INSERT INTO hs_data_collections(tenant_id,id,name,core) VALUES($1,'contacts','Contacts',true)",[tenant]);
  await db.query("INSERT INTO hs_data_collection_grants(tenant_id,user_id,collection,capabilities) VALUES($1,$2,'contacts',ARRAY['view','manage-permissions'])",[tenant,actor]);
 });
 afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
 it('commits exactly one concurrent confirmation and rejects stale grant',async()=>{
  const expected=await portalRecordPermission(db,config,{...request,operation:'record_preview'},authority);
  const results=await Promise.allSettled([['view'],['view','edit']].map(capabilities=>portalRecordPermission(db,config,{...request,operation:'record_apply',request_id:crypto.randomUUID(),expected,change:{collectionGrant:{expectedVersion:0,capabilities}}},authority)));
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
  expect((await db.query('SELECT * FROM hs_portal_permission_receipts WHERE target_id=$1',[target])).rows).toHaveLength(1);
 });
});
