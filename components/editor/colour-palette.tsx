'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import UiIcon from '../ui-icon';

/** Non-modal palette; editor selection remains in the editor state while focus moves here. */
export function ColourPalette({label,value,colours,names,highlight=false,onChange}:{label:string;value:string;colours:readonly string[];names:readonly string[];highlight?:boolean;onChange:(value:string)=>void}){
 const [position,setPosition]=useState<{top:number;left:number}|null>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId();
 const known=colours.includes(value),mixed=Boolean(value&&!known);
 const close=()=>{setPosition(null);trigger.current?.focus({preventScroll:true});};
 useEffect(()=>{
  if(!position)return;
  panel.current?.querySelector<HTMLButtonElement>('button[aria-pressed=true],button')?.focus();
  const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setPosition(null);};
  const resize=()=>setPosition(null);
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',resize);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize);};
 },[position]);
 return <>
  <button ref={trigger} type="button" className="palette-trigger" aria-label={label} title={`${label}${mixed?': mixed':''}`} aria-haspopup="dialog" aria-expanded={!!position} aria-controls={position?id:undefined} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(position){close();return;}const rect=trigger.current!.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-248)),top:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-210))});}}>
   <UiIcon name={highlight?'highlighter':'textColour'}/><span className="palette-indicator" style={{background:known?value:highlight?'#dda523':'currentColor'}}/><span className="palette-chevron" aria-hidden="true">⌄</span>
  </button>
  {position&&createPortal(<div ref={panel} id={id} className="editor-colour-palette" role="dialog" aria-label={label} style={position} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node)&&event.relatedTarget!==trigger.current)setPosition(null);}}>
   <div className="palette-heading"><strong>{label}</strong><button type="button" aria-label="Close palette" onClick={close}>×</button></div>
   {mixed&&<p className="palette-mixed">Mixed colours</p>}
   <div className="palette-swatches">{colours.map((colour,index)=><button key={colour} type="button" aria-label={names[index]} title={names[index]} aria-pressed={value===colour} onClick={()=>{onChange(colour);close();}}><span style={{background:colour}}/></button>)}</div>
   <button type="button" className="palette-reset" aria-pressed={!value} onClick={()=>{onChange('');close();}}>{highlight?'No highlight':'Automatic'}</button>
  </div>,document.body)}
 </>;
}
