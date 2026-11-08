import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {inspectOriginal,resolveInspection,mediaProvider,mediaSource} from '../dist/index.js'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1UAAAAASUVORK5CYII=','base64')
const config=extra=>({maxBytes:1024*1024,maxDetectorBuffer:1024*1024,maxWidth:8192,maxHeight:8192,maxPixels:16777216,allowedMimeTypes:['image/png','image/gif','audio/wav','text/plain','text/html','application/json'],...extra})
const source=()=>({provider:mediaProvider('fixture'),id:mediaSource('pixel-one'),kind:'fixture'})
const signal=()=>new AbortController().signal
const inspect=(input,extra={})=>inspectOriginal(resolveInspection(config(extra)),{bytes:png,source:source(),...input},signal())
test('actual signature corrects a wrong suffix while every original byte and hash remain unchanged',async()=>{
 const original=await inspect({fileName:'selfie.jpg'}),meta=original.descriptor
 assert.equal(meta.mime,'image/png');assert.equal(meta.extension,'png');assert.equal(meta.fileName,'selfie.png');assert.equal(meta.detectedBy,'signature')
 assert.deepEqual(meta.image,{width:1,height:1});assert.equal(meta.byteLength,png.length);assert.equal(meta.sha256,createHash('sha256').update(png).digest('hex'));assert.deepEqual(Buffer.from(original.copyBytes()),png)
})
test('input and exported byte mutations cannot change the owned original or frozen metadata',async()=>{
 const bytes=new Uint8Array(png),origin=source(),task=inspectOriginal(resolveInspection(config()),{bytes,source:origin},signal());bytes[0]=0;origin.id=mediaSource('changed')
 const original=await task,first=original.copyBytes();first[0]=0;assert.deepEqual(Buffer.from(original.copyBytes()),png);assert.equal(original.descriptor.source.id,'pixel-one');assert.equal(Object.isFrozen(original.descriptor),true);assert.equal(Object.isFrozen(original.descriptor.source),true)
 assert.deepEqual(Object.keys(original),['descriptor'])
})
test('a declared text label cannot override a detected binary signature',async()=>{
 const original=await inspect({textMime:'text/html',fileName:'page.html'});assert.equal(original.descriptor.mime,'image/png');assert.equal(original.descriptor.fileName,'page.png')
})
test('accepted text files retain exact UTF-8 bytes and are identified as declared text',async()=>{
 const bytes=Buffer.from('<!doctype html>\n<title>鲸鲸</title>\n<script>let x=1</script>\n'),original=await inspect({bytes,textMime:'text/html',fileName:'animation.txt'})
 assert.equal(original.descriptor.detectedBy,'declared-text');assert.equal(original.descriptor.fileName,'animation.html');assert.deepEqual(Buffer.from(original.copyBytes()),bytes)
})
test('unknown bytes are never promoted to an image by their filename or declared text type',async()=>{
 await assert.rejects(inspect({bytes:Buffer.from('not an image'),fileName:'photo.png'}),error=>error.code==='unsupported-type')
 await assert.rejects(inspect({bytes:new Uint8Array([0xff,0xfe,0x00]),textMime:'text/plain'}),error=>error.code==='malformed-media')
 await assert.rejects(inspect({bytes:Buffer.from('{not-json}'),textMime:'application/json'}),error=>error.code==='malformed-media')
})
test('MIME and size limits reject content without truncating or recompressing it',async()=>{
 await assert.rejects(inspect({}, {allowedMimeTypes:['audio/wav']}),error=>error.code==='unsupported-type')
 await assert.rejects(inspect({}, {maxBytes:10,maxDetectorBuffer:10}),error=>error.code==='too-large')
 const oversized=Buffer.from(png);oversized.writeUInt32BE(8192,16);oversized.writeUInt32BE(8192,20)
 await assert.rejects(inspect({bytes:oversized}),error=>error.code==='too-large')
 assert.equal(png.readUInt32BE(16),1)
})
test('cancellation before admission and during asynchronous inspection is sanitized',async()=>{
 const before=new AbortController();before.abort(new Error('synthetic-private-reason'))
 await assert.rejects(inspectOriginal(resolveInspection(config()),{bytes:png,source:source()},before.signal),error=>error.code==='cancelled'&&!error.message.includes('private'))
 const during=new AbortController(),task=inspectOriginal(resolveInspection(config()),{bytes:png,source:source()},during.signal);during.abort()
 await assert.rejects(task,error=>error.code==='cancelled')
})
test('source IDs and filenames refuse host paths, control characters and parent traversals',async()=>{
 for(const name of ['../photo.png','folder/photo.png','C:\\synthetic.png','bad\n.png'])await assert.rejects(inspect({fileName:name}),error=>error.code==='invalid-data'&&!error.message.includes(name))
 assert.throws(()=>mediaSource('file/../secret'));assert.throws(()=>mediaProvider('https://provider.invalid'))
})
test('invalid deployment relationships fail without starting media work',()=>{
 assert.throws(()=>resolveInspection(config({allowedMimeTypes:['image/png','image/png']})))
 assert.throws(()=>resolveInspection(config({maxDetectorBuffer:2*1024*1024})))
})
test('concurrent independent inspections preserve exact byte identity',async()=>{
 const originals=await Promise.all(Array.from({length:20},(_,n)=>inspect({source:{...source(),id:mediaSource('item-'+n)}})))
 assert.equal(new Set(originals.map(x=>x.descriptor.sha256)).size,1);assert.equal(new Set(originals.map(x=>x.descriptor.source.id)).size,20)
 for(const original of originals)assert.deepEqual(Buffer.from(original.copyBytes()),png)
})

test('audio signatures retain their exact original container instead of following an image suffix',async()=>{
 const bytes=Buffer.alloc(52);bytes.write('RIFF',0);bytes.writeUInt32LE(44,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(8,40)
 const original=await inspect({bytes,fileName:'sound.mp3'});assert.equal(original.descriptor.mime,'audio/wav');assert.equal(original.descriptor.fileName,'sound.wav');assert.deepEqual(Buffer.from(original.copyBytes()),bytes)
})
test('MIME allowances use explicit essences and reject wildcard or parameter configuration',()=>{
 assert.throws(()=>resolveInspection(config({allowedMimeTypes:['image/*']})))
 assert.throws(()=>resolveInspection(config({allowedMimeTypes:['audio/ogg; codecs=opus']})))
 assert.equal(resolveInspection(config({allowedMimeTypes:['audio/ogg']})).allowedMimeTypes.has('audio/ogg'),true)
})
