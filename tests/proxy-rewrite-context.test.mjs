import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {NextRequest} from 'next/server.js';

const source=await readFile(new URL('../proxy.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
 .replaceAll('"next/server"',JSON.stringify(new URL('../node_modules/next/server.js',import.meta.url).href))
 .replaceAll('"./i18n.config"',JSON.stringify(new URL('../i18n.config.ts',import.meta.url).href))
 .replaceAll('"./lib/organization-path"',JSON.stringify(new URL('../lib/organization-path.ts',import.meta.url).href));
const {proxy}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));

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
