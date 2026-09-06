import env from '@next/env';
import postgres from 'postgres';
import sharp from 'sharp';
import { mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
env.loadEnvConfig(root);
const db=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1','[::1]'].includes(db.hostname)) throw new Error('Local database required');
if(process.env.STORAGE_PROVIDER && process.env.STORAGE_PROVIDER!=='local') throw new Error('Local storage required');
const dir=resolve(process.env.STORAGE_LOCAL_PATH || resolve(root,'data/uploads'),'product-video-demo');
await mkdir(dir,{recursive:true});
const org='71de0000-0000-4000-8000-000000000001';
const sql=postgres(db.toString(),{max:1});
try{
 const [organization]=await sql`SELECT created_by FROM organizations WHERE id=${org}`;
 if(organization?.created_by!=='product-video-demo') throw new Error('Video demo required');
 for(const name of ['drill','electronics','storage']) await copyFile(resolve(root,'video/public/photos/'+name+'.png'),resolve(dir,name+'.png'));
 const assets=[[101,'storage'],[102,'electronics'],[103,'storage'],[201,'drill'],[202,'electronics'],[203,'electronics'],[204,'storage'],[205,'storage']];
 for(const [suffix,name] of assets){
   const id='71de0000-0000-4000-8000-'+String(suffix).padStart(12,'0');
   const mediaId='71de0000-0000-4000-8000-'+String(1000+suffix).padStart(12,'0');
   const file=resolve(dir,name+'.png');
   const {width,height}=await sharp(file).metadata();const {size}=await stat(file);
   const key='product-video-demo/'+name+'.png';
   await sql`INSERT INTO media(organization_id,id,resource_id,storage_key,url,name,mime_type,kind,size,width,height,position,alt_text,source)
    VALUES(${org},${mediaId},${id},${key},${'/api/files/'+key},${name+'.png'},'image/png','image',${size},${width},${height},0,'KI-generiertes Kontextfoto für die Produktdemo','ai-generated') ON CONFLICT(id) DO NOTHING`;
 }
 console.log('Three generated photos attached to the eight isolated local demo records.');
}finally{await sql.end();}
