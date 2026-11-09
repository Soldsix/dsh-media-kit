/** Account-scoped IM media retains exact originals through the actual native attachment provider. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,open,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeStore from '@deepseek-ai/dsh-attachment-local'
import sharp from 'sharp'
import gifenc from 'gifenc'
import {identifier} from 'dsh-im-kit'
import {inspectOriginal,resolveInspection,mediaProvider,mediaSource} from '../dist/index.js'
import {resolveNativeStorage} from '../dist/dsh-attachments.js'
import {resolveReferences} from '../dist/scoped-native.js'
import {ImMediaRuntime,resolveImMedia} from '../dist/im.js'
import {NativeImMediaProvider} from '../dist/im-native.js'
const id=(kind,value)=>identifier(kind,value),account=(label='a')=>({tenantId:id('im.tenant','fixture-tenant'),networkId:id('im.network','fixture-network'),accountId:id('im.account',label)}),scope=(peer='room',kind='group',owner=account())=>({account:owner,peerId:id('im.peer',peer),kind}),signal=()=>new AbortController().signal
const inspection={maxBytes:1024*1024,maxDetectorBuffer:1024*1024,maxWidth:8192,maxHeight:8192,maxPixels:32_000_000,allowedMimeTypes:['image/png','image/gif','audio/wav','text/html','text/plain']},storage=resolveNativeStorage({chunkBytes:16384,maxReadBytes:1024*1024,inspection}),references=resolveReferences({maxReferences:64,maxOriginalBytes:32*1024*1024,maxLeases:16,maxConcurrentReads:16})
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1UAAAAASUVORK5CYII=','base64')
async function original(bytes=png,name='fixture.png'){return inspectOriginal(resolveInspection(inspection),{bytes,fileName:name,source:{provider:mediaProvider('im-fixture'),id:mediaSource(name.replaceAll('.','-')),kind:'fixture'}},signal())}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
async function setup(t){const parent=resolve('.test-artifacts','im-native');await mkdir(parent,{recursive:true});const home=await mkdtemp(join(parent,'case-')),ctx=new Context(),fiber=ctx.plugin(NativeStore,NativeStore.Config({dshHome:home}));await fiber.await();t.after(()=>fiber.dispose());return{home,attachments:ctx.get('attachments')}}
function options(attachments,patch={}){return{account:account(),attachments,storage,references,journal:{async append(){}},restoredGrants:[],...patch}}
test('native IM media preserves 1080p, 2K and 4K originals across multiple conversations and journal restore',async t=>{
 const {home,attachments}=await setup(t),grants={a:[],b:[]},files={a:join(home,'grants-a.jsonl'),b:join(home,'grants-b.jsonl')}
 const tails={a:Promise.resolve(),b:Promise.resolve()},journal=key=>({append(grant,abort){const task=tails[key].then(async()=>{abort.throwIfAborted();const file=await open(files[key],'a');try{await file.writeFile(JSON.stringify(grant)+'\n');await file.sync()}finally{await file.close()}grants[key].push(structuredClone(grant))});tails[key]=task.catch(()=>{});return task}})
 const runtime=new ImMediaRuntime(resolveImMedia({maxProviders:2,maxPendingPerProvider:16}));t.after(()=>runtime.close())
 for(const key of ['a','b'])runtime.register(new NativeImMediaProvider(options(attachments,{account:account(key),journal:journal(key)})))
 const dimensions=[[1920,1080],[2560,1440],[3840,2160]],inputs=[]
 for(const [index,[width,height]] of dimensions.entries()){const bytes=await sharp({create:{width,height,channels:4,background:{r:42,g:97,b:173,alpha:1}}}).png().toBuffer();inputs.push(await original(bytes,'original-'+index+'.png'))}
 const destinations=[scope('same'),scope('different'),scope('same','private'),scope('same','group',account('b'))]
 const stored=await Promise.all(destinations.map(async(destination,index)=>({destination,input:inputs[index%3],reference:await runtime.store(destination,inputs[index%3],signal())})))
 for(const record of stored){const found=await runtime.read(record.destination,record.reference,signal());assert.deepEqual(found.copyBytes(),record.input.copyBytes());assert.deepEqual(found.descriptor.image,record.input.descriptor.image);assert.equal(found.descriptor.sha256,record.input.descriptor.sha256)}
 for(const record of stored.slice(1))await assert.rejects(runtime.read(stored[0].destination,record.reference,signal()),error=>error.code==='not-found')
 await runtime.close();const reopened=new ImMediaRuntime(resolveImMedia({maxProviders:2,maxPendingPerProvider:16}));t.after(()=>reopened.close())
 for(const key of ['a','b']){const retained=(await readFile(files[key],'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(retained,grants[key]);reopened.register(new NativeImMediaProvider(options(attachments,{account:account(key),journal:journal(key),restoredGrants:[...retained].reverse()})))}
 for(const record of stored)assert.deepEqual((await reopened.read(record.destination,record.reference,signal())).copyBytes(),record.input.copyBytes())
})
test('native providers reject foreign restored grants and direct foreign account access',async t=>{
 const {attachments}=await setup(t),retained=[];const provider=new NativeImMediaProvider(options(attachments,{journal:{async append(value){retained.push(structuredClone(value))}}}));t.after(()=>provider.dispose())
 const reference=await provider.store(scope(),await original(),signal());await assert.rejects(provider.read(scope('room','group',account('b')),reference,signal()),error=>error.code==='not-found');await assert.rejects(provider.store(scope('room','group',account('b')),await original(),signal()),error=>error.code==='not-found')
 for(const restored of [{}, {scope:'not-json'}, {...retained[0],scope:JSON.stringify(['foreign','fixture-network','a','group','room'])},{...retained[0],scope:JSON.stringify(['fixture-tenant','fixture-network','a','group','room'],null,2)},{...retained[0],scope:JSON.stringify(['fixture-tenant','fixture-network','a','group','\n'])}])assert.throws(()=>new NativeImMediaProvider(options(attachments,{restoredGrants:[restored]})),error=>error.code==='invalid-data')
 assert.throws(()=>new NativeImMediaProvider(options(attachments,{account:account('b'),restoredGrants:retained})),error=>error.code==='invalid-data')
})
test('failed journal retention never exposes a handle or automatically retries',async t=>{
 const {attachments}=await setup(t);let appends=0;const provider=new NativeImMediaProvider(options(attachments,{journal:{async append(){appends++;throw Error('private-journal-path')}}}));t.after(()=>provider.dispose())
 await assert.rejects(provider.store(scope(),await original(),signal()),error=>error.code==='storage-unavailable'&&!error.message.includes('private'))
 assert.equal(appends,1);assert.equal(provider.status().references,1);assert.equal(provider.status().pending,0)
})
test('late cancellation suppresses a retained handle and disposal waits for journal settlement',async t=>{
 const {attachments}=await setup(t),entered=deferred(),finish=deferred(),retained=[];const provider=new NativeImMediaProvider(options(attachments,{journal:{async append(value){entered.resolve();await finish.promise;retained.push(structuredClone(value))}}}));const caller=new AbortController()
 const pending=provider.store(scope(),await original(),caller.signal),rejected=assert.rejects(pending,error=>error.code==='cancelled');await entered.promise;caller.abort();let disposed=false;const closing=provider.dispose();void closing.then(()=>{disposed=true});assert.equal(closing,provider.dispose());assert.equal(disposed,false)
 await assert.rejects(provider.read(scope(),id('im.attachment','unknown'),signal()),error=>error.code==='closed');finish.resolve();await rejected;await closing;assert.equal(retained.length,1);assert.equal(provider.status().pending,0);assert.equal(provider.status().closed,true)
})
test('provider disposal cancels and joins a delayed native read while other accounts keep working',async t=>{
 const {attachments}=await setup(t),retained=[];const source=new NativeImMediaProvider(options(attachments,{journal:{async append(value){retained.push(value)}}}));const reference=await source.store(scope(),await original(),signal());await source.dispose()
 const entered=deferred(),finish=deferred(),delayed={saveFileStream:attachments.saveFileStream.bind(attachments),async *readFileStream(_ref,_abort){entered.resolve();await finish.promise;yield png}}
 const a=new NativeImMediaProvider(options(delayed,{restoredGrants:retained})),b=new NativeImMediaProvider(options(attachments,{account:account('b')}));t.after(()=>b.dispose())
 const read=a.read(scope(),reference,signal()),rejected=assert.rejects(read,error=>error.code==='cancelled');await entered.promise;const closing=a.dispose();assert.equal(a.status().pending,1);const sibling=await b.store(scope('room','group',account('b')),await original(),signal());assert.ok(sibling.startsWith('mr_'));finish.resolve();await rejected;await closing;assert.equal(a.status().leases,0)
})
test('already cancelled native operations perform no journal or storage work',async()=>{
 let calls=0;const provider=new NativeImMediaProvider(options({async saveFileStream(){calls++;throw Error('not expected')},async *readFileStream(){calls++;throw Error('not expected')}})),cancelled=new AbortController();cancelled.abort()
 await assert.rejects(provider.store(scope(),await original(),cancelled.signal),error=>error.code==='cancelled');await assert.rejects(provider.read(scope(),id('im.attachment','unknown'),cancelled.signal),error=>error.code==='cancelled');assert.equal(calls,0);await provider.dispose()
})

test('native IM media retains complete animated GIF, WAV and HTML file bytes',async t=>{
 const {attachments}=await setup(t),provider=new NativeImMediaProvider(options(attachments));t.after(()=>provider.dispose());const gif=gifenc.GIFEncoder(),palette=[[255,0,0],[0,0,255]]
 gif.writeFrame(new Uint8Array(64).fill(0),8,8,{palette,delay:100,repeat:0});gif.writeFrame(new Uint8Array(64).fill(1),8,8,{palette,delay:100});gif.finish()
 const wav=Buffer.alloc(52);wav.write('RIFF',0);wav.writeUInt32LE(44,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8,40)
 const html=await inspectOriginal(resolveInspection(inspection),{bytes:Buffer.from('<!doctype html><title>synthetic fixture</title><p>original file</p>'),fileName:'animation.html',textMime:'text/html',source:{provider:mediaProvider('im-fixture'),id:mediaSource('html-file'),kind:'fixture'}},signal())
 for(const input of [await original(gif.bytes(),'animated.gif'),await original(wav,'voice.wav'),html]){const reference=await provider.store(scope(),input,signal()),restored=await provider.read(scope(),reference,signal());assert.deepEqual(restored.copyBytes(),input.copyBytes());assert.equal(restored.descriptor.mime,input.descriptor.mime);if(restored.descriptor.mime==='image/gif')assert.equal((await sharp(restored.copyBytes(),{animated:true}).metadata()).pages,2)}
})
