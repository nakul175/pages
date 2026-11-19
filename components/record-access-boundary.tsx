"use client";
import {useEffect,useState} from 'react';
import RecordBrowser from './record-browser';
type Props={workspaceId:string;tenantId:string;initialCollection?:string;initialRecordId?:string};
export default function RecordAccessBoundary(props:Props){
 const scope=JSON.stringify([props.workspaceId,props.tenantId]);
 const [proof,setProof]=useState<{scope:string;revision:string}|null>(null);
 const [unavailable,setUnavailable]=useState(false);
 useEffect(()=>{
  let disposed=false,busy=false;let controller:AbortController|undefined;
  const check=async()=>{
   if(disposed||busy)return;busy=true;controller=new AbortController();
   const timeout=setTimeout(()=>controller?.abort(),3000);
   try{
    const r=await fetch(`/api/v1/workspaces/${encodeURIComponent(props.workspaceId)}/tenants/${encodeURIComponent(props.tenantId)}/record-access`,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
    if(!r.ok)throw Error();const value:unknown=await r.json();
    if(!value||typeof value!=='object'||!('revision' in value)||typeof value.revision!=='string'||!/^[a-f0-9]{64}$/.test(value.revision))throw Error();
    if(!disposed){setProof({scope,revision:value.revision});setUnavailable(false);}
   }catch{if(!disposed){setProof(null);setUnavailable(true);}}
   finally{clearTimeout(timeout);busy=false;}
  };
  void check();const timer=setInterval(()=>void check(),4000);
  const wake=()=>{if(document.visibilityState==='visible')void check();};
  window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
  return()=>{disposed=true;clearInterval(timer);controller?.abort();window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);};
 },[props.workspaceId,props.tenantId]);
 if(!proof||proof.scope!==scope)return <main className="shell"><p role="status">{unavailable?'Record access is unavailable. Checking again…':'Checking record access…'}</p></main>;
 // Remount discards cached records, field values, forms and late responses from the old tree.
 return <RecordBrowser key={proof.revision} {...props}/>;
}
