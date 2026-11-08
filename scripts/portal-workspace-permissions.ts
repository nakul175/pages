import {Pool} from 'pg';
import type {Database} from '../lib/database';
import {portalWorkspacePermission} from '../lib/portal-workspace-permissions';
import {portalRecordPermission,accountsRecordAuthority} from '../lib/portal-record-permissions';
import {portalScopePermission} from '../lib/portal-scope-permissions';
import {portalProvision} from '../lib/portal-provisioning';

// No createDatabase(): that routine runs migrations. This connector must never
// migrate, seed accounts or fall back to a developer database.
let pool:Pool|undefined;
const deadline=setTimeout(()=>process.exit(1),15000);
try{
 if(process.env.HS_PORTAL_WRITER_ENABLED!=='1'||!process.env.HS_PORTAL_DATABASE_URL)throw Error();
 const config={enabled:true,issuer:process.env.HS_IDENTITY_ISSUER,workspace:process.env.HS_PORTAL_WORKSPACE_ID};
 let bytes=0;const chunks:Buffer[]=[];
 for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>16384)throw Error();chunks.push(chunk);}
 const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 pool=new Pool({connectionString:process.env.HS_PORTAL_DATABASE_URL,max:1,
  connectionTimeoutMillis:3000,statement_timeout:8000,query_timeout:9000,
  ssl:process.env.PGSSL==='require'?{rejectUnauthorized:true}:undefined});
 const db:Database={query:async<T>(sql:string,values?:unknown[])=>({rows:(await pool!.query(sql,values)).rows as T[]}),
  transaction:async fn=>{const c=await pool!.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");
   const result=await fn({query:async<T>(sql:string,values?:unknown[])=>({rows:(await c.query(sql,values)).rows as T[]})});
   await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}},close:async()=>{}};
 const creating=['provision_preview','provision_apply'].includes(input?.operation);
 if(creating&&process.env.HS_PORTAL_PROVISIONING_ENABLED!=='1')throw Error();
 const scoped=['scope_inventory','scope_preview','scope_apply'].includes(input?.operation);
 if(scoped&&process.env.HS_PORTAL_SCOPES_ENABLED!=='1')throw Error();
 const records=['record_inventory','record_preview','record_apply'].includes(input?.operation);
 if(records&&(process.env.HS_PORTAL_RECORDS_ENABLED!=='1'||!process.env.HS_PORTAL_RECORDS_SECRET))throw Error();
 const result=records?await portalRecordPermission(db,{...config,tenant:process.env.HS_PORTAL_TENANT_ID},input,accountsRecordAuthority(config.issuer!,process.env.HS_PORTAL_RECORDS_SECRET!,input.actor_subject,input.actor_uid)):await (creating?portalProvision:scoped?portalScopePermission:portalWorkspacePermission)(db,config,input);
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Native workspace confirmation unavailable.\n');process.exitCode=1;}
finally{await pool?.end();clearTimeout(deadline);}
