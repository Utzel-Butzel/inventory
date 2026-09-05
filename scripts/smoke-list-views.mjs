import postgres from "postgres";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
const database = new URL(process.env.DATABASE_URL ?? "postgresql://inventory:inventory@localhost:5432/inventory");
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const local = (hostname) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
if (!local(database.hostname) || !local(new URL(base).hostname)) throw new Error("List-view smoke tests require a local database and local app.");
const sql = postgres(database.toString(), { max: 1, connect_timeout: 5 });
const organizations = [randomUUID(), randomUUID()], users = [randomUUID(), randomUUID()];
let f;
async function login(email) {
 const jar=new Map();
 const request=async(path,options={})=>{
   const response=await fetch(base+path,{...options,redirect:"manual",headers:{Cookie:[...jar].map(([k,v])=>k+"="+v).join("; "),...options.headers}});
   for(const line of response.headers.getSetCookie()) {const pair=line.split(";")[0], pos=pair.indexOf("=");jar.set(pair.slice(0,pos),pair.slice(pos+1));}
   return response;
 };
 const csrf=await (await request("/api/auth/csrf")).json();
 const response=await request("/api/auth/callback/credentials",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","X-Auth-Return-Redirect":"1"},body:new URLSearchParams({email,password:f.password,csrfToken:csrf.csrfToken,callbackUrl:base+"/inventory"})});
 assert.ok(response.ok || response.status===302);
 const session=await (await request("/api/auth/session")).json();assert.equal(session.user.email,email);
 return request;
}

try {

   const suffix=randomUUID().slice(0,8), password=randomUUID()+"!";
   const emails=["list-qa-a-"+suffix+"@example.test","list-qa-b-"+suffix+"@example.test"];
   const source="00000000-0000-4000-8000-000000000001";
   await sql.begin(async tx => {
     for (let i=0;i<organizations.length;i++) {
       await tx.unsafe("INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)",[organizations[i],"Listen QA "+(i+1),"list-qa-"+suffix+"-"+i]);
       await tx.unsafe("INSERT INTO access_roles(organization_id,key,name,permissions,is_system) SELECT $1,key,name,permissions,is_system FROM access_roles WHERE organization_id=$2",[organizations[i],source]);
     }
     for (let i=0;i<users.length;i++) {
       await tx.unsafe("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,'admin')",[users[i],emails[i],"Listen QA "+(i+1),await bcrypt.hash(password,10)]);
       for (const org of organizations) await tx.unsafe("INSERT INTO organization_memberships(organization_id,user_id,role_key) VALUES($1,$2,'admin')",[org,users[i]]);
     }
     await tx.unsafe("INSERT INTO inventory_type_definitions(organization_id,key,label) VALUES($1,\x27tool\x27,\x27Werkzeuge\x27),($1,\x27object\x27,\x27Objekte\x27)",[organizations[0]]);
     for (let i=1;i<=61;i++) await tx.unsafe("INSERT INTO resources(organization_id,name,sku,type,status,quantity,priority,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[organizations[0],"Werkzeug "+String(i).padStart(2,"0"),"QA-"+i,i%2?"tool":"object",i%3?"available":"maintenance",62-i,1+i%5,i%2?"Werkstatt":"Lager"]);
   });

 f={organizations,users,emails,password};
const a=await login(f.emails[0]),b=await login(f.emails[1]);
async function api(request,path,org=f.organizations[0],body) {
 const response=await request(path,{method:body?"PUT":"GET",headers:{"X-Organization-ID":org,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json()};
}
const path="/api/v1/user/list-views?scope=qa.integration";
assert.equal((await fetch(base+path)).status,401);
let original=await api(a,path);assert.equal(original.status,200);
const id=randomUUID();
const config={query:"Werkzeug",filters:{status:"maintenance"},sort:"quantity",direction:"asc",layout:"table",density:"compact",pageSize:50,columns:["name","sku"]};
const collection={views:[{id,name:"API QA",config}],defaultId:id};
let saved=await api(a,"/api/v1/user/list-views",f.organizations[0],{scope:"qa.integration",revision:original.body.revision,collection});
assert.equal(saved.status,200);assert.deepEqual((await api(a,path)).body.collection,collection);
assert.deepEqual((await api(b,path)).body.collection.views,[]);
assert.deepEqual((await api(a,path,f.organizations[1])).body.collection.views,[]);
assert.equal((await api(a,"/api/v1/user/list-views",f.organizations[0],{scope:"qa.integration",revision:original.body.revision,collection})).status,409);
assert.equal((await api(a,"/api/v1/user/list-views",f.organizations[0],{scope:"qa.integration",revision:saved.body.revision,collection:{...collection,defaultId:randomUUID()}})).status,422);
const page1=await api(a,"/api/v1/resources?sort=quantity&direction=asc&page=1&pageSize=50&media=cover");
const page2=await api(a,"/api/v1/resources?sort=quantity&direction=asc&page=2&pageSize=50&media=cover");
assert.equal(page1.status,200);assert.equal(page2.status,200);
assert.equal(page1.body.pagination.total,61);assert.equal(page1.body.resources[0].quantity,1);assert.equal(page1.body.resources.at(-1).quantity,50);
assert.equal(page2.body.resources[0].quantity,51);assert.equal(page2.body.resources.at(-1).quantity,61);
assert.equal(new Set([...page1.body.resources,...page2.body.resources].map(x=>x.id)).size,61);
const filtered=await api(a,"/api/v1/resources?type=tool&status=maintenance&priority=4&sort=name&direction=asc");
assert.equal(filtered.status,200);assert.ok(filtered.body.resources.length>0);assert.ok(filtered.body.resources.every(x=>x.type==="tool" && x.status==="maintenance" && x.priority===4));
assert.equal((await api(a,"/api/v1/resources?sort=__proto__")).status,200);
const renamed={views:[{id,name:"Renamed API QA",config:{...config,query:"new"}}],defaultId:id};
saved=await api(a,"/api/v1/user/list-views",f.organizations[0],{scope:"qa.integration",revision:saved.body.revision,collection:renamed});assert.equal(saved.status,200);
assert.deepEqual((await api(a,path)).body.collection,renamed);
saved=await api(a,"/api/v1/user/list-views",f.organizations[0],{scope:"qa.integration",revision:saved.body.revision,collection:{views:[],defaultId:null}});assert.equal(saved.status,200);
await sql.unsafe("UPDATE organizations SET is_read_only=true WHERE id=$1",[organizations[1]]);
const readonly=await api(a,path,organizations[1]);
assert.equal(readonly.body.canSave,false);
assert.equal((await api(a,"/api/v1/user/list-views",organizations[1],{scope:"qa.integration",revision:0,collection})).status,403);
console.log("PASS: session authentication; saved-view CRUD and defaults; user and organization isolation; concurrent-save conflict; invalid input; global sorting across two pages; combined filters; unknown sort fallback.");

} finally {
  try {
    for (const id of users) await sql.unsafe("DELETE FROM users WHERE id=$1", [id]);
    for (const id of organizations) await sql.unsafe("DELETE FROM organizations WHERE id=$1", [id]);
  } finally { await sql.end(); }
}
