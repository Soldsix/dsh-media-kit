/** Verify a library-only manifest and publication allowlist. */
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
const root=new URL('../',import.meta.url),manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'))
assert.equal(manifest.name,'dsh-media-kit');assert.equal(manifest.type,'module');assert.equal(manifest.bin,undefined);assert.equal(manifest.dsh,undefined)
for(const section of ['dependencies','peerDependencies','devDependencies'])for(const version of Object.values(manifest[section]??{}))assert.equal(/^(file:|link:|workspace:|[A-Za-z]:)/u.test(version),false)
for(const name of await readdir(new URL('src/',root))){if(!name.endsWith('.ts'))continue;const text=await readFile(new URL('src/'+name,root),'utf8');assert.ok(text.startsWith('/**'));assert.equal(/\bas unknown\b/u.test(text),false);assert.equal(/[C-F]:[\\/](Users|个人|项目工作区)[\\/]/iu.test(text),false);assert.ok(/\r?\n$/u.test(text)&&!/(?:\r?\n){2}$/u.test(text))}
for(const name of ['README.md','README.zh.md','LICENSE'])assert.ok((await readFile(new URL(name,root),'utf8')).trim().length>0)
console.log(JSON.stringify({passed:true,libraryOnly:true,privateDependencies:false,applicationLauncher:false}))
