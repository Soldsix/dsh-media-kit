/** Media routing isolates accounts and joins cancellation without hidden retries. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {identifier} from 'dsh-im-kit'
import {ImMediaRuntime,resolveImMedia} from '../dist/im.js'
import {MediaError} from '../dist/index.js'
const id=(kind,value)=>identifier(kind,value),account=(label='a')=>({tenantId:id('im.tenant','tenant'),networkId:id('im.network','fixture'),accountId:id('im.account',label)}),scope=(owner=account(),peer='room',kind='group')=>({account:owner,peerId:id('im.peer',peer),kind}),signal=()=>new AbortController().signal
const limits=(patch={})=>resolveImMedia({maxProviders:2,maxPendingPerProvider:2,...patch}),attachment=id('im.attachment','synthetic-original'),original=Object.freeze({descriptor:Object.freeze({}),copyBytes:()=>new Uint8Array([1,2,3])})
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
function provider(owner=account(),patch={}){return{account:owner,async store(){return attachment},async read(){return original},async dispose(){},...patch}}
test('media routing requires explicit capacities and one provider per complete account',async t=>{
 for(const invalid of [{maxProviders:0,maxPendingPerProvider:1},{maxProviders:1,maxPendingPerProvider:0},{maxProviders:NaN,maxPendingPerProvider:1},{maxProviders:1,maxPendingPerProvider:1,extra:true}])assert.throws(()=>resolveImMedia(invalid),error=>error.code==='invalid-data')
 const runtime=new ImMediaRuntime(limits({maxProviders:1}));t.after(()=>runtime.close());const remove=runtime.register(provider())
 assert.throws(()=>runtime.register(provider()),error=>error.code==='source-conflict');assert.throws(()=>runtime.register(provider(account('other'))),error=>error.code==='capacity')
 await remove();await remove();runtime.register(provider(account('other')));assert.equal(runtime.status().providers,1)
})
test('media operations preserve scope and route exclusively to the selected account',async t=>{
 const runtime=new ImMediaRuntime(limits());t.after(()=>runtime.close());const calls=[]
 for(const name of ['a','b'])runtime.register(provider(account(name),{async store(destination,input){calls.push(['store',name,destination]);assert.equal(input,original);return attachment},async read(destination,reference){calls.push(['read',name,destination]);assert.equal(reference,attachment);return original}}))
 const a=scope(),b=scope(account('b'),'room','private');assert.equal(await runtime.store(a,original,signal()),attachment);assert.equal(await runtime.read(b,attachment,signal()),original);assert.deepEqual(calls,[['store','a',a],['read','b',b]])
 await assert.rejects(runtime.read(scope(account('missing')),attachment,signal()),error=>error.code==='not-found')
})
test('capacity refusal and cancellation before dispatch do not invoke the provider',async t=>{
 const runtime=new ImMediaRuntime(limits({maxPendingPerProvider:1}));t.after(()=>runtime.close());const entered=deferred(),finish=deferred();let calls=0
 runtime.register(provider(account(),{async read(){calls++;entered.resolve();await finish.promise;return original}}))
 const pending=runtime.read(scope(),attachment,signal());await entered.promise;await assert.rejects(runtime.store(scope(),original,signal()),error=>error.code==='capacity');assert.equal(calls,1);finish.resolve();await pending
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(runtime.read(scope(),attachment,cancelled.signal),error=>error.code==='cancelled')
 const before=new AbortController(),queued=runtime.read(scope(),attachment,before.signal);before.abort();await assert.rejects(queued,error=>error.code==='cancelled');assert.equal(calls,1)
})
test('caller cancellation suppresses a late result while sibling providers remain usable',async t=>{
 const runtime=new ImMediaRuntime(limits());t.after(()=>runtime.close());const entered=deferred(),finish=deferred(),caller=new AbortController()
 runtime.register(provider(account(),{async read(){entered.resolve();await finish.promise;return original}}));runtime.register(provider(account('b')))
 const pending=runtime.read(scope(),attachment,caller.signal),rejected=assert.rejects(pending,error=>error.code==='cancelled');await entered.promise;caller.abort();assert.equal(await runtime.store(scope(account('b')),original,signal()),attachment);finish.resolve();await rejected;assert.equal(runtime.status().pending,0)
})
test('unregister waits for active media work before releasing the provider slot',async()=>{
 const runtime=new ImMediaRuntime(limits({maxProviders:1})),entered=deferred(),cancelled=deferred(),cleanup=deferred();let disposed=0
 const remove=runtime.register(provider(account(),{async read(_scope,_id,abort){entered.resolve();await new Promise(resolve=>{if(abort.aborted)resolve();else abort.addEventListener('abort',resolve,{once:true})});cancelled.resolve();await cleanup.promise;return original},async dispose(){disposed++}}))
 const pending=runtime.read(scope(),attachment,signal()),rejected=assert.rejects(pending,error=>error.code==='cancelled');await entered.promise;let completed=false;const removing=remove();void removing.then(()=>{completed=true});assert.equal(removing,remove());await cancelled.promise;assert.equal(completed,false)
 await assert.rejects(runtime.read(scope(),attachment,signal()),error=>error.code==='closed');assert.throws(()=>runtime.register(provider(account('b'))),error=>error.code==='capacity');cleanup.resolve();await removing;await rejected;assert.equal(disposed,1);runtime.register(provider(account('b')));await runtime.close()
})
test('unexpected provider failures never expose their body and known media errors remain classified',async()=>{
 const runtime=new ImMediaRuntime(limits()),remove=runtime.register(provider(account(),{async store(){throw Error('private-provider-path')},async read(){throw new MediaError('integrity-failed')},async dispose(){throw Error('private-close-path')}}))
 await assert.rejects(runtime.store(scope(),original,signal()),error=>error.code==='storage-unavailable'&&!error.message.includes('private'))
 await assert.rejects(runtime.read(scope(),attachment,signal()),error=>error.code==='integrity-failed')
 await assert.rejects(remove(),error=>error.code==='storage-unavailable'&&!error.message.includes('private'));await runtime.close()
 const failed=new ImMediaRuntime(limits());failed.register(provider(account(),{async dispose(){throw Error('hidden')}}));await assert.rejects(failed.close(),error=>error.code==='storage-unavailable');assert.equal(failed.status().providers,0)
})
test('runtime shutdown rejects new work and awaits cancellation settlement',async()=>{
 const runtime=new ImMediaRuntime(limits()),entered=deferred(),cleanup=deferred();runtime.register(provider(account(),{async store(_scope,_original,abort){entered.resolve();await new Promise(resolve=>{if(abort.aborted)resolve();else abort.addEventListener('abort',resolve,{once:true})});await cleanup.promise;return attachment}}))
 const pending=runtime.store(scope(),original,signal()),rejected=assert.rejects(pending,error=>error.code==='cancelled');await entered.promise;let finished=false;const closing=runtime.close();void closing.then(()=>{finished=true});assert.equal(closing,runtime.close());await assert.rejects(runtime.store(scope(),original,signal()),error=>error.code==='closed');assert.throws(()=>runtime.register(provider()),error=>error.code==='closed');assert.equal(finished,false);cleanup.resolve();await rejected;await closing;assert.deepEqual(runtime.status(),{providers:0,pending:0,closed:true})
})
