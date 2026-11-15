import test from 'node:test';
import assert from 'node:assert/strict';
import {spoolOperationSchema,spoolSnapshotSchema} from '../lib/spool-queue-contract.ts';
const printerId='12345678-1234-4234-8234-123456789abc',refs=['a'.repeat(64)];
test('legacy snapshots have cancellation only; new capabilities are explicit',()=>{
 assert.equal(spoolSnapshotSchema.parse({supported:true,jobs:[]}).actions,undefined);
 assert.equal(spoolSnapshotSchema.safeParse({supported:true,jobs:[],actions:['shell']}).success,false);
});
test('job actions require opaque identities; service repair cannot target job IDs',()=>{
 for(const action of ['cancel','pause','resume','restart']){
  assert.equal(spoolOperationSchema.safeParse({printerId,refs,action}).success,true);
  assert.equal(spoolOperationSchema.safeParse({printerId,refs:[],action}).success,false);
 }
 assert.equal(spoolOperationSchema.parse({printerId,refs}).action,'cancel');
 assert.equal(spoolOperationSchema.safeParse({printerId,refs:[],action:'repair'}).success,true);
 assert.equal(spoolOperationSchema.safeParse({printerId,refs,action:'repair'}).success,false);
 assert.equal(spoolOperationSchema.safeParse({printerId,refs,action:'shell',command:'anything'}).success,false);
});
