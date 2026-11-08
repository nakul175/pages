// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createElement,act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import Boundary from '../components/record-access-boundary';
vi.mock('../components/record-browser',()=>({default:function Child(){const [cached]=useState(()=>Math.random());return createElement('div',{'data-cache':cached},'Protected record');}}));
let root:Root,host:HTMLDivElement;const fetcher=vi.fn();
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',fetcher);host=document.createElement('div');document.body.append(host);root=createRoot(host);fetcher.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const response=(revision='a'.repeat(64))=>({ok:true,json:async()=>({revision})});
const render=async()=>act(async()=>root.render(createElement(Boundary,{workspaceId:'ws',tenantId:'tenant'})));
const tick=async()=>act(async()=>vi.advanceTimersByTimeAsync(4000));
it('preserves unchanged drafts, remounts cached content on grant/downgrade and removes content on unavailable proof',async()=>{
 fetcher.mockResolvedValue(response());await render();const first=host.querySelector('[data-cache]')!;
 await tick();expect(host.querySelector('[data-cache]')).toBe(first);
 fetcher.mockResolvedValue(response('b'.repeat(64)));await tick();expect(host.querySelector('[data-cache]')).not.toBe(first);
 fetcher.mockResolvedValue({ok:false});await tick();expect(host.textContent).not.toContain('Protected record');
 fetcher.mockResolvedValue(response('c'.repeat(64)));await tick();expect(host.textContent).toContain('Protected record');
});
it('rejects malformed revisions and cancels stalled checks without overlapping requests',async()=>{
 fetcher.mockResolvedValue({ok:true,json:async()=>({revision:'invalid'})});await render();expect(host.textContent).not.toContain('Protected record');
 fetcher.mockImplementation((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
 await tick();const count=fetcher.mock.calls.length;await act(async()=>window.dispatchEvent(new Event('focus')));expect(fetcher).toHaveBeenCalledTimes(count);
 await act(async()=>vi.advanceTimersByTimeAsync(3000));expect(host.textContent).toContain('unavailable');
});
it('ignores late replies after unmount and stops timers',async()=>{
 let reply:(v:unknown)=>void=()=>{};fetcher.mockImplementation(()=>new Promise(resolve=>{reply=resolve;}));await render();
 await act(async()=>root.render(null));await act(async()=>reply(response()));await tick();expect(host.textContent).toBe('');expect(fetcher).toHaveBeenCalledTimes(1);
});

it('clears the previous workspace immediately while the next scope is unverified',async()=>{
 fetcher.mockResolvedValue(response());await render();expect(host.textContent).toContain('Protected record');
 fetcher.mockImplementation(()=>new Promise(()=>{}));
 await act(async()=>root.render(createElement(Boundary,{workspaceId:'other',tenantId:'other-tenant'})));
 expect(host.textContent).not.toContain('Protected record');
});
