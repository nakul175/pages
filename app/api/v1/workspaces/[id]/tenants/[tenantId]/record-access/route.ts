import {DocumentError} from '../../../../../../../../lib/document';
import {repository} from '../../../../../../../../lib/repository';
import {authenticateRecordAuthority} from '../../../../../../../../lib/suite-tenant-authority';
import {SharedRecordSessionRepository} from '../../../../../../../../lib/shared-record-session';
const headers={'Cache-Control':'no-store, private','Vary':'Cookie, Authorization'};
export async function GET(request:Request,{params}:{params:Promise<{id:string;tenantId:string}>}){
 try{
  const {id:workspaceId,tenantId}=await params,{actor,authority}=await authenticateRecordAuthority(request);
  return Response.json(await new SharedRecordSessionRepository(await repository(),authority).fingerprint({actor,workspaceId,tenantId}),{headers});
 }catch(error){return Response.json({error:'Record access cannot be confirmed.'},{status:error instanceof DocumentError?error.status:503,headers});}
}
