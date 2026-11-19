import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDatabase,type Database} from './database';
import {Repository} from './repository';
import {portalScopePermission} from './portal-scope-permissions';
import {localActor} from './auth';
let db:Database,r:Repository,page:string,child:string;
const actor='scope-reviewer',target='scope-target',workspace='ws-aplyd';
const scope={enabled:true,issuer:'https://accounts.synthetic.invalid',workspace};
const call=(operation:string,fields:Record<string,unknown>={})=>portalScopePermission(db,scope,{operation,actor_subject:actor,target_subject:target,...fields});
const preview=(kind='page',resource_id=page)=>call('scope_preview',{kind,resource_id}) as Promise<any>;
const apply=async(role:string|null,kind='page',resource_id=page,expected?:unknown,request_id=crypto.randomUUID())=>call('scope_apply',{kind,resource_id,role,expected:expected??await preview(kind,resource_id),request_id}) as Promise<any>;
beforeAll(async()=>{
 db=await createDatabase(':memory:');r=new Repository(db);await r.seedLocal();
 for(const id of [actor,target])await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[id]);
 await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",[workspace,actor,target]);
 await db.query('INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,$4)',[workspace,scope.issuer,actor,'synthetic-reviewed']);
 page=(await r.create({id:actor},'Private owned page','space-product')).id;
 await db.query("UPDATE hs_pages SET visibility='private' WHERE id=$1",[page]);
});
afterAll(async()=>{await db?.close();});
it('lists only owned pages and scoped spaces and refuses a different page owner',async()=>{
 const other=(await r.create(localActor,'Other owner private page','space-product')).id;
 const inventory=await call('scope_inventory') as any;
 expect(inventory.pages.map((p:any)=>p.id)).toContain(page);
 expect(inventory.pages.map((p:any)=>p.id)).not.toContain(other);
 await expect(preview('page',other)).rejects.toMatchObject({status:403});
 await expect(preview('space','missing')).rejects.toMatchObject({status:403});
});
it('grants editor then viewer then removes direct page access and preserves content',async()=>{
 const content=(await db.query('SELECT title,owner_id,visibility FROM hs_pages WHERE id=$1',[page])).rows;
 expect((await preview()).role).toBe(null);
 await apply('editor');expect((await r.get(page,{id:target})).role).toBe('editor');
 await apply('viewer');expect((await r.get(page,{id:target})).role).toBe('viewer');
 await expect(r.access(db,page,{id:target},true)).rejects.toMatchObject({status:403});
 await apply(null);await expect(r.get(page,{id:target})).rejects.toMatchObject({status:404});
 expect((await db.query('SELECT title,owner_id,visibility FROM hs_pages WHERE id=$1',[page])).rows).toEqual(content);
});
it('does not erase or misreport inherited access on direct revoke',async()=>{
 child=(await r.create({id:actor},'Child page','space-product')).id;
 await db.query("UPDATE hs_pages SET parent_id=$1,visibility='private' WHERE id=$2",[page,child]);
 await apply('editor');await apply('viewer','page',child);
 const result=await apply(null,'page',child);
 expect(result.after.role).toBe(null);expect(result.after.inherited_access).toBe(true);expect(result.after.effective_role).toBe('editor');
 await apply(null);await expect(r.get(child,{id:target})).rejects.toMatchObject({status:404});
});
it('rejects an ancestor grant changed away and back after review',async()=>{
 const old=await preview('page',child);await apply('editor');await apply(null);
 await expect(apply('viewer','page',child,old)).rejects.toMatchObject({code:'access_conflict'});
});
it('uses native space roles and preserves independent page grants',async()=>{
 await apply('viewer');
 await apply('editor','space','space-product');expect((await preview('space','space-product')).role).toBe('editor');
 await apply('viewer','space','space-product');expect((await preview('space','space-product')).role).toBe('viewer');
 await apply(null,'space','space-product');expect((await preview('space','space-product')).role).toBe(null);
 expect((await r.get(page,{id:target})).role).toBe('viewer');await apply(null);
});
it('rejects stale review, invalid role, cross-resource and replay',async()=>{
 const old=await preview();await apply('editor');await apply(null);
 await expect(apply('editor','page',page,old)).rejects.toMatchObject({code:'access_conflict'});
 await expect(apply('leader')).rejects.toThrow();await expect(apply('commenter','space','space-product')).rejects.toThrow();
 const p=await preview(),id=crypto.randomUUID();await apply(null,'page',page,p,id);
 await expect(apply(null,'page',page,p,id)).rejects.toMatchObject({code:'operation_mismatch'});
 await expect(apply('editor','page',child,p)).rejects.toMatchObject({code:'access_conflict'});
});
it('rechecks reviewer and target membership and never elevates an Observer beyond viewer',async()=>{
 await db.query("UPDATE hs_members SET role='observer' WHERE user_id=$1",[target]);
 const x=await apply('editor');expect(x.after.effective_role).toBe('viewer');
 await apply(null);await db.query("UPDATE hs_members SET role='member' WHERE user_id=$1",[target]);
 const old=await preview();await db.query('UPDATE hs_portal_reviewers SET enabled=false WHERE subject=$1',[actor]);
 await expect(apply('editor','page',page,old)).rejects.toMatchObject({status:403});
 await db.query('UPDATE hs_portal_reviewers SET enabled=true WHERE subject=$1',[actor]);
 await expect(apply('editor','page',page,old)).rejects.toMatchObject({code:'access_conflict'});
 await db.query('UPDATE hs_members SET active=false WHERE user_id=$1',[target]);
 await expect(preview()).rejects.toMatchObject({status:403});await db.query('UPDATE hs_members SET active=true WHERE user_id=$1',[target]);
});
it('rolls back the native grant and audit if receipt persistence fails',async()=>{
 const before=await preview(),counts=async()=>Promise.all(['hs_audit','hs_share_operations','hs_portal_permission_receipts'].map(async t=>(await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]));
 const old=await counts();
 await db.query("CREATE FUNCTION reject_scope_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$");
 await db.query('CREATE TRIGGER fail_scope_receipt BEFORE INSERT ON hs_portal_permission_receipts FOR EACH ROW EXECUTE FUNCTION reject_scope_receipt()');
 await expect(apply('editor')).rejects.toThrow();expect(await preview()).toEqual(before);expect(await counts()).toEqual(old);
 await db.query('DROP TRIGGER fail_scope_receipt ON hs_portal_permission_receipts');
});
