import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLabelAutoLayout } from '../lib/label-layout-engine.ts';
import { initializeLabelRow } from '../lib/label-auto-layout.ts';
import { labelSetupCreateSchema, labelRowLayoutSchema } from '../lib/label-setup-contract.ts';
import { ROOT_FRAME, layoutChildren, wrapLayoutNodes, moveLayoutNodes, dissolveLayoutFrame, deleteLayoutNodes, duplicateLayoutNodes } from '../lib/label-layout-tree.ts';
const inner='dff001ba-2bcb-4893-b6d6-003ff4117211', outer='af04281b-21a0-4aa0-9aad-5db551c39719';
const base = () => initializeLabelRow({name:'Frames',widthMm:60,heightMm:24,elements:[
  {type:'name',x:5,y:5,width:30,height:20,rowWidthMm:18,rowHeightMm:4,visible:true},
  {type:'subtitle',x:5,y:30,width:30,height:20,rowWidthMm:18,rowHeightMm:4,visible:true},
  {type:'qr',x:75,y:5,width:20,height:50,rowWidthMm:12,rowHeightMm:12,visible:true},
]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const frame=(id,options={})=>({id,name:'Frame',direction:'row',gapMm:2,paddingMm:1,align:'start',...options});

test('Shift+A grouping can nest frames; dissolve restores children and preserves physical settings',()=>{
  let setup=base();
  setup=wrapLayoutNodes(setup,['name','subtitle'],inner,'Text',{
    name:{x:0,y:0,width:18,height:4},subtitle:{x:0,y:6,width:18,height:4},
  });
  assert.equal(setup.layout.groups[0].direction,'column');
  assert.equal(setup.layout.groups[0].gapMm,2);
  setup=wrapLayoutNodes(setup,[inner,'qr'],outer,'Container');
  assert.deepEqual(layoutChildren(setup).map(item=>item.id),[outer]);
  assert.equal(setup.layout.groups.find(f=>f.id===inner).parentId,outer);
  assert.equal(labelSetupCreateSchema.safeParse(setup).success,true);
  const result=computeLabelAutoLayout(setup,{widths:{name:18,subtitle:9}});
  near(result.elements.name.x,result.elements.subtitle.x);
  near(result.elements.subtitle.y-result.elements.name.y,6);
  assert.ok(result.elements.qr.x>result.elements.name.x);
  const dissolved=dissolveLayoutFrame(setup,outer);
  assert.equal(dissolved.layout.groups.length,1);
  assert.equal(dissolved.layout.groups[0].parentId,undefined);
  assert.deepEqual(dissolved.elements.map(e=>e.rowHeightMm),setup.elements.map(e=>e.rowHeightMm));
  assert.equal(labelSetupCreateSchema.safeParse(dissolved).success,true);
});

test('fill shares remaining main-axis space and fills the cross axis; content measurements drive hug',()=>{
  const setup=base();
  setup.layout={...setup.layout,widthSizing:'fixed',paddingLeftMm:2,paddingRightMm:2,paddingTopMm:2,paddingBottomMm:2};
  setup.elements=setup.elements.map(e=>e.type==='qr'?e:{...e,widthSizing:'fill',heightSizing:'fill'});
  const result=computeLabelAutoLayout(setup,{widths:{name:300,subtitle:300}});
  near(result.widthMm,60);
  near(result.elements.name.width,20); // (56 - 12 - 4) / 2
  near(result.elements.subtitle.width,20);
  near(result.elements.name.height,20);
  near(result.elements.qr.width,12);
  assert.equal(result.overflowY,false);
  assert.equal(result.overflowX,false);
});

test('fixed frames support nine-point alignment and auto gap independently of child sizes',()=>{
  const setup=base();
  setup.layout={...setup.layout,widthSizing:'fixed',mainAlign:'space-between',align:'bottom'};
  setup.elements=setup.elements.filter(e=>e.type!=='subtitle').map(e=>({...e,widthSizing:'fixed'}));
  const result=computeLabelAutoLayout(setup);
  near(result.elements.name.x,2);
  near(result.elements.qr.x,46);
  near(result.elements.name.y,20);
  near(result.elements.qr.y,12);
  setup.layout.mainAlign='center';
  const centered=computeLabelAutoLayout(setup);
  near(centered.elements.name.x,14);
});

test('horizontal and vertical wrap create rows or columns without changing physical child dimensions',()=>{
  const setup=base();
  setup.widthMm=28;
  setup.heightMm=32;
  setup.layout={...setup.layout,widthSizing:'fixed',wrap:true,crossGapMm:3,align:'top'};
  setup.elements=setup.elements.map(e=>({...e,widthSizing:'fixed',rowWidthMm:12,rowHeightMm:5}));
  const horizontal=computeLabelAutoLayout(setup);
  near(horizontal.elements.subtitle.y,8);
  near(horizontal.elements.qr.y,16);
  setup.layout.direction='column';
  setup.heightMm=12;
  const vertical=computeLabelAutoLayout(setup);
  near(vertical.elements.name.x,2);
  near(vertical.elements.subtitle.x,2);
  near(vertical.elements.qr.x,17);
  near(vertical.elements.qr.y,0);
});

test('nested asymmetric padding, hidden frames and absolute children do not corrupt hug bounds',()=>{
  const setup=base();
  setup.layout.groups=[frame(inner,{direction:'column',parentId:outer,paddingLeftMm:3,paddingRightMm:5,paddingTopMm:2,paddingBottomMm:4}),frame(outer,{paddingMm:0})];
  setup.elements=setup.elements.map(e=>e.type==='qr'?{...e,ignoreLayout:true}: {...e,groupId:inner});
  const result=computeLabelAutoLayout(setup,{widths:{name:18,subtitle:9}});
  near(result.frames[inner].width,26);
  near(result.frames[inner].height,16);
  near(result.widthMm,30);
  near(result.elements.qr.x,45);
  setup.layout.groups[1].visible=false;
  const hidden=computeLabelAutoLayout(setup);
  assert.equal(hidden.elements.name,undefined);
  near(hidden.widthMm,4);
});

test('nested text hug height participates in preview overflow checks',()=>{
  let setup=wrapLayoutNodes(base(),['name','subtitle'],inner,'Stack');
  setup.layout.groups[0].direction='column';
  setup.elements=setup.elements.map(e=>({...e,heightSizing:e.type==='qr'?'fixed':'hug'}));
  const good=computeLabelAutoLayout(setup,{heights:{name:7,subtitle:7}});
  assert.equal(good.overflowY,false);
  const bad=computeLabelAutoLayout(setup,{heights:{name:16,subtitle:16}});
  assert.equal(bad.overflowY,true);
});

test('tree moves reject ancestry cycles and schemas reject missing parents and ID collisions',()=>{
  let setup=wrapLayoutNodes(base(),['name','subtitle'],inner,'Inner');
  setup=wrapLayoutNodes(setup,[inner],outer,'Outer');
  assert.deepEqual(moveLayoutNodes(setup,[outer],inner,0),setup);
  assert.equal(labelRowLayoutSchema.safeParse({...setup.layout,groups:setup.layout.groups.map(f=>f.id===outer?{...f,parentId:inner}:f)}).success,false);
  assert.equal(labelRowLayoutSchema.safeParse({...setup.layout,groups:[frame(inner,{parentId:outer})]}).success,false);
  assert.equal(labelSetupCreateSchema.safeParse({...setup,elements:[{...setup.elements[0],id:inner}]}).success,false);
  const moved=moveLayoutNodes(setup,['qr'],inner,0);
  assert.equal(moved.elements.find(e=>e.type==='qr').groupId,inner);
  assert.deepEqual(layoutChildren(moved,inner).map(item=>item.id),['qr','name','subtitle']);
  assert.equal(labelSetupCreateSchema.safeParse(moved).success,true);
});

test('duplicating a frame copies its subtree once and deletion removes all descendants',()=>{
  let setup=wrapLayoutNodes(base(),['name','subtitle'],inner,'Inner');
  setup=wrapLayoutNodes(setup,[inner],outer,'Outer');
  let serial=1;
  const duplicated=duplicateLayoutNodes(setup,[outer,inner,'name'],()=>`00000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`);
  assert.equal(duplicated.ids.length,1);
  assert.equal(duplicated.setup.elements.length,5);
  assert.equal(duplicated.setup.layout.groups.length,4);
  assert.equal(labelSetupCreateSchema.safeParse(duplicated.setup).success,true);
  const deleted=deleteLayoutNodes(setup,[outer]);
  assert.equal(deleted.layout.groups.length,0);
  assert.deepEqual(deleted.elements.map(e=>e.type),['qr']);
  assert.equal(labelSetupCreateSchema.safeParse(deleted).success,true);
});

test('deep frame trees resolve with bounded work and round-trip without flattening',()=>{
  let setup=base();
  let id='name';
  for(let i=1;i<=20;i++){
    const parent=`00000000-0000-4000-9000-${String(i).padStart(12,'0')}`;
    setup=wrapLayoutNodes(setup,[id],parent,'Nested');
    id=parent;
  }
  const saved=labelSetupCreateSchema.parse(JSON.parse(JSON.stringify(setup)));
  const result=computeLabelAutoLayout(saved);
  assert.equal(Object.keys(result.frames).length,21);
  assert.equal(result.overflowY,false);
  assert.equal(layoutChildren(saved,ROOT_FRAME).filter(item=>item.frame).length,1);
});

test('absolute children use frame-relative coordinates and follow hidden parent visibility',()=>{
  const setup=base();
  setup.layout.groups=[frame(inner,{widthSizing:'fixed',heightSizing:'fixed',widthMm:25,heightMm:16})];
  setup.elements=setup.elements.map(e=>e.type==='name'?{...e,groupId:inner,ignoreLayout:true,x:5,y:5}:e);
  const result=computeLabelAutoLayout(setup);
  near(result.elements.name.x,result.frames[inner].x+3);
  near(result.elements.name.y,result.frames[inner].y+1.2);
  setup.layout.groups[0].visible=false;
  assert.equal(computeLabelAutoLayout(setup).elements.name,undefined);
});

test('Hug text is validated using rendered measurements rather than stale template height',()=>{
  const setup=base();
  setup.elements=setup.elements.map(e=>e.type==='name'?{...e,heightSizing:'hug',rowHeightMm:80}:e);
  assert.equal(labelSetupCreateSchema.safeParse(setup).success,true);
  assert.equal(computeLabelAutoLayout(setup,{heights:{name:3}}).overflowY,false);
  assert.equal(computeLabelAutoLayout(setup,{heights:{name:80}}).overflowY,true);
});
