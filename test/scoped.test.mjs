import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeStore from '@deepseek-ai/dsh-attachment-local'
import {inspectOriginal,resolveInspection,mediaProvider,mediaSource} from '../dist/index.js'
import {saveNativeOriginal,readNativeOriginal,resolveNativeStorage} from '../dist/dsh-attachments.js'
import {ScopedNativeMedia,resolveReferences,mediaScope,mediaReference} from '../dist/scoped-native.js'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1UAAAAASUVORK5CYII=','base64')
const inspection={maxBytes:1024*1024,maxDetectorBuffer:1024*1024,maxWidth:8192,maxHeight:8192,maxPixels:16777216,allowedMimeTypes:['image/png','text/html']},storage=resolveNativeStorage({chunkBytes:16,maxReadBytes:1024*1024,inspection}),a=mediaScope('tenant-a/account-a/group-a'),b=mediaScope('tenant-a/account-a/group-b'),signal=()=>new AbortController().signal
async function setup(t,options={}){
 const root=resolve('.test-artifacts');await mkdir(root,{recursive:true});const home=await mkdtemp(join(root,'scoped-')),ctx=new Context(),fiber=ctx.plugin(NativeStore,NativeStore.Config({dshHome:home}));await fiber.await();const store=ctx.get('attachments')
 const original=await inspectOriginal(resolveInspection(inspection),{bytes:png,fileName:'whale.jpg',source:{provider:mediaProvider('fictional-private-provider'),id:mediaSource('fictional-backend-id'),kind:'fixture'}},signal()),stored=await saveNativeOriginal(store,original,storage,signal())
 const limits=resolveReferences({maxReferences:4,maxOriginalBytes:1024*1024,maxLeases:4,maxConcurrentReads:4,...options}),book=new ScopedNativeMedia(limits,store,storage)
 t.after(async()=>{await book.close();await fiber.dispose()});return{book,stored,store,limits}
}
test('random scoped references expose metadata only to their authenticated conversation',async t=>{
 const {book,stored}=await setup(t),one=book.register(a,stored),two=book.register(a,stored)
 assert.notEqual(one,two);assert.equal(mediaReference(one),one);assert.notEqual(one,stored.descriptor.sha256)
 assert.throws(()=>book.describe(b,one),error=>error.code==='not-found');assert.throws(()=>book.describe(b,mediaReference('mr_'+'A'.repeat(43))),error=>error.code==='not-found')
 const view=book.describe(a,one);assert.equal(view.fileName,'whale.png');assert.equal(JSON.stringify(view).includes('fictional'),false);assert.equal('attachment' in view,false);assert.equal('source' in view,false)
})
test('capacity rejection never evicts another reference and repeated bytes count once',async t=>{
 const {book,stored}=await setup(t,{maxReferences:2,maxOriginalBytes:png.length}),one=book.register(a,stored),two=book.register(b,stored)
 assert.deepEqual(book.status(),{references:2,originals:1,originalBytes:png.length,leases:0,pendingReads:0,closed:false})
 assert.throws(()=>book.register(a,stored),error=>error.code==='capacity');assert.equal(book.describe(a,one).bytes,png.length);assert.equal(book.describe(b,two).bytes,png.length)
 book.revoke(a,one);assert.equal(book.status().originalBytes,png.length);book.revoke(b,two);assert.equal(book.status().originalBytes,0)
})
test('an active lease blocks revocation and releasing it does not delete native bytes',async t=>{
 const {book,stored,store}=await setup(t),ref=book.register(a,stored),lease=book.acquire(a,ref)
 assert.throws(()=>book.revoke(a,ref),error=>error.code==='busy');assert.deepEqual(Buffer.from((await lease.read(signal())).copyBytes()),png)
 await lease.release();await lease.release();assert.equal(book.status().leases,0);book.revoke(a,ref)
 assert.throws(()=>book.describe(a,ref),error=>error.code==='not-found');assert.deepEqual(Buffer.from((await readNativeOriginal(store,stored,storage,signal())).copyBytes()),png)
})
test('trusted owner-journal records restore the same handle without extra quota or file copies',async t=>{
 const {book,stored,store,limits}=await setup(t),ref=book.register(a,stored),saved=JSON.parse(JSON.stringify(book.exportGrant(a,ref)));await book.close()
 const next=new ScopedNativeMedia(limits,store,storage);t.after(()=>next.close());assert.throws(()=>next.restore(b,saved),error=>error.code==='not-found')
 assert.equal(next.restore(a,saved),ref);assert.equal(next.restore(a,Object.fromEntries(Object.entries(saved).reverse())),ref);assert.equal(next.status().references,1)
 const lease=next.acquire(a,ref);assert.deepEqual(Buffer.from((await lease.read(signal())).copyBytes()),png);await lease.release()
 const changed=structuredClone(saved);changed.stored.descriptor.fileName='different.png';assert.throws(()=>next.restore(a,changed),error=>error.code==='source-conflict');assert.equal(next.describe(a,ref).fileName,'whale.png')
})
test('lease capacity is released only after its reads stop and sibling leases remain usable',async t=>{
 const {stored,limits}=await setup(t);let entered,finish;const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{finish=resolve})
 const store={async saveFileStream(){throw Error('unused')},async *readFileStream(ref,signal){entered();await gate;signal.throwIfAborted();yield png}}
 const book=new ScopedNativeMedia(limits,store,storage);t.after(()=>book.close());const ref=book.register(a,stored),first=book.acquire(a,ref),second=book.acquire(a,ref),read=first.read(signal()),rejected=assert.rejects(read,error=>error.code==='cancelled');await started
 let released=false;const releasing=first.release().then(()=>{released=true});await Promise.resolve();assert.equal(released,false);assert.equal(book.status().leases,2);assert.equal(book.status().pendingReads,1)
 finish();await Promise.all([releasing,rejected]);assert.equal(book.status().leases,1);assert.deepEqual(Buffer.from((await second.read(signal())).copyBytes()),png);await second.release();assert.equal(book.status().pendingReads,0)
})
test('book close refuses new work immediately and joins active lease reads',async t=>{
 const {stored,limits}=await setup(t);let entered,finish;const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{finish=resolve})
 const store={async saveFileStream(){throw Error('unused')},async *readFileStream(ref,signal){entered();await gate;signal.throwIfAborted();yield png}},book=new ScopedNativeMedia(limits,store,storage),ref=book.register(a,stored),lease=book.acquire(a,ref),read=lease.read(signal()),rejected=assert.rejects(read,error=>error.code==='cancelled');await started
 let closed=false;const closing=book.close().then(()=>{closed=true});assert.throws(()=>book.acquire(a,ref),error=>error.code==='closed');await Promise.resolve();assert.equal(closed,false)
 finish();await Promise.all([closing,rejected]);assert.deepEqual(book.status(),{references:0,originals:0,originalBytes:0,leases:0,pendingReads:0,closed:true})
})
test('lease limits and malformed capacities fail without evicting source grants',async t=>{
 const {book,stored}=await setup(t,{maxLeases:1}),ref=book.register(a,stored),lease=book.acquire(a,ref)
 assert.throws(()=>book.acquire(a,ref),error=>error.code==='capacity');assert.equal(book.status().references,1);await lease.release()
 assert.throws(()=>resolveReferences({maxReferences:0,maxOriginalBytes:1,maxLeases:1}),error=>error.code==='invalid-data');assert.throws(()=>mediaReference('guessed'),error=>error.code==='invalid-data')
})

test('global read admission caps simultaneous exports even when they share one lease',async t=>{
 const {stored,limits}=await setup(t,{maxConcurrentReads:1});let entered,finish,calls=0;const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{finish=resolve})
 const store={async saveFileStream(){throw Error('unused')},async *readFileStream(ref,signal){calls++;entered();await gate;signal.throwIfAborted();yield png}},book=new ScopedNativeMedia(limits,store,storage);t.after(()=>book.close());const ref=book.register(a,stored),lease=book.acquire(a,ref),first=lease.read(signal());await started
 await assert.rejects(lease.read(signal()),error=>error.code==='capacity');assert.equal(calls,1);assert.equal(book.status().pendingReads,1)
 finish();await first;assert.equal(book.status().pendingReads,0);await lease.release()
})
