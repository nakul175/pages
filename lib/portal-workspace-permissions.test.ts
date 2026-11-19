import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDatabase,type Database} from './database';
import {Repository} from './repository';
import {localActor} from './auth';
import {portalWorkspacePermission,type PortalPlan} from './portal-workspace-permissions';

let db:Database,r:Repository,page:string;
const actor='portal-reviewer',target='native-target',workspace='ws-aplyd';
const scope={enabled:true,issuer:'https://accounts.synthetic.invalid',workspace};
const preview=()=>portalWorkspacePermission(db,scope,{operation:'preview',actor_subject:actor,target_subject:target}) as Promise<PortalPlan>;
const apply=async(choice:string,expected?:PortalPlan,request_id=crypto.randomUUID())=>portalWorkspacePermission(db,scope,
 {operation:'apply',actor_subject:actor,target_subject:target,choice,expected:expected??await preview(),request_id});
beforeAll(async()=>{
 db=await createDatabase(':memory:');r=new Repository(db);await r.seedLocal();
 for(const id of [actor,target])await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[id]);
 await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",[workspace,actor,target]);
 page=(await r.create(localActor,'Preserved customer document','space-product')).id;
 await db.query("INSERT INTO hs_grants(page_id,subject,role) VALUES($1,$2,'editor')",[page,target]);
});
afterAll(async()=>{await db?.close();});
it('denies by default and requires an explicit existing reviewer/identity/scope',async()=>{
 await expect(preview()).rejects.toMatchObject({code:'portal_authority_denied'});
 await db.query('INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,$4)',[workspace,scope.issuer,actor,'synthetic-reviewed']);
 expect((await preview()).role).toBe('member');
 await expect(portalWorkspacePermission(db,{...scope,enabled:false},{operation:'preview',actor_subject:actor,target_subject:target})).rejects.toThrow();
 await expect(portalWorkspacePermission(db,{...scope,issuer:'https://different.invalid'},{operation:'preview',actor_subject:actor,target_subject:target})).rejects.toThrow();
 await expect(portalWorkspacePermission(db,scope,{operation:'preview',actor_subject:actor,target_subject:'not-provisioned'})).rejects.toThrow();
 await expect(portalWorkspacePermission(db,scope,{operation:'preview',actor_subject:actor,target_subject:actor})).rejects.toThrow();
});
it('uses current native role and removes page write permission on downgrade without deleting grants',async()=>{
 const grants=(await db.query('SELECT * FROM hs_grants WHERE page_id=$1',[page])).rows;
 await apply('admin');expect((await r.get(page,{id:target})).role).toBe('editor');
 await apply('observer');expect((await r.get(page,{id:target})).role).toBe('viewer');
 await expect(r.access(db,page,{id:target},true)).rejects.toMatchObject({status:403});
 expect((await db.query('SELECT * FROM hs_grants WHERE page_id=$1',[page])).rows).toEqual(grants);
 await apply('member');expect((await r.get(page,{id:target})).role).toBe('editor');
});
it('revokes only workspace membership, preserves content and grants, and restores original access on regrant',async()=>{
 const before=(await db.query('SELECT * FROM hs_pages WHERE id=$1',[page])).rows;
 const grants=(await db.query('SELECT * FROM hs_grants WHERE page_id=$1',[page])).rows;
 const users=(await db.query('SELECT * FROM hs_users ORDER BY id')).rows;
 await apply('revoke');await expect(r.get(page,{id:target})).rejects.toMatchObject({status:404});
 expect((await preview()).active).toBe(false);
 expect((await db.query('SELECT * FROM hs_pages WHERE id=$1',[page])).rows).toEqual(before);
 expect((await db.query('SELECT * FROM hs_grants WHERE page_id=$1',[page])).rows).toEqual(grants);
 expect((await db.query('SELECT * FROM hs_users ORDER BY id')).rows).toEqual(users);
 await apply('member');expect((await r.get(page,{id:target})).role).toBe('editor');
});
it('rejects stale role ABA, revoked/re-enabled reviewers and forged scope before native mutation',async()=>{
 const old=await preview();
 await db.query("UPDATE hs_members SET role='observer' WHERE workspace_id=$1 AND user_id=$2",[workspace,target]);
 await db.query("UPDATE hs_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",[workspace,target]);
 await expect(apply('admin',old)).rejects.toMatchObject({code:'access_conflict'});
 const reviewerPlan=await preview();
 await db.query('UPDATE hs_portal_reviewers SET enabled=false WHERE subject=$1',[actor]);
 await expect(apply('admin',reviewerPlan)).rejects.toMatchObject({code:'portal_authority_denied'});
 await db.query('UPDATE hs_portal_reviewers SET enabled=true WHERE subject=$1',[actor]);
 await expect(apply('admin',reviewerPlan)).rejects.toMatchObject({code:'access_conflict'});
 const current=await preview();await expect(apply('admin',{...current,workspace:'another'})).rejects.toMatchObject({code:'access_conflict'});
 await expect(apply('owner')).rejects.toThrow();
 expect((await preview()).role).toBe('member');
});
it('holds native Owners and reviewers whose native management authority was removed',async()=>{
 await db.query("UPDATE hs_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",[workspace,target]);
 await expect(preview()).rejects.toMatchObject({code:'portal_authority_denied'});
 await db.query("UPDATE hs_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",[workspace,target]);
 await db.query("UPDATE hs_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",[workspace,actor]);
 await expect(preview()).rejects.toMatchObject({code:'portal_authority_denied'});
 await db.query("UPDATE hs_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",[workspace,actor]);
});
it('rolls back native membership, audit and operation when durable receipt insertion fails',async()=>{
 const before=await preview(),counts=async()=>Promise.all(['hs_workspace_audit','hs_workspace_operations','hs_portal_permission_receipts'].map(async t=>(await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]));
 const initial=await counts();
 await db.query("CREATE FUNCTION reject_portal_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$");
 await db.query('CREATE TRIGGER fail_receipt BEFORE INSERT ON hs_portal_permission_receipts FOR EACH ROW EXECUTE FUNCTION reject_portal_receipt()');
 await expect(apply('admin',before)).rejects.toThrow();
 expect(await preview()).toEqual(before);expect(await counts()).toEqual(initial);
 await db.query('DROP TRIGGER fail_receipt ON hs_portal_permission_receipts');
});
it('consumes a confirmation once, including no-op changes, and rejects malformed input',async()=>{
 const p=await preview(),id=crypto.randomUUID();await apply('member',p,id);
 await expect(apply('member',p,id)).rejects.toMatchObject({code:'operation_mismatch'});
 await expect(portalWorkspacePermission(db,scope,{operation:'preview',actor_subject:actor,target_subject:target,role:'owner'})).rejects.toThrow();
});
