import env from '@next/env';
import postgres from 'postgres';
import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');env.loadEnvConfig(root);
const db=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1','[::1]'].includes(db.hostname)) throw new Error('Local database required');
const source=await readFile(resolve(root,'app/share/lighting-preview/preview-client.tsx'),'utf8');
const constants=source.slice(source.indexOf('const identity'),source.indexOf('export function LightingPreview'));
const code=ts.transpileModule(constants+'\nexport default manifest;',{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {default:manifest}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const scene=manifest.scan.scene;
await writeFile(resolve(root,'video/public/demo-room.json'),JSON.stringify(scene,null,2));
const org='71de0000-0000-4000-8000-000000000001',room='71de0000-0000-4000-8000-000000000900',scan='71de0000-0000-4000-8000-000000000901';
const sql=postgres(db.toString(),{max:1});
try{await sql.begin(async tx=>{
 const [o]=await tx`SELECT created_by FROM organizations WHERE id=${org}`;if(o?.created_by!=='product-video-demo')throw new Error('Video demo required');
 await tx`INSERT INTO resources(organization_id,id,name,description,type,status,quantity,location,created_by) VALUES(${org},${room},'Studio Nord','Möblierter Demoraum für die räumliche Inventaransicht.','place','available',1,'Werkstatt Nord','product-video-demo') ON CONFLICT(id) DO NOTHING`;
 await tx`INSERT INTO room_scans(organization_id,id,room_resource_id,revision,scene,captured_at,device_model,created_by) VALUES(${org},${scan},${room},1,${tx.json(scene)},now(),'Synthetischer Demoraum','product-video-demo') ON CONFLICT(id) DO NOTHING`;
 for(const [suffix,x,y,z] of [[201,-.25,.85,-.15],[202,2.25,1.85,-1.85]]) {
  const resource='71de0000-0000-4000-8000-'+String(suffix).padStart(12,'0');
  await tx`INSERT INTO resource_spatial_placements(organization_id,resource_id,room_scan_id,position_x,position_y,position_z,confidence,method,captured_at,updated_by) VALUES(${org},${resource},${scan},${x},${y},${z},1,'manual',now(),'product-video-demo') ON CONFLICT(resource_id) DO NOTHING`;
 }
});console.log('Furnished demo room added: /video-demo/spaces');}finally{await sql.end();}
