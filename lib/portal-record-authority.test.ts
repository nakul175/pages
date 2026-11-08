import {afterEach,it,expect,vi} from 'vitest';
import {accountsRecordAuthority} from './portal-record-permissions';
const ctx={actor:{id:'actor'},tenantId:'40000000-0000-4000-8000-000000000010',workspaceId:'ws'};
const secret='synthetic-only-client-secret-with-length';
const proof={active:true,subject:'actor',tenantId:ctx.tenantId,workspaceId:'ws',tenantAdministrator:true,revision:'a'.repeat(64)};
afterEach(()=>vi.unstubAllGlobals());
it('pins service client, subject, session and exact tenant/workspace',async()=>{
 const fetch=vi.fn().mockResolvedValue(Response.json(proof));vi.stubGlobal('fetch',fetch);
 expect(await accountsRecordAuthority('https://accounts.synthetic.invalid',secret,'actor','uid').verify(ctx)).toEqual(proof);
 const [url,options]=fetch.mock.calls[0];expect(String(url)).toBe('https://accounts.synthetic.invalid/internal/tenant/status');
 expect(JSON.parse(options.body)).toEqual({client_id:'holy-sheet',client_secret:secret,sub:'actor',uid:'uid',tenant_id:ctx.tenantId,workspace_id:'ws'});expect(options.redirect).toBe('error');
});
it('rejects unverifiable, inactive, mismatched, oversized and extended responses',async()=>{
 for(const response of [Response.json({active:false}),Response.json({...proof,subject:'other'}),Response.json({...proof,tenantId:'40000000-0000-4000-8000-000000000099'}),Response.json({...proof,extra:true}),new Response('x'.repeat(8193),{headers:{'Content-Type':'application/json'}}),new Response('',{status:503})]){
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));await expect(accountsRecordAuthority('https://accounts.synthetic.invalid',secret,'actor','uid').verify(ctx)).rejects.toThrow();
 }
});
it('rejects insecure issuers, missing secrets and actor mismatch before requests',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 for(const issuer of ['http://accounts.synthetic.invalid','https://user:pass@accounts.synthetic.invalid','https://accounts.synthetic.invalid?redirect=yes'])expect(()=>accountsRecordAuthority(issuer,secret,'actor','uid')).toThrow();
 expect(()=>accountsRecordAuthority('https://accounts.synthetic.invalid','','actor','uid')).toThrow();
 await expect(accountsRecordAuthority('https://accounts.synthetic.invalid',secret,'other','uid').verify(ctx)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
