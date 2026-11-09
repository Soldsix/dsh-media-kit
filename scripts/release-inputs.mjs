/** Download the exact public IM protocol peer used by isolated release consumers. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
const root=new URL('../.test-artifacts/release-inputs/',import.meta.url);await mkdir(root,{recursive:true})
const target=new URL('dsh-im-kit-0.2.1.tgz',root),expected='48686023b7307e3296d403994ad5cfb5cc7bfa7e4be5ef423af934b5286c40f0';let bytes
try{bytes=await readFile(target)}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch('https://github.com/Soldsix/dsh-im-kit/releases/download/v0.2.1/dsh-im-kit-0.2.1.tgz',{signal:AbortSignal.timeout(90000)});assert.equal(response.ok,true,'Public peer download failed');bytes=new Uint8Array(await response.arrayBuffer())}
assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,'Public peer hash mismatch');await writeFile(target,bytes);console.log(JSON.stringify({peer:'dsh-im-kit',version:'0.2.1',sha256:expected}))
