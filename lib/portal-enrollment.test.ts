import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDatabase,type Database} from './database';
import {Repository} from './repository';
import {portalEnrollment} from './portal-enrollment';
let db:Database;
beforeAll(async()=>{const url=process.env.HS_TEST_POSTGRES_URL;if(url){const p=new URL(url);if(p.hostname!=='127.0.0.1'||p.pathname!='/holy_sheet_acceptance')throw Error('Synthetic loopback database only');process.env.DATABASE_URL=url;db=await createDatabase();}else db=await createDatabase(':memory:');},30000);
afterAll(()=>db.close());
async function fixture(){
 const workspace=crypto.randomUUID(),origin=crypto.randomUUID(),owner=crypto.randomUUID(),target=crypto.randomUUID();
 for(const id of [workspace,origin])await db.query('INSERT INTO hs_workspaces(id,name) VALUES($1,$1)',[id]);
 for(const id of [owner,target])await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[id]);
 await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'member')",[workspace,owner,origin,target]);
 const scope={enabled:true,issuer:'https://accounts.example.invalid',workspace};
 await db.query("INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,'reviewed')",[workspace,scope.issuer,owner]);
 return {workspace,origin,owner,target,scope,input:{actor_subject:owner,target_subject:target}};
}
it('adds one Observer and preserves exact identity and prior workspace membership',async()=>{
 const f=await fixture(),before=(await db.query('SELECT * FROM hs_users WHERE id=$1',[f.target])).rows,expected=await portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'});
 const result=await portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_apply',expected,request_id:crypto.randomUUID()});expect(result).toMatchObject({after:{role:'observer',active:true}});
 expect((await db.query('SELECT * FROM hs_users WHERE id=$1',[f.target])).rows).toEqual(before);
 expect((await db.query('SELECT role,active FROM hs_members WHERE workspace_id=$1 AND user_id=$2',[f.origin,f.target])).rows).toEqual([{role:'member',active:true}]);
});
it('disabled flag, unknown identity, and inactive or existing membership fail closed',async()=>{
 const f=await fixture(),q={...f.input,operation:'enrollment_preview'};
 await expect(portalEnrollment(db,{...f.scope,enabled:false},q)).rejects.toThrow();
 await expect(portalEnrollment(db,f.scope,{...q,target_subject:'unknown'})).rejects.toMatchObject({status:403});
 await db.query('UPDATE hs_members SET active=false WHERE user_id=$1',[f.target]);await expect(portalEnrollment(db,f.scope,q)).rejects.toMatchObject({status:403});
 await db.query('UPDATE hs_members SET active=true WHERE user_id=$1',[f.target]);await db.query("INSERT INTO hs_members(workspace_id,user_id,role,active) VALUES($1,$2,'observer',false)",[f.workspace,f.target]);await expect(portalEnrollment(db,f.scope,q)).rejects.toMatchObject({status:403});
});
it('stale reviewer or original membership review cannot enroll',async()=>{
 const f=await fixture(),expected=await portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'});
 await db.query("UPDATE hs_members SET role='admin' WHERE workspace_id=$1 AND user_id=$2",[f.origin,f.target]);
 await expect(portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_apply',expected,request_id:crypto.randomUUID()})).rejects.toMatchObject({code:'access_conflict'});
});
it('native invitations cannot be silently activated or bypassed',async()=>{
 const f=await fixture();await db.query("INSERT INTO hs_access_invitations(id,workspace_id,central_invitation_id,invitee_subject,intended_workspace_role,state,invited_by,expires_at) VALUES($1,$2,$5,$3,'admin','pending',$4,clock_timestamp()+interval '1 day')",[crypto.randomUUID(),f.workspace,f.target,f.owner,crypto.randomUUID()]);
 await expect(portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'})).rejects.toMatchObject({status:403});
});
it('receipt failure rolls back new membership and version',async()=>{
 const f=await fixture(),expected:any=await portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'});
 const broken:Database={...db,transaction:fn=>db.transaction(tx=>fn({query:async<T>(sql:string,values?:unknown[])=>{if(sql.startsWith('INSERT INTO hs_portal_permission_receipts'))throw Error('fixture receipt failure');return tx.query<T>(sql,values);}}))};
 await expect(portalEnrollment(broken,f.scope,{...f.input,operation:'enrollment_apply',expected,request_id:crypto.randomUUID()})).rejects.toThrow('fixture receipt failure');
 expect(await portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'})).toEqual(expected);
});
it('two concurrent confirmations commit only one exact membership',async()=>{
 const f=await fixture(),expected=await portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'});
 const result=await Promise.allSettled([1,2].map(()=>portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_apply',expected,request_id:crypto.randomUUID()})));
 expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(result.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await db.query('SELECT request_id FROM hs_portal_permission_receipts WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(1);
});

it('dormant page grants and ownership cannot silently activate',async()=>{
 const f=await fixture(),repo=new Repository(db),space=await repo.createSpace({id:f.owner},'Scope fixture',f.workspace),page=await repo.create({id:f.owner},'Preserved page',space.id);
 await db.query("INSERT INTO hs_grants(page_id,subject,role) VALUES($1,$2,'editor')",[page.id,f.target]);
 await expect(portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'})).rejects.toMatchObject({status:403});
 await expect(db.query('UPDATE hs_pages SET space_id=NULL WHERE id=$1',[page.id])).rejects.toMatchObject({code:'23502'});
 await expect(portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'})).rejects.toMatchObject({status:403});
 await db.query('DELETE FROM hs_grants WHERE page_id=$1 AND subject=$2',[page.id,f.target]);await db.query('UPDATE hs_pages SET owner_id=$1 WHERE id=$2',[f.target,page.id]);
 await expect(portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'})).rejects.toMatchObject({status:403});
});
it('existing tenant record grants require separate review before membership',async()=>{
 const f=await fixture(),tenant=crypto.randomUUID();await db.query("INSERT INTO hs_data_tenants(id,name) VALUES($1,'Synthetic tenant')",[tenant]);await db.query("INSERT INTO hs_data_workspaces(workspace_id,tenant_id,review_reference) VALUES($1,$2,'synthetic')",[f.workspace,tenant]);await db.query("INSERT INTO hs_data_tenant_grants(tenant_id,user_id,capabilities) VALUES($1,$2,ARRAY['manage-collections'])",[tenant,f.target]);
 await expect(portalEnrollment(db,f.scope,{...f.input,operation:'enrollment_preview'})).rejects.toMatchObject({status:403});
});
