import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDatabase,type Database} from './database';
import {Repository} from './repository';
import {portalOwnership} from './portal-ownership';
import {acceptOwnershipTransfer} from './ownership-transfer';
let db:Database;
beforeAll(async()=>{const url=process.env.HS_TEST_POSTGRES_URL;if(url){const parsed=new URL(url);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!='/holy_sheet_acceptance')throw Error('Only disposable loopback acceptance database');process.env.DATABASE_URL=url;db=await createDatabase();}else db=await createDatabase(':memory:');},30000);afterAll(()=>db.close());
async function fixture(){
 const workspace='ownership-'+crypto.randomUUID(),owner='owner-'+crypto.randomUUID(),target='target-'+crypto.randomUUID();
 for(const id of [owner,target])await db.query('INSERT INTO hs_users(id,name) VALUES($1,$1)',[id]);
 await db.query('INSERT INTO hs_workspaces(id,name) VALUES($1,$1)',[workspace]);
 await db.query("INSERT INTO hs_members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'admin')",[workspace,owner,target]);
 const scope={enabled:true,issuer:'https://accounts.example.invalid',workspace};
 await db.query("INSERT INTO hs_portal_reviewers(workspace_id,issuer,subject,enabled,review_reference) VALUES($1,$2,$3,true,'reviewed')",[workspace,scope.issuer,owner]);
 return {scope,input:{actor_subject:owner,target_subject:target},owner,target,workspace};
}
it('request preserves ownership until selected recipient accepts; live status reflects both roles',async()=>{
 const f=await fixture(),expected=await portalOwnership(db,f.scope,{...f.input,operation:'ownership_preview'}),request_id=crypto.randomUUID();
 const result:any=await portalOwnership(db,f.scope,{...f.input,operation:'ownership_request',expected,request_id});expect(result.after.state).toBe('pending');
 const status=()=>portalOwnership(db,f.scope,{...f.input,operation:'ownership_status',request_id});expect(await status()).toMatchObject({state:'pending',current:{actor_role:'owner',target_role:'admin'}});
 const version=(await db.query<{version:number}>('SELECT access_version AS version FROM hs_workspaces WHERE id=$1',[f.workspace])).rows[0].version;
 await expect(acceptOwnershipTransfer(new Repository(db),{id:f.owner},f.workspace,{transferId:result.after.transfer_id,operationId:crypto.randomUUID(),expectedVersion:version})).rejects.toMatchObject({status:404});
 await acceptOwnershipTransfer(new Repository(db),{id:f.target},f.workspace,{transferId:result.after.transfer_id,operationId:crypto.randomUUID(),expectedVersion:version});
 expect(await status()).toMatchObject({state:'accepted',current:{actor_role:'admin',target_role:'owner'}});
});
it('off scope, unreviewed owner and ineligible target reject',async()=>{
 const f=await fixture();await expect(portalOwnership(db,{...f.scope,enabled:false},{...f.input,operation:'ownership_preview'})).rejects.toThrow();
 await db.query('UPDATE hs_portal_reviewers SET enabled=false WHERE workspace_id=$1',[f.workspace]);await expect(portalOwnership(db,f.scope,{...f.input,operation:'ownership_preview'})).rejects.toMatchObject({status:403});
 await db.query('UPDATE hs_portal_reviewers SET enabled=true WHERE workspace_id=$1',[f.workspace]);await db.query("UPDATE hs_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",[f.workspace,f.target]);await expect(portalOwnership(db,f.scope,{...f.input,operation:'ownership_preview'})).rejects.toMatchObject({code:'transfer_target_ineligible'});
});
it('changed reviewer rejects stale request',async()=>{
 const f=await fixture(),expected=await portalOwnership(db,f.scope,{...f.input,operation:'ownership_preview'});
 await db.query("UPDATE hs_portal_reviewers SET review_reference='new review' WHERE workspace_id=$1",[f.workspace]);await expect(portalOwnership(db,f.scope,{...f.input,operation:'ownership_request',expected,request_id:crypto.randomUUID()})).rejects.toMatchObject({code:'access_conflict'});
 expect((await db.query('SELECT id FROM hs_ownership_transfers WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('pending handover is not replaced and consumed confirmation cannot repeat',async()=>{
 const f=await fixture(),expected=await portalOwnership(db,f.scope,{...f.input,operation:'ownership_preview'}),input={...f.input,operation:'ownership_request',expected,request_id:crypto.randomUUID()};
 await portalOwnership(db,f.scope,input);await expect(portalOwnership(db,f.scope,input)).rejects.toMatchObject({code:'pending_transfer'});expect((await db.query('SELECT id,state FROM hs_ownership_transfers WHERE workspace_id=$1',[f.workspace])).rows).toMatchObject([{state:'pending'}]);
});
it('receipt failure rolls back request, workspace version and native audit',async()=>{
 const f=await fixture(),expected:any=await portalOwnership(db,f.scope,{...f.input,operation:'ownership_preview'});
 const broken:Database={...db,transaction:fn=>db.transaction(tx=>fn({query:async<T>(sql:string,values?:unknown[])=>{if(sql.startsWith('INSERT INTO hs_portal_permission_receipts'))throw Error('fixture receipt failure');return tx.query<T>(sql,values);}}))};
 await expect(portalOwnership(broken,f.scope,{...f.input,operation:'ownership_request',expected,request_id:crypto.randomUUID()})).rejects.toThrow('fixture receipt failure');
 expect((await db.query('SELECT id FROM hs_ownership_transfers WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);expect((await db.query('SELECT id FROM hs_workspace_audit WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);expect(await portalOwnership(db,f.scope,{...f.input,operation:'ownership_preview'})).toMatchObject({version:expected.version});
});
