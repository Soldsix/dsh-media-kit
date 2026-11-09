import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,chmod} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeStore from '@deepseek-ai/dsh-attachment-local'
import {AttachmentError} from '@deepseek-ai/dsh-attachment'
import {inspectOriginal,createUnclassifiedOriginal,resolveInspection,mediaProvider,mediaSource} from '../dist/index.js'
import {saveNativeOriginal,readNativeOriginal,parseNativeOriginal,resolveNativeStorage} from '../dist/dsh-attachments.js'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1UAAAAASUVORK5CYII=','base64')
const inspection={maxBytes:1024*1024,maxDetectorBuffer:1024*1024,maxWidth:8192,maxHeight:8192,maxPixels:16777216,allowedMimeTypes:['image/png','text/plain','text/html','application/json']}
const policy=()=>resolveNativeStorage({chunkBytes:16,maxReadBytes:1024*1024,inspection})
const signal=()=>new AbortController().signal
const original=name=>inspectOriginal(resolveInspection(inspection),{bytes:png,fileName:name,source:{provider:mediaProvider('fixture'),id:mediaSource('original'),kind:'fixture'}},signal())
async function mount(home){const ctx=new Context(),fiber=ctx.plugin(NativeStore,NativeStore.Config({dshHome:home}));await fiber.await();return{store:ctx.get('attachments'),close:()=>fiber.dispose()}}
async function setup(t){const root=resolve('.test-artifacts');await mkdir(root,{recursive:true});const home=await mkdtemp(join(root,'attachments-')),mounted=await mount(home);t.after(()=>mounted.close());return{home,...mounted}}
test('real native attachment storage preserves exact bytes across close and reopen',async t=>{
 const {home,store,close}=await setup(t),input=await original('selfie.jpg'),stored=await saveNativeOriginal(store,input,policy(),signal())
 assert.equal(stored.attachment.attachmentId,'sha256:'+input.descriptor.sha256);assert.equal(stored.attachment.name,'original.png');assert.equal(stored.descriptor.fileName,'selfie.png')
 await close();const reopened=await mount(home);t.after(()=>reopened.close())
 const parsed=parseNativeOriginal(JSON.parse(JSON.stringify(stored))),restored=await readNativeOriginal(reopened.store,parsed,policy(),signal())
 assert.deepEqual(Buffer.from(restored.copyBytes()),png);assert.deepEqual(restored.descriptor,input.descriptor)
})
test('different display names use the same content-addressed native object',async t=>{
 const {store}=await setup(t),a=await saveNativeOriginal(store,await original('first.jpg'),policy(),signal()),b=await saveNativeOriginal(store,await original('second.webp'),policy(),signal())
 assert.deepEqual(a.attachment,b.attachment);assert.notEqual(a.descriptor.fileName,b.descriptor.fileName)
})
test('bounded streamed exports refuse corrupt bytes and preserve the authoritative receipt',async t=>{
 const {home,store}=await setup(t),stored=await saveNativeOriginal(store,await original('source.png'),policy(),signal()),path=await import('node:fs/promises').then(fs=>fs.realpath(store.fileHostPath({...stored.attachment}))),owned=relative(home,path)
 assert.ok(!owned.startsWith('..')&&!isAbsolute(owned));const before=await readFile(path),altered=Buffer.from(before);altered[altered.length-1]^=1;await chmod(path,0o600);await writeFile(path,altered);await chmod(path,0o400)
 await assert.rejects(readNativeOriginal(store,stored,policy(),signal()),error=>error.code==='integrity-failed')
 assert.equal(stored.descriptor.byteLength,png.length)
})
test('durable receipts validate format, content identity and byte counts before use',async t=>{
 const {store}=await setup(t),stored=await saveNativeOriginal(store,await original('one.png'),policy(),signal()),raw=JSON.parse(JSON.stringify(stored))
 assert.throws(()=>parseNativeOriginal({...raw,format:'future-v99'}),error=>error.code==='invalid-data')
 assert.throws(()=>parseNativeOriginal({...raw,attachment:{...raw.attachment,bytes:raw.attachment.bytes+1}}),error=>error.code==='integrity-failed')
 assert.throws(()=>parseNativeOriginal({...raw,attachment:{...raw.attachment,name:'../private'}}),error=>error.code==='invalid-data')
 assert.equal(Object.isFrozen(parseNativeOriginal(raw).attachment),true)
})
test('metadata is checked against the restored content instead of trusting edited image dimensions',async t=>{
 const {store}=await setup(t),stored=await saveNativeOriginal(store,await original('one.png'),policy(),signal()),raw=JSON.parse(JSON.stringify(stored));raw.descriptor.image.width=2
 const parsed=parseNativeOriginal(raw);await assert.rejects(readNativeOriginal(store,parsed,policy(),signal()),error=>error.code==='integrity-failed')
})
test('unsupported providers and arbitrary failures expose only stable operational codes',async()=>{
 const input=await original('one.png'),unsupported={async saveFileStream(){throw new AttachmentError('synthetic private location','ATTACHMENT_FILES_UNSUPPORTED')},async *readFileStream(){throw Error('synthetic private location')}}
 await assert.rejects(saveNativeOriginal(unsupported,input,policy(),signal()),error=>error.code==='storage-unsupported'&&!error.message.includes('private'))
 const failed={...unsupported,async saveFileStream(){throw Error('synthetic-private-value')}}
 await assert.rejects(saveNativeOriginal(failed,input,policy(),signal()),error=>error.code==='storage-unavailable'&&!error.message.includes('private'))
})
test('cancellation before a native write starts never invokes the provider',async()=>{
 let calls=0;const cancelled=new AbortController();cancelled.abort()
 const store={async saveFileStream(){calls++;throw Error('must not be called')},async *readFileStream(){calls++;throw Error('must not be called')}}
 await assert.rejects(saveNativeOriginal(store,await original('one.png'),policy(),cancelled.signal),error=>error.code==='cancelled');assert.equal(calls,0)
})
test('storage budgets reject impossible relationships at configuration time',()=>{
 assert.throws(()=>resolveNativeStorage({chunkBytes:2048,maxReadBytes:1024,inspection:{...inspection,maxBytes:512,maxDetectorBuffer:512}}),error=>error.code==='invalid-data')
 assert.throws(()=>resolveNativeStorage({chunkBytes:16,maxReadBytes:1024,inspection}),error=>error.code==='invalid-data')
})

test('explicit unclassified originals preserve unknown codecs without claiming recognized media',async t=>{
 const {store}=await setup(t),rawPolicy={...inspection,allowedMimeTypes:['application/octet-stream']},spec=resolveNativeStorage({chunkBytes:16,maxReadBytes:1024*1024,inspection:rawPolicy}),bytes=new Uint8Array([0x02,0x23,0x21,0x53,0x49,0x4c,0x4b,0x5f,0x56,0x33,0x00,0xff])
 const original=await createUnclassifiedOriginal(resolveInspection(rawPolicy),{bytes,fileName:'unknown-codec.silk',source:{provider:mediaProvider('fixture'),id:mediaSource('opaque'),kind:'fixture'}},signal()),stored=await saveNativeOriginal(store,original,spec,signal()),restored=await readNativeOriginal(store,parseNativeOriginal(JSON.parse(JSON.stringify(stored))),spec,signal())
 assert.equal(restored.descriptor.detectedBy,'unclassified');assert.equal(restored.descriptor.mime,'application/octet-stream');assert.equal(restored.descriptor.fileName,'unknown-codec.silk');assert.equal(restored.descriptor.image,undefined);assert.deepEqual(restored.copyBytes(),bytes)
 const raw=JSON.parse(JSON.stringify(stored))
 for(const patch of [{mime:'image/png'},{extension:'silk'},{image:{width:1,height:1}}])assert.throws(()=>parseNativeOriginal({...raw,descriptor:{...raw.descriptor,...patch}}),error=>error.code==='invalid-data')
 const copy=original.copyBytes();copy[0]^=1;assert.deepEqual(original.copyBytes(),bytes)
 await assert.rejects(createUnclassifiedOriginal(resolveInspection(inspection),{bytes,source:original.descriptor.source},signal()),error=>error.code==='unsupported-type')
})
