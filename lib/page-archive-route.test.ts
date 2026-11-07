import {beforeAll,afterAll,afterEach,expect,it,vi} from 'vitest';
import {createDatabase,type Database} from './database';
import {localActor} from './auth';

const mocks=vi.hoisted(()=>({repository:vi.fn()}));
vi.mock('./repository',async original=>({...await original<typeof import('./repository')>(),repository:mocks.repository}));
import {Repository} from './repository';
import {GET,POST} from '../app/api/v1/workspaces/[id]/page-archive/route';

let db:Database,r:Repository;
const workspaceId='ws-aplyd';
const context={params:Promise.resolve({id:workspaceId})};
const url=`http://localhost/api/v1/workspaces/${workspaceId}/page-archive`;
const mutate=(pageId:string,action:'preview'|'archive'|'restore')=>POST(new Request(url,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({pageId,action})}),context);

beforeAll(async()=>{vi.stubEnv('NODE_ENV','test');vi.stubEnv('HS_LOCAL_PREVIEW','1');db=await createDatabase(':memory:');r=new Repository(db);await r.seedLocal();mocks.repository.mockResolvedValue(r);});
afterAll(async()=>{await db.close();vi.unstubAllEnvs();});
afterEach(()=>vi.clearAllMocks());

it('archives a page branch, removes it from navigation, and restores it',async()=>{
 const root=await r.create(localActor,'Archive test root','space-product');
 const child=await r.create(localActor,'Archive test child','space-product',root.id);
 const before=(await db.query<{tree_version:number}>('SELECT tree_version FROM hs_workspaces WHERE id=$1',[workspaceId])).rows[0].tree_version;
 const preview=await mutate(root.id,'preview');expect(preview.status).toBe(200);expect(await preview.json()).toMatchObject({count:2,archived:false});
 expect((await mutate(root.id,'archive')).status).toBe(200);
 expect((await db.query<{tree_version:number}>('SELECT tree_version FROM hs_workspaces WHERE id=$1',[workspaceId])).rows[0].tree_version).toBe(before+1);
 expect((await r.list(localActor)).map(page=>page.id)).not.toContain(root.id);
 expect((await r.list(localActor)).map(page=>page.id)).not.toContain(child.id);
 const archived=await GET(new Request(url),context);expect(archived.status).toBe(200);expect((await archived.json()).pages).toEqual(expect.arrayContaining([expect.objectContaining({id:root.id})]));
 expect((await mutate(root.id,'restore')).status).toBe(200);
 expect((await r.list(localActor)).map(page=>page.id)).toEqual(expect.arrayContaining([root.id,child.id]));
});

it('refuses to archive a space home page',async()=>{
 const page=await r.create(localActor,'Protected space home','space-product');
 await db.query('UPDATE hs_spaces SET home_page_id=$2 WHERE id=$1',['space-product',page.id]);
 try{const response=await mutate(page.id,'archive');expect(response.status).toBe(422);expect((await response.json()).code).toBe('space_home');expect((await r.list(localActor)).map(item=>item.id)).toContain(page.id);}
 finally{await db.query('UPDATE hs_spaces SET home_page_id=NULL WHERE id=$1',['space-product']);}
});

it('preserves a separately archived child when its parent is restored',async()=>{
 const root=await r.create(localActor,'Independent archive parent','space-product');
 const child=await r.create(localActor,'Independent archive child','space-product',root.id);
 expect((await mutate(child.id,'archive')).status).toBe(200);
 expect((await mutate(root.id,'archive')).status).toBe(200);
 expect((await mutate(root.id,'restore')).status).toBe(200);
 const rows=(await db.query<{id:string;archived_at:string|null}>('SELECT id,archived_at FROM hs_pages WHERE id=ANY($1::text[])',[[root.id,child.id]])).rows;
 expect(rows.find(item=>item.id===root.id)?.archived_at).toBeNull();
 expect(rows.find(item=>item.id===child.id)?.archived_at).not.toBeNull();
});
