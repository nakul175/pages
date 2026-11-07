"use client";
import {useCallback,useEffect,useState,type FormEvent} from "react";
import {Dialog} from "./editor/dialog";
import {requestJson} from "./editor/use-document-session";
import {type PageTreeSlice} from "../lib/page-tree-model";

export default function PageSubpages({workspaceId,spaceId,pageId,parentId,editable,onOpen}:{workspaceId:string;spaceId:string;pageId:string;parentId:string|null;editable:boolean;onOpen:(id:string)=>void}){
 const [slice,setSlice]=useState<PageTreeSlice|null>(null),[creating,setCreating]=useState(false),[title,setTitle]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const load=useCallback(async()=>{
  const query=new URLSearchParams({spaceId,parentId:pageId});
  const endpoint=`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/page-tree`;
  const first=await requestJson<PageTreeSlice>(`${endpoint}?${query}`);
  const nodes=[...first.nodes];
  let cursor=first.nextCursor;
  while(cursor){query.set('cursor',cursor);const next=await requestJson<PageTreeSlice>(`${endpoint}?${query}`);nodes.push(...next.nodes);if(next.nextCursor===cursor)break;cursor=next.nextCursor;}
  setSlice({...first,nodes,nextCursor:null});
 },[workspaceId,spaceId,pageId]);
 useEffect(()=>{let live=true;void load().catch(()=>{if(live)setSlice(null)});return()=>{live=false};},[load]);
 useEffect(()=>{const refresh=()=>{void load().catch(()=>undefined)};window.addEventListener('pages:tree-changed',refresh);return()=>window.removeEventListener('pages:tree-changed',refresh);},[load]);
 async function create(event:FormEvent){event.preventDefault();if(!title.trim()||busy)return;setBusy(true);setError("");try{const result=await requestJson<{page:{id:string}}>("/api/pages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:title.trim(),spaceId,parentPageId:pageId,operationId:crypto.randomUUID()})});setCreating(false);setTitle("");await load();onOpen(result.page.id);}catch(reason){setError(reason instanceof Error?reason.message:"Could not create the subpage.");}finally{setBusy(false);}}
 if(parentId||!slice)return null;
 return <section className="page-subpages" aria-label="Subpages"><div className="page-subpages-heading"><h2>Subpages</h2>{editable&&<button type="button" onClick={()=>setCreating(true)}>+ Add subpage</button>}</div>{slice.nodes.length?<ul>{slice.nodes.map(node=><li key={node.id}><button type="button" onClick={()=>onOpen(node.id)}>{node.title} <span aria-hidden="true">→</span></button></li>)}</ul>:<p>No subpages yet.</p>}{creating&&<Dialog title="New subpage" onClose={()=>setCreating(false)}><form className="page-tree-create" onSubmit={event=>void create(event)}><label>Page name<input autoFocus required maxLength={240} value={title} onChange={event=>setTitle(event.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="actions"><button type="button" onClick={()=>setCreating(false)}>Cancel</button><button type="submit" disabled={busy||!title.trim()}>Create subpage</button></div></form></Dialog>}</section>;
}
