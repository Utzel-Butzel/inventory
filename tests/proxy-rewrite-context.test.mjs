import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {AsyncLocalStorage} from 'node:async_hooks';
import {Readable} from 'node:stream';
import {getCloneableBody} from 'next/dist/server/body-streams.js';
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const {NextRequest} = await import('next/server.js');
const {default: nextTesting} = await import('next/experimental/testing/server.js');
// This installed Next build still exports the pre-rename testing helper.
const doesProxyMatch = nextTesting.unstable_doesProxyMatch ?? nextTesting.unstable_doesMiddlewareMatch;

const source=await readFile(new URL('../proxy.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
 .replaceAll('"next/server"',JSON.stringify(new URL('../node_modules/next/server.js',import.meta.url).href))
 .replaceAll('"./i18n.config"',JSON.stringify(new URL('../i18n.config.ts',import.meta.url).href))
 .replaceAll('"./lib/organization-path"',JSON.stringify(new URL('../lib/organization-path.ts',import.meta.url).href));
const {proxy,config}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));

test('large upload APIs bypass the body-truncating page proxy',()=>{
 for (const url of ['/api/v1/room-scans', '/api/v1/resources/123/media', '/api/v1/ai/count', '/_next/static/app.js']) {
  assert.equal(doesProxyMatch({config,nextConfig:{},url}),false,url);
 }
 for (const url of ['/video-demo/spaces', '/video-demo/inventory', '/apiary/inventory', '/login', '/']) {
  assert.equal(doesProxyMatch({config,nextConfig:{},url}),true,url);
 }
});

test('one room above 10 MB parses intact but fails after the default proxy buffer',async()=>{
 const form = new FormData();
 form.set('structureId', '11111111-1111-4111-8111-111111111111');
 form.set('model', new Blob([new Uint8Array(11 * 1024 * 1024)]), 'room.usdz');
 const encoded = new Response(form);
 const contentType = encoded.headers.get('content-type');
 const bytes = Buffer.from(await encoded.arrayBuffer());
 const parse = body => new Response(body, {headers:{'content-type':contentType}}).formData();
 const intact = await parse(bytes);
 assert.equal(intact.get('model').size, 11 * 1024 * 1024);
 const chunks = [];
 for(let offset=0;offset<bytes.length;offset+=65536) chunks.push(bytes.subarray(offset,offset+65536));
 const clone = getCloneableBody(Readable.from(chunks)).cloneBodyStream();
 const truncated = await new Promise((resolve,reject)=>{
  const received=[];
  clone.on('data',chunk=>received.push(chunk));
  clone.on('end',()=>resolve(Buffer.concat(received)));
  clone.on('error',reject);
 });
 await assert.rejects(parse(truncated), /multipart|formdata|parse/i);
});

test('a second proxy pass retains the canonical tenant path and search',()=>{
 const first=proxy(new NextRequest('http://localhost:3105/video-demo/inventory?q=Akku'));
 const headers=new Headers();
 for(const key of first.headers.get('x-middleware-override-headers').split(',')) headers.set(key,first.headers.get('x-middleware-request-'+key));
 const second=proxy(new NextRequest(first.headers.get('x-middleware-rewrite'),{headers}));
 assert.equal(second.headers.get('location'),null);
 assert.equal(second.headers.get('x-middleware-request-x-inventory-organization-route'),'video-demo');
 assert.equal(second.headers.get('x-middleware-request-x-inventory-original-path'),'/video-demo/inventory?q=Akku');
});
test('scoped public routes replace arbitrary incoming tenant headers',()=>{
 const result=proxy(new NextRequest('http://localhost:3105/video-demo/stock',{headers:{'x-inventory-organization-route':'different','x-inventory-original-path':'/different/settings'}}));
 assert.equal(result.headers.get('x-middleware-request-x-inventory-organization-route'),'video-demo');
 assert.equal(result.headers.get('x-middleware-request-x-inventory-original-path'),'/video-demo/stock');
});
test('public login never inherits an organization routing header',()=>{
 const result=proxy(new NextRequest('http://localhost:3105/login',{headers:{'x-inventory-organization-route':'video-demo'}}));
 assert.equal(result.headers.get('x-middleware-request-x-inventory-organization-route'),null);
 assert.equal(result.headers.get('location'),null);
});
