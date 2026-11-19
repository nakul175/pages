import {SharedRecordRepository,type RecordContext} from './shared-records';
import {recordHash} from './shared-record-types';
/** Values are deliberately excluded; this proof invalidates cached permission-derived UI. */
export class SharedRecordSessionRepository extends SharedRecordRepository {
 async fingerprint(ctx:RecordContext){
  return this.transaction(ctx,async(tx,t,proof)=>{
   const args=[ctx.tenantId,ctx.actor.id];
   const collections=(await tx.query('SELECT collection,capabilities,version FROM hs_data_collection_grants WHERE tenant_id=$1 AND user_id=$2 ORDER BY collection',args)).rows;
   const records=(await tx.query('SELECT record_id,capabilities,version FROM hs_data_record_grants WHERE tenant_id=$1 AND user_id=$2 ORDER BY record_id',args)).rows;
   const fields=(await tx.query('SELECT collection,field_key,can_view,can_write,can_history,version FROM hs_data_field_permissions WHERE tenant_id=$1 AND user_id=$2 ORDER BY collection,field_key',args)).rows;
   const membership=(await tx.query('SELECT role,active FROM hs_members WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,ctx.actor.id])).rows;
   return {revision:recordHash({schema:t.schema_version,policy:t.policy_version,proof,collections,records,fields,membership})};
  });
 }
}
