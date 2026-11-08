import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDatabase,type Database} from './database';
import {Repository} from './repository';
import {localActor} from './auth';
import {recordCapabilities,recordGrantCapabilities} from './shared-record-types';
it('restarts with newer record grants intact and still rejects unknown capabilities',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hs-record-replay-'));let db:Database|undefined;
 const tenant=crypto.randomUUID(),record=crypto.randomUUID();
 try{
  db=await createDatabase(dir);await new Repository(db).seedLocal();
  await db.query("INSERT INTO hs_data_tenants(id,name) VALUES($1,'Synthetic')",[tenant]);
  await db.query("INSERT INTO hs_data_collections(tenant_id,id,name,core) VALUES($1,'contacts','Contacts',true)",[tenant]);
  await db.query("INSERT INTO hs_data_collection_grants(tenant_id,user_id,collection,capabilities) VALUES($1,$2,'contacts',$3)",[tenant,localActor.id,[...recordCapabilities]]);
  await db.query("INSERT INTO hs_data_records(id,tenant_id,collection,name,created_by,updated_by) VALUES($1,$2,'contacts','Preserved',$3,$3)",[record,tenant,localActor.id]);
  await db.query("INSERT INTO hs_data_record_grants(tenant_id,user_id,record_id,capabilities) VALUES($1,$2,$3,$4)",[tenant,localActor.id,record,[...recordGrantCapabilities]]);
  const collectionBefore=(await db.query('SELECT * FROM hs_data_collection_grants WHERE tenant_id=$1',[tenant])).rows;
  const recordBefore=(await db.query('SELECT * FROM hs_data_record_grants WHERE tenant_id=$1',[tenant])).rows;
  await db.close();db=undefined;db=await createDatabase(dir);
  expect((await db.query('SELECT * FROM hs_data_collection_grants WHERE tenant_id=$1',[tenant])).rows).toEqual(collectionBefore);
  expect((await db.query('SELECT * FROM hs_data_record_grants WHERE tenant_id=$1',[tenant])).rows).toEqual(recordBefore);
  for(const table of ['hs_data_collection_grants','hs_data_record_grants'])await expect(db.query(`UPDATE ${table} SET capabilities=ARRAY['not-a-capability'] WHERE tenant_id=$1`,[tenant])).rejects.toThrow();
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});
