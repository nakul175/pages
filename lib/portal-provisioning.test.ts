import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDatabase,type Database} from './database';
import {Repository} from './repository';
import {localActor} from './auth';
import {portalProvision} from './portal-provisioning';
import {portalWorkspacePermission} from './portal-workspace-permissions';

let db:Database,r:Repository,page:string;
const scope={enabled:true,issuer:'https://accounts.synthetic.invalid',workspace:'ws-aplyd'};
const actor=localActor.id,target='new-exact-central-subject';
const input={actor_subject:actor,target_subject:target,name:'Synthetic new person'};
const preview=(data=input)=>portalProvision(db,scope,{...data,operation:'provision_preview'});
const apply=async(data=input,expected?:unknown)=>portalProvision(db,scope,{...data,operation:'provision_apply',request_id:crypto.randomUUID(),expected:expected??await preview(data)});
beforeAll(async()=>{
 db=await createDatabase(':memory:');r=new Repository(db);await r.seedLocal();
 await db.query("UPDATE hs_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",[scope.workspace,actor]);
 page=(await r.create(localActor,'Existing protected content','space-product')).id;
});
afterAll(async()=>{await db?.close();});
it('requires default-off explicit reviewed native authority and an absent subject',async()=>{
 await expect(preview()).rejects.toMatchObject({code:'provision_authority_denied'});
 await db.query('INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,$4)',[scope.workspace,scope.issuer,actor,'Synthetic reviewed native owner']);
 await expect(portalProvision(db,{...scope,enabled:false},{...input,operation:'provision_preview'})).rejects.toThrow();
 await expect(preview({...input,target_subject:actor})).rejects.toThrow();
 await expect(preview({...input,target_subject:'space'})).rejects.toThrow();
 await expect(portalProvision(db,{...scope,issuer:'https://different.invalid'},{...input,operation:'provision_preview'})).rejects.toThrow();
 expect(await preview()).toMatchObject({absent:true,role:'observer',active:true});
});
it('rejects stale reviewer authority and request substitution before creation',async()=>{
 const p=await preview();
 await db.query('UPDATE hs_portal_reviewers SET enabled=false WHERE subject=$1',[actor]);
 await expect(apply(input,p)).rejects.toThrow();
 await db.query('UPDATE hs_portal_reviewers SET enabled=true WHERE subject=$1',[actor]);
 await expect(apply(input,p)).rejects.toMatchObject({code:'access_conflict'});
 await expect(apply({...input,name:'Substituted name'},await preview())).rejects.toMatchObject({code:'access_conflict'});
 expect((await db.query('SELECT id FROM hs_users WHERE id=$1',[target])).rows).toHaveLength(0);
});
it('does not reactivate dormant direct grants by creating a matching subject',async()=>{
 await db.query("INSERT INTO hs_grants(page_id,subject,role) VALUES($1,$2,'editor')",[page,target]);
 await expect(preview()).rejects.toMatchObject({code:'provision_authority_denied'});
 await db.query('DELETE FROM hs_grants WHERE page_id=$1 AND subject=$2',[page,target]);
});
it('atomically creates Observer with no direct grants, existing identities untouched',async()=>{
 const before=(await db.query('SELECT * FROM hs_users ORDER BY id')).rows;
 const docs=(await db.query('SELECT * FROM hs_pages ORDER BY id')).rows;
 const result=await apply();expect(result).toMatchObject({subject:target,role:'observer',active:true});
 expect((await db.query('SELECT * FROM hs_users WHERE id!=$1 ORDER BY id',[target])).rows).toEqual(before);
 expect((await db.query('SELECT * FROM hs_pages ORDER BY id')).rows).toEqual(docs);
 expect((await db.query('SELECT * FROM hs_grants WHERE subject=$1',[target])).rows).toHaveLength(0);
 expect((await db.query('SELECT * FROM hs_portal_provision_receipts WHERE target_id=$1',[target])).rows).toHaveLength(1);
 await expect(r.get(page,{id:target})).rejects.toMatchObject({status:404});
 await expect(apply()).rejects.toMatchObject({code:'provision_authority_denied'});
});
it('new account uses current native grant, downgrade and revoke rules with content preserved',async()=>{
 const before=(await db.query('SELECT * FROM hs_pages ORDER BY id')).rows;
 const subjects={actor_subject:actor,target_subject:target};
 const save=async(choice:string)=>{const expected=await portalWorkspacePermission(db,scope,{...subjects,operation:'preview'});return portalWorkspacePermission(db,scope,{...subjects,operation:'apply',choice,expected,request_id:crypto.randomUUID()});};
 await save('admin');expect((await r.get(page,{id:target})).role).toBe('editor');
 await save('observer');await expect(r.get(page,{id:target})).rejects.toMatchObject({status:404});
 await save('revoke');await expect(r.get(page,{id:target})).rejects.toMatchObject({status:404});
 expect((await db.query('SELECT * FROM hs_pages ORDER BY id')).rows).toEqual(before);
});
it('receipt failure rolls back user, membership and workspace version',async()=>{
 const other={...input,target_subject:'rollback-new-person'},p=await preview(other);
 await db.query("CREATE FUNCTION fail_hs_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$");
 await db.query('CREATE TRIGGER fail_hs_creation BEFORE INSERT ON hs_portal_provision_receipts FOR EACH ROW EXECUTE FUNCTION fail_hs_creation()');
 try{await expect(apply(other,p)).rejects.toThrow();}finally{await db.query('DROP TRIGGER fail_hs_creation ON hs_portal_provision_receipts');}
 expect((await db.query('SELECT id FROM hs_users WHERE id=$1',[other.target_subject])).rows).toHaveLength(0);
 expect(await preview(other)).toEqual(p);
});
