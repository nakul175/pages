"use client";
import {useEffect,useRef,useState} from "react";
import type {Page,Space} from "../lib/types";
import {Dialog} from "./editor/rich-editor";
import {ApiError,requestJson} from "./editor/use-document-session";

export default function CreatePage({spaces:allSpaces,parent,workspaceId,onClose,onCreated,onTemplates,onDirty,presentation='dialog',initialAsChild=false}:{onTemplates:()=>void;onDirty?:(dirty:boolean)=>void;presentation?:'dialog'|'inline';spaces:Space[];parent?:Page;workspaceId:string;onClose:()=>void;onCreated:(p:Page)=>void;initialAsChild?:boolean}){
  const spaces=allSpaces.filter(space=>space.workspaceId===workspaceId);
  const [name,setName]=useState(''),[spaceId,setSpaceId]=useState(parent?.spaceId??spaces[0]?.id??''),[newSpace,setNewSpace]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false),attempt=useRef<{title:string;parentPageId:string|null;destination:string;spaceBody:string|null;pageBody:string|null}|null>(null);
  const [unconfirmed,setUnconfirmed]=useState(false);
  useEffect(()=>{onDirty?.(!!name.trim()||!!newSpace.trim()||unconfirmed);},[name,newSpace,unconfirmed,onDirty]);
  function templates(){if(presentation==='dialog'&&(name.trim()||newSpace.trim())&&!confirm('Leave this new-page form? Its title has not been saved.'))return;onTemplates();}
  function close(){if(running.current)return;if(attempt.current&&!confirm('Page creation is unconfirmed. Close without retrying? Check your pages before creating another.'))return;onClose();}
  async function submit(e:React.FormEvent){
    e.preventDefault();if(running.current)return;running.current=true;setBusy(true);setError('');
    try{
      const retrying=!!attempt.current;
      if(!attempt.current)attempt.current={title:name,parentPageId:initialAsChild&&parent?parent.id:null,destination:spaceId,spaceBody:newSpace.trim()?JSON.stringify({name:newSpace,workspaceId,operationId:crypto.randomUUID()}):null,pageBody:null};
      const intent=attempt.current;
      if(intent.spaceBody){
        try{
          const d=await requestJson<{space:Space}>("/api/v1/space-creations",{method:'POST',headers:{'content-type':'application/json'},body:intent.spaceBody});
          intent.destination=d.space.id;intent.spaceBody=null;
        }catch(e){
          if(!retrying&&e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==408&&e.status!==429)attempt.current=null;
          throw e;
        }
      }
      intent.pageBody??=JSON.stringify({title:intent.title,spaceId:intent.destination,parentPageId:intent.parentPageId,operationId:crypto.randomUUID()});
      const d=await requestJson<{page:Page}>("/api/pages",{method:'POST',headers:{'content-type':'application/json'},body:intent.pageBody});
      attempt.current=null;setUnconfirmed(false);onCreated(d.page);
    }catch(e){setUnconfirmed(!!attempt.current);setError(attempt.current?'Creation is unconfirmed. Retry to confirm the same space and page.':e instanceof Error?e.message:'Page could not be created.');}
    finally{running.current=false;setBusy(false);}
  }
  const subpage=initialAsChild&&!!parent;
  const needsSpace=!spaces.length;
  const form=<>
    {!subpage&&<button type="button" disabled={busy||unconfirmed||!spaces.length} onClick={templates}>From template</button>}
    <form className="create-page-form" data-create-mode={subpage?'subpage':'page'} onSubmit={submit}>
      <fieldset style={{border:0,padding:0,margin:0,minWidth:0}} disabled={busy||unconfirmed}>
        <label>{subpage?'Subpage name':'Page name'}<input autoFocus maxLength={240} value={name} onChange={e=>setName(e.target.value)} placeholder="Untitled" required/></label>
        {subpage?<p className="create-page-location">Inside <strong>{parent.title}</strong> · {spaces.find(space=>space.id===parent.spaceId)?.name??'Current space'}</p>:<>
          {spaces.length>1&&<label>Space<select value={spaceId} onChange={e=>setSpaceId(e.target.value)}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          {spaces.length===1&&<p className="create-page-location">In {spaces[0].name}</p>}
          {needsSpace&&<label>New space<input maxLength={80} value={newSpace} onChange={e=>setNewSpace(e.target.value)} placeholder="e.g. Operations" required/></label>}
        </>}
      </fieldset>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="actions">{presentation==='dialog'&&<button type="button" onClick={close}>Cancel</button>}<button className="primary" disabled={busy||!name.trim()||(!spaceId&&!newSpace.trim())}>{busy?'Creating…':unconfirmed?'Retry confirmation':subpage?'Create subpage':'Create page'}</button></div>
    </form>
  </>;
  return presentation==='inline'?form:<Dialog title={subpage?'Create a subpage':'Create a page'} onClose={close}>{form}</Dialog>;
}
