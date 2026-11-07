import {test, expect} from './acceptance-fixtures';
import axe,{type AxeResults,type RunOptions} from 'axe-core';
const origin='http://127.0.0.1:53300';
for(const width of [1440,390,320])test(`editor WCAG text contrast and usable controls at ${width}px`,async({page,request})=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});
  const created=await request.post(origin+'/api/pages',{headers:{Origin:origin},data:{title:'Disposable accessibility fixture '+width,spaceId:'space-product'}});
  expect(created.status()).toBe(200);const id=(await created.json()).page.id;
  await page.goto('/pages/'+id);
  const content=page.getByRole('textbox',{name:'Document content',exact:true}),marker='Accessible saved fixture 👋 مرحبا '+width;
  await content.fill(marker);
  await expect.poll(async()=>JSON.stringify(await(await request.get(origin+'/api/v1/pages/'+id+'/document')).json())).toContain(marker);
  await expect(page.getByRole('button',{name:'✓ Saved',exact:true})).toBeVisible();
  await content.focus();await page.addScriptTag({content:axe.source});
  const result=await page.evaluate(async()=>{
    const engine=(window as unknown as {axe:{run:(context:Document,options:RunOptions)=>Promise<AxeResults>}}).axe;
    return engine.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});
  });
  await test.info().attach('axe-results',{body:JSON.stringify(result.violations,null,2),contentType:'application/json'});
  expect(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if(width<760){
    const undersized=await page.locator('.shell button,.shell summary,.shell select').evaluateAll(elements=>elements.flatMap(element=>{
      const rect=element.getBoundingClientRect(),closed=element.closest('details:not([open])');
      if(element.matches(':disabled')||!rect.width||!rect.height||getComputedStyle(element).visibility==='hidden'||(closed&&!closed.querySelector(':scope > summary')?.contains(element)))return [];
      return rect.width<44||rect.height<44?[{tag:element.tagName,label:element.getAttribute('aria-label')??element.textContent?.trim(),width:rect.width,height:rect.height}]:[];
    }));
    expect(undersized).toEqual([]);
  }
  await page.getByRole('button',{name:/More blocks/,exact:false}).click();
  await page.getByRole('button',{name:'Browse all blocks',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Insert a block',exact:true});
  await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox',{name:'Search block types',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading',{name:'Insert a block',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Browse all blocks',exact:true})).toBeFocused();
});

test('focused toolbars preserve selection through colour palettes and avoid duplicate controls',async({page,request})=>{
 await page.setViewportSize({width:1440,height:900});
 const created=await request.post(origin+'/api/pages',{headers:{Origin:origin},data:{title:'Disposable focused toolbox fixture',spaceId:'space-product'}});
 expect(created.status()).toBe(200);const id=(await created.json()).page.id;await page.goto('/pages/'+id);
 const editor=page.getByRole('textbox',{name:'Document content',exact:true});await editor.fill('Palette selection survives');await editor.press('ControlOrMeta+a');
 const top=page.getByRole('group',{name:'Top editor toolbox',exact:true}),rail=page.getByRole('complementary',{name:'Editor toolbox',exact:true});
 await expect(top.getByRole('button',{name:'Bold',exact:true})).toHaveCount(1);await expect(rail.getByRole('button',{name:'Bold',exact:true})).toHaveCount(0);
 await expect(top.getByRole('button',{name:'H1 Heading',exact:true})).toHaveCount(0);await expect(rail.getByRole('button',{name:'H1 Heading',exact:true})).toHaveCount(1);
 await top.getByRole('button',{name:'Text colour',exact:true}).click();
 const colour=page.getByRole('dialog',{name:'Text colour',exact:true});await expect(colour).toBeVisible();await colour.getByRole('button',{name:'Blue',exact:true}).click();await expect(colour).toHaveCount(0);
 await expect.poll(async()=>JSON.stringify(await(await request.get(origin+'/api/v1/pages/'+id+'/document')).json())).toContain('textStyle');
 await top.getByRole('button',{name:'Text highlight',exact:true}).click();const highlight=page.getByRole('dialog',{name:'Text highlight',exact:true});await highlight.getByRole('button',{name:'Amber',exact:true}).click();
 await expect(page.locator('.rich-prose mark')).toHaveText('Palette selection survives');
 await top.getByRole('button',{name:'Text colour',exact:true}).click();await page.keyboard.press('Escape');await expect(top.getByRole('button',{name:'Text colour',exact:true})).toBeFocused();await expect(colour).toHaveCount(0);
 const row=await top.locator('button').evaluateAll(elements=>elements.map(e=>Math.round(e.getBoundingClientRect().top)));expect(new Set(row).size).toBe(1);
 const column=await rail.locator('.toolbox-insert-grid button').evaluateAll(elements=>elements.map(e=>Math.round(e.getBoundingClientRect().left)));expect(new Set(column).size).toBe(1);
 await top.getByRole('button',{name:'Clear formatting',exact:true}).click();await expect(page.locator('.rich-prose mark')).toHaveCount(0);
});

for(const width of [320,800,1440,1920])test(`document aligns with formatting row at ${width}px`,async({page,request})=>{
 await page.setViewportSize({width,height:900});
 const created=await request.post(origin+'/api/pages',{headers:{Origin:origin},data:{title:'Disposable aligned document fixture',spaceId:'space-product'}});
 expect(created.status()).toBe(200);const id=(await created.json()).page.id;await page.goto('/pages/'+id);
 await expect(page.getByRole('group',{name:'Top editor toolbox',exact:true})).toBeVisible();
 const bounds=await page.locator('.document').evaluate(document=>{
  const card=document.querySelector('article')!.getBoundingClientRect(),toolbar=document.querySelector('.top-toolbox')!.getBoundingClientRect(),rail=document.querySelector('.insert-rail')!.getBoundingClientRect(),container=document.getBoundingClientRect();
  return {cardLeft:card.left,cardRight:card.right,toolbarLeft:toolbar.left,toolbarRight:toolbar.right,railLeft:rail.left,gap:card.left-container.left};
 });
 expect(Math.abs(bounds.cardLeft-bounds.toolbarLeft)).toBeLessThanOrEqual(1);
 expect(Math.abs(bounds.cardRight-bounds.toolbarRight)).toBeLessThanOrEqual(1);
 expect(bounds.gap).toBeLessThanOrEqual(22);
 expect(bounds.cardRight).toBeLessThan(bounds.railLeft);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
