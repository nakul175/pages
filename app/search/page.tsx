import SearchScreen from '../../components/search-screen';
export default async function Page({searchParams}:{searchParams:Promise<{workspaceId?:string;q?:string}>}){
 const {workspaceId,q}=await searchParams;
 return <SearchScreen initialWorkspaceId={typeof workspaceId==='string'?workspaceId:''} initialQuery={typeof q==='string'?q.slice(0,512):''}/>;
}
