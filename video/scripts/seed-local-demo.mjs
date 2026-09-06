// Adds an isolated local video demo. Never targets the public demo or remote DBs.
import env from '@next/env';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as demo from '../../scripts/demo-seed-manifest.mjs';

const root = resolve(import.meta.dirname, '../..');
env.loadEnvConfig(root);
const database = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) throw new Error('Local database required');
const base = process.env.VIDEO_APP_URL || 'http://127.0.0.1:3105';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Local app required');
const out = resolve(root, 'output/playwright/product-video');
await mkdir(out, { recursive: true });
const remap = value => typeof value === 'string' ? value.replace(/^d3e00000-/, '71de0000-') : value;
const org = remap(demo.DEMO_ORGANIZATION.id), user = remap(demo.DEMO_USER.id);
const actor = 'product-video-demo', slug = 'video-demo';
const email = 'video-demo@inventory.local';
let password;
try { password = JSON.parse(await readFile(resolve(out, 'credentials.json'), 'utf8')).password; }
catch { password = randomUUID() + randomUUID(); }
const sql = postgres(database.toString(), {max: 1});
const days = n => new Date(Date.now() - n * 86400000);
const snake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const fields = (obj, keys) => Object.fromEntries(keys.split(' ').map(k => [snake(k), remap(obj[k])]));
try {
  await sql.begin(async tx => {
    const [existing] = await tx`SELECT id, created_by FROM organizations WHERE id=${org} OR slug=${slug}`;
    if (existing && (existing.id !== org || existing.created_by !== actor)) throw new Error('Demo identity collision');
    if (existing) return;
    const add = (table, row) => tx`INSERT INTO ${tx(table)} ${tx({organization_id: org, ...row})}`;
    await tx`INSERT INTO organizations(id,name,slug,created_by) VALUES(${org},'Werkstatt Nord',${slug},${actor})`;
    for (const role of demo.DEMO_ROLES) await add('access_roles', {...fields(role,'key name description permissions'), is_system:true});
    for (const type of demo.DEMO_INVENTORY_TYPES) await add('inventory_type_definitions', {...fields(type,'key label description color icon canContain spatialContainment position'), is_system:true});
    for (const type of demo.DEMO_RELATION_TYPES) await add('relation_type_definitions', {...fields(type,'key label inverseLabel description allowManual spatial position'), is_system:true});
    await add('translation_languages',{code:'de',label:'Deutsch',is_default:true});
    await tx`INSERT INTO users(id,email,name,password_hash,role,created_by) VALUES(${user},${email},'Werkstatt Team',${await bcrypt.hash(password,10)},'admin',${actor})`;
    await add('organization_memberships',{user_id:user,role_key:'admin'});
    for (const r of demo.DEMO_RESOURCES) await add('resources', {
      ...fields(r,'id name description type status sku quantity location barcode valueCents priority tags notes'),
      categories:tx.json(r.categories),custom_fields:tx.json(r.customFields),created_by:actor,updated_at:days(r.updatedDaysAgo),
    });
    await tx`DELETE FROM stock_movements WHERE organization_id=${org} AND type='opening_balance' AND created_by=${actor}`;
    for (const r of demo.DEMO_STOCK_SETTINGS) {
      const row = fields(r,'resourceId trackingMode minimumStock reorderQuantity leadTimeDays unitName');
      await tx`INSERT INTO stock_settings ${tx({organization_id:org,...row})} ON CONFLICT(resource_id) DO UPDATE SET ${tx(row)}`;
    }
    for (const r of demo.DEMO_LOCATION_BALANCES) await add('stock_location_balances',fields(r,'id resourceId locationResourceId quantity'));
    for (const r of demo.DEMO_STOCK_UNITS) await add('stock_units', {...fields(r,'id resourceId code status location locationResourceId'),metadata:tx.json(r.metadata),acquired_at:days(60),last_moved_at:days(2)});
    for (const r of demo.DEMO_STOCK_MOVEMENTS) await add('stock_movements', {...fields(r,'id resourceId unitId delta quantity balanceAfter type reason note location fromLocationResourceId toLocationResourceId'),occurred_at:days(r.daysAgo),created_by:actor});
    for (const r of demo.DEMO_ASSIGNMENTS) await add('inventory_assignments', {...fields(r,'id resourceId stockUnitId kind status quantity assigneeLabel note'),starts_at:days(r.startsDaysAgo),due_at:days(-r.dueDaysFromNow),created_by:actor});
    for (const r of demo.DEMO_PURCHASE_ORDERS) await add('orders',{...fields(r,'id reference status note'),type:'purchase',contact_name:r.supplier,ordered_at:days(r.orderedDaysAgo),expected_at:days(-r.expectedDaysFromNow),response:tx.json({}),created_by:actor});
    for (const r of demo.DEMO_PURCHASE_ORDER_LINES) await add('order_lines',{...fields(r,'id resourceId note'),order_id:remap(r.purchaseOrderId),quantity:r.orderedQuantity,fulfilled_quantity:r.receivedQuantity,expected_at:days(-r.expectedDaysFromNow)});
    for (const r of demo.DEMO_RELATIONS) await add('resource_relations',{...fields(r,'id sourceResourceId targetResourceId relationTypeKey'),origin:'manual',created_by:actor});
    await add('label_setups',{...fields(demo.DEMO_LABEL_SETUP,'id name widthMm heightMm'),elements:tx.json(demo.DEMO_LABEL_SETUP.elements),revision:1,created_by:actor});
  });
  await writeFile(resolve(out,'credentials.json'), JSON.stringify({email,password}),{mode:0o600});
  const jar = new Map();
  const request = async (path, options={}) => {
    const r = await fetch(base+path,{...options,redirect:'manual',headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...options.headers}});
    for(const line of r.headers.getSetCookie()){const pair=line.split(';')[0],pos=pair.indexOf('=');jar.set(pair.slice(0,pos),pair.slice(pos+1));}
    return r;
  };
  const csrf = await (await request('/api/auth/csrf')).json();
  await request('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({email,password,csrfToken:csrf.csrfToken,callbackUrl:base+'/'+slug+'/inventory'})});
  const session=await (await request('/api/auth/session')).json();
  if(session.user?.email!==email) throw new Error('Demo login failed');
  const cookies=[...jar].map(([name,value])=>({name,value,domain:new URL(base).hostname,path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}));
  await writeFile(resolve(out,'state.json'),JSON.stringify({cookies,origins:[]}),{mode:0o600});
  console.log('Local video demo ready: '+base+'/'+slug+'/inventory');
  console.log('8 resources, stock history, one loan, one order and a label layout. Browser state saved in ignored output directory.');
} finally { await sql.end(); }
