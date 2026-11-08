import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeStore from '@deepseek-ai/dsh-attachment-local'
import sharp from 'sharp'
import gifenc from 'gifenc'
const {GIFEncoder}=gifenc
import {inspectOriginal,resolveInspection,mediaProvider,mediaSource} from '../dist/index.js'
import {saveNativeOriginal,readNativeOriginal,resolveNativeStorage} from '../dist/dsh-attachments.js'
const inspection={maxBytes:2*1024*1024,maxDetectorBuffer:2*1024*1024,maxWidth:8192,maxHeight:8192,maxPixels:16777216,allowedMimeTypes:['image/png','image/gif']},policy=resolveNativeStorage({chunkBytes:65536,maxReadBytes:2*1024*1024,inspection}),signal=()=>new AbortController().signal,source={provider:mediaProvider('fixture'),id:mediaSource('generated-asset'),kind:'fixture'}
async function setup(t){const root=resolve('.test-artifacts');await mkdir(root,{recursive:true});const home=await mkdtemp(join(root,'resolution-')),ctx=new Context(),fiber=ctx.plugin(NativeStore,NativeStore.Config({dshHome:home}));await fiber.await();t.after(()=>fiber.dispose());return ctx.get('attachments')}
test('1080p, 2K and 4K originals keep exact encoded bytes and dimensions through native storage',async t=>{
 const store=await setup(t)
 for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]]){
  const bytes=await sharp({create:{width,height,channels:4,background:{r:1,g:100,b:200,alpha:1}}}).png().toBuffer(),original=await inspectOriginal(resolveInspection(inspection),{bytes,fileName:'source.jpg',source},signal()),stored=await saveNativeOriginal(store,original,policy,signal()),restored=await readNativeOriginal(store,stored,policy,signal())
  assert.deepEqual(restored.descriptor.image,{width,height});assert.deepEqual(Buffer.from(restored.copyBytes()),bytes);assert.equal(restored.descriptor.sha256,original.descriptor.sha256)
 }
})
test('a generated two-frame GIF retains both frames byte-for-byte without conversion',async t=>{
 const store=await setup(t),gif=GIFEncoder(),palette=[[255,0,0],[0,0,255]]
 gif.writeFrame(new Uint8Array(64).fill(0),8,8,{palette,delay:100,repeat:0});gif.writeFrame(new Uint8Array(64).fill(1),8,8,{palette,delay:100});gif.finish()
 const bytes=gif.bytes(),original=await inspectOriginal(resolveInspection(inspection),{bytes,fileName:'animation.jpg',source},signal()),stored=await saveNativeOriginal(store,original,policy,signal()),restored=await readNativeOriginal(store,stored,policy,signal())
 assert.equal(restored.descriptor.mime,'image/gif');assert.deepEqual(Buffer.from(restored.copyBytes()),Buffer.from(bytes));assert.equal((await sharp(restored.copyBytes(),{animated:true}).metadata()).pages,2)
})
