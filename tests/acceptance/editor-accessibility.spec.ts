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
  if(width<760)await page.getByRole('button',{name:'Open toolbox',exact:true}).click();
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
 if(width>600)expect(bounds.cardRight).toBeLessThan(bounds.railLeft);
 else expect(bounds.cardRight-bounds.cardLeft).toBeGreaterThanOrEqual(width-24);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('list picker saves a numbered list and page actions remain discoverable',async({page,request})=>{
 const created=await request.post(origin+'/api/pages',{headers:{Origin:origin},data:{title:'Disposable page actions fixture',spaceId:'space-product'}});
 expect(created.status()).toBe(200);const id=(await created.json()).page.id;
 await page.goto('/pages/'+id);
 const rail=page.getByRole('complementary',{name:'Editor toolbox',exact:true});
 await rail.getByRole('button',{name:'List',exact:true}).click();
 await expect(rail.getByRole('group',{name:'List styles'})).toBeVisible();
 await rail.getByRole('button',{name:'Numbered list',exact:true}).click();
 await expect(rail.getByRole('group',{name:'List styles'})).toHaveCount(0);
 await page.getByRole('textbox',{name:'Document content',exact:true}).type('Numbered fixture');
 await expect(page.getByRole('button',{name:'✓ Saved',exact:true})).toBeVisible();
 await expect.poll(async()=>JSON.stringify(await(await request.get(origin+'/api/v1/pages/'+id+'/document')).json())).toContain('orderedList');
 await expect(page.locator('.checklist-context-chip')).toHaveCount(0);
 await page.getByLabel('Page options',{exact:true}).click();
 const menu=page.locator('.page-tools-menu');
 await expect(menu.getByRole('button',{name:'My saved pages',exact:true})).toBeVisible();
 await expect(menu.getByRole('button',{name:'History',exact:true})).toBeHidden();
 await menu.getByRole('button',{name:'Governance',exact:true}).click();
 await expect(menu.getByRole('button',{name:'Change owner',exact:true})).toBeVisible();
 await expect(menu.getByRole('button',{name:'Review and publishing',exact:true})).toBeHidden();
 await menu.getByRole('button',{name:'Browse all page actions',exact:true}).click();
 await expect(menu.getByRole('button',{name:'Review and publishing',exact:true})).toBeVisible();
 await expect(menu.getByRole('button',{name:'History',exact:true})).toBeVisible();
 await menu.getByRole('button',{name:'Content',exact:true}).click();
 await menu.getByRole('textbox',{name:'Find page action',exact:true}).fill('Backlinks');
 await expect(menu.getByRole('button',{name:'Backlinks',exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('page-actions-and-numbered-list.png')});
});

test('sidebar page dialog stays readable and mobile insert tools leave document width',async({page,request})=>{
 const created=await request.post(origin+'/api/pages',{headers:{Origin:origin},data:{title:'Disposable dialog contrast fixture',spaceId:'space-product'}});
 expect(created.status()).toBe(200);const id=(await created.json()).page.id;
 await page.goto('/pages/'+id);
 await page.locator('.page-tree-add').first().click();
 const dialog=page.getByRole('dialog',{name:/New page in/});
 await expect(dialog).toBeVisible();
 await expect(dialog).toHaveCSS('color','rgb(27, 29, 53)');
 await expect(dialog).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(dialog.getByRole('heading',{name:/New page in/})).toHaveCSS('color','rgb(27, 29, 53)');
 await expect(dialog.getByRole('heading',{name:/New page in/})).toHaveCSS('font-size','18px');
 await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toHaveCSS('color','rgb(27, 29, 53)');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.reload();
 await expect(page.locator('.document>article')).toBeVisible();
 await expect(page.getByRole('button',{name:'Open toolbox',exact:true})).toBeVisible();
 const width=await page.locator('.document>article').evaluate(element=>element.getBoundingClientRect().width);
 expect(width).toBeGreaterThanOrEqual(350);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'Open toolbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'More blocks',exact:false})).toBeVisible();
});

test('mobile Search shows results before optional filters and aligns archived checkbox',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/search');
 await expect(page.getByRole('heading',{name:'Search',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Search titles and content'}).fill('fixture');
 const toggle=page.getByRole('button',{name:'Show filters',exact:true});
 await expect(toggle).toBeVisible();
 await expect(page.getByRole('listbox',{name:'Search results'})).toBeVisible();
 await toggle.click();
 const archived=page.getByRole('checkbox',{name:'Include archived',exact:true});
 await expect(archived).toBeVisible();
 const label=page.locator('.hs-search-filters label').filter({has:archived});
 const bounds=await label.evaluate(element=>{const input=element.querySelector('input')!.getBoundingClientRect(),text=element.getBoundingClientRect();return {inputTop:input.top,inputHeight:input.height,labelHeight:text.height};});
 expect(bounds.inputHeight).toBeLessThanOrEqual(20);
 expect(bounds.labelHeight).toBeLessThanOrEqual(48);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('template gallery titles remain visible on white cards',async({page})=>{
 await page.goto('/workspaces');
 await page.getByRole('button',{name:'From template',exact:true}).click();
 const card=page.locator('.template-cards button').first();
 await expect(card).toBeVisible();
 await expect(card).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(card).toHaveCSS('color','rgb(27, 29, 53)');
 await expect(card.locator('strong')).not.toBeEmpty();
});

test('space home creates a page in the current space',async({page,request})=>{
 const reply=await request.get('/api/spaces');expect(reply.status()).toBe(200);
 const space=(await reply.json()).spaces.find((item:{id:string})=>item.id==='space-product');expect(space).toBeTruthy();
 await page.goto(`/workspaces/${encodeURIComponent(space.workspaceId)}/spaces/${encodeURIComponent(space.id)}`);
 await page.getByText('Organize space',{exact:true}).click();
 await page.getByRole('button',{name:`Create a page in ${space.name}`,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Create a page',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog).toContainText(`In ${space.name}`);
 await expect(dialog.getByRole('combobox',{name:'Space',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
});

test('creating from a page is an explicit subpage with aligned navigation',async({page,request})=>{
  const parentTitle='Disposable parent '+crypto.randomUUID();
  const created=await request.post(origin+'/api/pages',{headers:{Origin:origin},data:{title:parentTitle,spaceId:'space-product'}});
  expect(created.status()).toBe(200);
  const parentId=(await created.json()).page.id;
  await page.goto('/pages/'+parentId);
  const rail=page.getByRole('complementary',{name:'Editor toolbox',exact:true});
  await rail.getByRole('button',{name:/Subpage/}).click();
  const dialog=page.getByRole('dialog',{name:'Create a subpage',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Inside');
  await expect(dialog).toContainText(parentTitle);
  await expect(dialog.getByLabel('Space',{exact:true})).toHaveCount(0);
  await expect(dialog.getByLabel('New space',{exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  const childTitle='Disposable child '+crypto.randomUUID();
  await dialog.getByRole('textbox',{name:'Subpage name'}).fill(childTitle);
  await dialog.getByRole('button',{name:'Create subpage',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toContainText(childTitle);
  const parent=page.getByRole('treeitem',{name:new RegExp(parentTitle)});
  const child=page.getByRole('treeitem',{name:new RegExp(childTitle)});
  await expect(parent).toBeVisible();
  await expect(child).toBeVisible();
  const positions=await page.evaluate(({parentId,childTitle})=>{
    const parent=document.getElementById(`page-tree-item-${parentId}`)!;
    const child=Array.from(document.querySelectorAll<HTMLElement>('.page-tree-row')).find(row=>row.textContent?.includes(childTitle))!;
    return {parent:parent.querySelector('.page-tree-open svg')!.getBoundingClientRect().left,child:child.querySelector('.page-tree-open svg')!.getBoundingClientRect().left};
  },{parentId,childTitle});
  expect(positions.child-positions.parent).toBe(14);
});
