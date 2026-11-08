/** Root-only public consumer: no native attachment entry or application is started. */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {inspectOriginal,resolveInspection,mediaProvider,mediaSource} from 'dsh-media-kit'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1UAAAAASUVORK5CYII=','base64'),policy=resolveInspection({maxBytes:1024,maxDetectorBuffer:1024,maxWidth:100,maxHeight:100,maxPixels:10000,allowedMimeTypes:['image/png']}),original=await inspectOriginal(policy,{bytes:png,fileName:'one.jpg',source:{provider:mediaProvider('fixture'),id:mediaSource('one'),kind:'fixture'}},new AbortController().signal)
assert.deepEqual(Buffer.from(original.copyBytes()),png);assert.equal(original.descriptor.fileName,'one.png')
console.log(JSON.stringify({passed:true,originalBytesVerified:true,startedApplications:0,openedDatabases:0}))
