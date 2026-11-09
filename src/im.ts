/** Account-bound original-media providers for messaging adapters and offline consumers. */
import {accountKey,type AccountKey,type AccountRef,type AttachmentId,type ConversationScope} from 'dsh-im-kit'
import {z} from 'zod'
import {MediaError} from './errors.ts'
import type {OriginalMedia} from './types.ts'

/** A transport-owned adapter must bind both account and conversation before accessing bytes. */
export interface ImMediaProvider{
 readonly account:AccountRef
 /** @param scope - authenticated destination. @param original - inspected original. @param signal - caller/provider lifetime. @returns a conversation-bound attachment handle after durable retention. */
 store(scope:ConversationScope,original:OriginalMedia,signal:AbortSignal):Promise<AttachmentId>
 /** @param scope - authenticated conversation. @param attachment - untrusted opaque handle. @param signal - read lifetime. @returns independently owned, verified original bytes. */
 read(scope:ConversationScope,attachment:AttachmentId,signal:AbortSignal):Promise<OriginalMedia>
 /** @returns completion after owned imports and reads stop; storage retention belongs to its owner. */
 dispose():Promise<void>
}
/** Explicit deployment capacities; excess operations are rejected without queueing. */
export interface ImMediaConfig{readonly maxProviders:number;readonly maxPendingPerProvider:number}
/** Resolved media routing limits. */
export interface ImMediaSpec extends ImMediaConfig{}
/** @param value - raw routing capacities. @returns validated provider and in-flight limits. */
export function resolveImMedia(value:ImMediaConfig):ImMediaSpec{
 const positive=z.number().int().positive().safe(),parsed=z.strictObject({maxProviders:positive,maxPendingPerProvider:positive}).safeParse(value)
 if(!parsed.success)throw new MediaError('invalid-data')
 return parsed.data
}
interface Provider{readonly adapter:ImMediaProvider;readonly lifetime:AbortController;readonly pending:Set<Promise<unknown>>;closing?:Promise<void>}

/** No filesystem, network, model client or application is created by this routing service. */
export class ImMediaRuntime{
 private readonly providers=new Map<AccountKey,Provider>()
 private readonly lifetime=new AbortController()
 private closing:Promise<void>|undefined
 /** @param spec - explicit provider and operation capacities. */
 constructor(private readonly spec:ImMediaSpec){}
 /** @param adapter - account-bound provider owned by this registration. @returns idempotent cancellation and awaited provider disposal. */
 register(adapter:ImMediaProvider):()=>Promise<void>{
  if(this.lifetime.signal.aborted)throw new MediaError('closed')
  const key=accountKey(adapter.account)
  if(this.providers.has(key))throw new MediaError('source-conflict')
  if(this.providers.size>=this.spec.maxProviders)throw new MediaError('capacity')
  const provider:Provider={adapter,lifetime:new AbortController(),pending:new Set()};this.providers.set(key,provider)
  return()=>{
   const task=this.stop(provider)
   void task.then(()=>{if(this.providers.get(key)===provider)this.providers.delete(key)},()=>{if(this.providers.get(key)===provider)this.providers.delete(key)})
   return task
  }
 }
 /** @param scope - trusted account and conversation. @param original - immutable inspected bytes. @param signal - caller lifetime. @returns a scoped handle, or a sanitized failure; no automatic retry occurs. */
 store(scope:ConversationScope,original:OriginalMedia,signal:AbortSignal):Promise<AttachmentId>{return this.perform(scope,signal,(provider,combined)=>provider.store(scope,original,combined))}
 /** @param scope - trusted account and conversation. @param attachment - opaque handle, never a filename or URL. @param signal - caller lifetime. @returns an owned verified original; cancellation suppresses late successful results. */
 read(scope:ConversationScope,attachment:AttachmentId,signal:AbortSignal):Promise<OriginalMedia>{return this.perform(scope,signal,(provider,combined)=>provider.read(scope,attachment,combined))}
 /** @returns aggregate lifecycle counts without identifiers, bytes or native paths. */
 status():{readonly providers:number;readonly pending:number;readonly closed:boolean}{return{providers:this.providers.size,pending:[...this.providers.values()].reduce((count,value)=>count+value.pending.size,0),closed:this.lifetime.signal.aborted}}
 private perform<T>(scope:ConversationScope,signal:AbortSignal,run:(provider:ImMediaProvider,signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(this.lifetime.signal.aborted)return Promise.reject(new MediaError('closed'))
  if(signal.aborted)return Promise.reject(new MediaError('cancelled'))
  const provider=this.providers.get(accountKey(scope.account))
  if(!provider)return Promise.reject(new MediaError('not-found'))
  if(provider.lifetime.signal.aborted)return Promise.reject(new MediaError('closed'))
  if(provider.pending.size>=this.spec.maxPendingPerProvider)return Promise.reject(new MediaError('capacity'))
  const combined=AbortSignal.any([signal,this.lifetime.signal,provider.lifetime.signal])
  const operation=Promise.resolve().then(async()=>{
   if(combined.aborted)throw new MediaError('cancelled')
   try{const result=await run(provider.adapter,combined);if(combined.aborted)throw new MediaError('cancelled');return result}
   catch(error){throw combined.aborted?new MediaError('cancelled'):error instanceof MediaError?error:new MediaError('storage-unavailable')}
  })
  provider.pending.add(operation)
  void operation.then(()=>{provider.pending.delete(operation)},()=>{provider.pending.delete(operation)})
  return operation
 }
 private stop(provider:Provider):Promise<void>{
  if(provider.closing)return provider.closing
  provider.closing=Promise.resolve().then(async()=>{
   const settled=await Promise.allSettled([Promise.resolve().then(()=>provider.adapter.dispose()),...provider.pending])
   if(settled[0]?.status==='rejected')throw new MediaError('storage-unavailable')
  })
  provider.lifetime.abort();return provider.closing
 }
 /** @returns shared completion after stopping admission, aborting and joining every provider and operation. */
 close():Promise<void>{
  if(this.closing)return this.closing
  this.closing=Promise.resolve().then(async()=>{
   const settled=await Promise.allSettled([...this.providers.values()].map(provider=>this.stop(provider)));this.providers.clear()
   if(settled.some(value=>value.status==='rejected'))throw new MediaError('storage-unavailable')
  })
  this.lifetime.abort();return this.closing
 }
}
