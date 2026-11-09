/** Independent public native consumer; only synthetic files and Host identity scopes. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {identifier} from 'dsh-im-kit'
import {ImMediaRuntime,resolveImMedia} from 'dsh-media-kit/im'
import {NativeImMediaProvider} from 'dsh-media-kit/im-native'
import {Context} from '@deepseek-ai/cordis'
import NativeStore from '@deepseek-ai/dsh-attachment-local'
import {inspectOriginal,resolveInspection,mediaProvider,mediaSource} from 'dsh-media-kit'
import {saveNativeOriginal,resolveNativeStorage} from 'dsh-media-kit/dsh-attachments'
import {ScopedNativeMedia,resolveReferences,mediaScope} from 'dsh-media-kit/scoped-native'
const home=join(process.cwd(),'synthetic-attachments');await mkdir(home,{recursive:true});const ctx=new Context(),fiber=ctx.plugin(NativeStore,NativeStore.Config({dshHome:home}));await fiber.await()
const store=ctx.get('attachments'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1UAAAAASUVORK5CYII=','base64'),policy={maxBytes:1024,maxDetectorBuffer:1024,maxWidth:100,maxHeight:100,maxPixels:10000,allowedMimeTypes:['image/png']},storage=resolveNativeStorage({chunkBytes:16,maxReadBytes:1024,inspection:policy}),signal=new AbortController().signal
const original=await inspectOriginal(resolveInspection(policy),{bytes:png,fileName:'one.jpg',source:{provider:mediaProvider('fixture'),id:mediaSource('one'),kind:'fixture'}},signal),stored=await saveNativeOriginal(store,original,storage,signal),limits=resolveReferences({maxReferences:2,maxOriginalBytes:1024,maxLeases:2,maxConcurrentReads:1}),first=new ScopedNativeMedia(limits,store,storage),owner=mediaScope('owner'),ref=first.register(owner,stored),grant=JSON.parse(JSON.stringify(first.exportGrant(owner,ref)));await first.close()
const second=new ScopedNativeMedia(limits,store,storage);assert.equal(second.restore(owner,grant),ref);assert.throws(()=>second.acquire(mediaScope('other'),ref),error=>error.code==='not-found')
const lease=second.acquire(owner,ref);assert.deepEqual(Buffer.from((await lease.read(signal)).copyBytes()),png);await lease.release();await second.close()
const account={tenantId:identifier('im.tenant','fixture'),networkId:identifier('im.network','local'),accountId:identifier('im.account','self')},scope={account,kind:'group',peerId:identifier('im.peer','room-a')},retained=[]
const options={account,attachments:store,storage,references:limits,journal:{async append(grant){retained.push(structuredClone(grant))}},restoredGrants:[]},runtime=new ImMediaRuntime(resolveImMedia({maxProviders:1,maxPendingPerProvider:2}));runtime.register(new NativeImMediaProvider(options))
const attachment=await runtime.store(scope,original,signal);assert.deepEqual(Buffer.from((await runtime.read(scope,attachment,signal)).copyBytes()),png);await assert.rejects(runtime.read({...scope,kind:'private'},attachment,signal),error=>error.code==='not-found');await runtime.close()
const restored=new NativeImMediaProvider({...options,restoredGrants:JSON.parse(JSON.stringify(retained))});assert.deepEqual(Buffer.from((await restored.read(scope,attachment,signal)).copyBytes()),png);await restored.dispose();await fiber.dispose()
console.log(JSON.stringify({passed:true,nativeOriginalBytesVerified:true,scopeIsolation:true,grantRestore:true,imScopedOriginals:true,realQqMessagesSent:0}))
