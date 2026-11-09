/** Native original attachment storage behind account- and conversation-bound IM handles. */
import {accountKey,scopeKey,identifier,type AccountRef,type AttachmentId,type ConversationScope} from 'dsh-im-kit'
import {z} from 'zod'
import {MediaError} from './errors.ts'
import {saveNativeOriginal,type NativeStorageSpec,type VerbatimAttachmentStore} from './dsh-attachments.ts'
import {ScopedNativeMedia,mediaScope,mediaReference,type MediaGrant,type MediaScope,type ReferenceSpec} from './scoped-native.ts'
import type {OriginalMedia} from './types.ts'
import type {ImMediaProvider} from './im.ts'

/** The owning plugin durably appends before resolving and supports concurrent calls using serialized writes or transactions; the provider never retries. */
export interface ImMediaJournal{
 /** @param grant - complete Host-only reference metadata. @param signal - import lifetime. @returns durable completion, without exposing the grant to a model. */
 append(grant:MediaGrant,signal:AbortSignal):Promise<void>
}
/** Explicit storage services, capacities and owner-journal records for one account. */
export interface NativeImMediaOptions{
 readonly account:AccountRef
 readonly attachments:VerbatimAttachmentStore
 readonly storage:NativeStorageSpec
 readonly references:ReferenceSpec
 readonly journal:ImMediaJournal
 readonly restoredGrants:readonly unknown[]
}

/** The original storage and its retention remain owned by the native attachment provider. */
export class NativeImMediaProvider implements ImMediaProvider{
 readonly account:AccountRef
 private readonly book:ScopedNativeMedia
 private readonly lifetime=new AbortController()
 private readonly pending=new Set<Promise<unknown>>()
 private closing:Promise<void>|undefined
 /** @param options - account, explicit policies and trusted durable journal source. Invalid or foreign restored records reject construction. */
 constructor(private readonly options:NativeImMediaOptions){
  this.account=options.account
  this.book=new ScopedNativeMedia(options.references,options.attachments,options.storage)
  const owner=z.tuple([z.literal(this.account.tenantId),z.literal(this.account.networkId),z.literal(this.account.accountId),z.enum(['group','private']),z.string().min(1)])
  for(const value of options.restoredGrants){
   const record=z.object({scope:z.string()}).safeParse(value)
   if(!record.success)throw new MediaError('invalid-data')
   let decoded:unknown
   try{decoded=JSON.parse(record.data.scope)}catch(error){throw new MediaError('invalid-data')}
   const parsed=owner.safeParse(decoded)
   if(!parsed.success)throw new MediaError('invalid-data')
   let peer:ConversationScope['peerId']
   try{peer=identifier('im.peer',parsed.data[4])}catch(error){throw new MediaError('invalid-data')}
   if(scopeKey({account:this.account,kind:parsed.data[3],peerId:peer})!==record.data.scope)throw new MediaError('invalid-data')
   this.book.restore(mediaScope(record.data.scope),value)
  }
 }
 private scope(value:ConversationScope):MediaScope{
  if(accountKey(value.account)!==accountKey(this.account))throw new MediaError('not-found')
  return mediaScope(scopeKey(value))
 }
 private run<T>(signal:AbortSignal,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(this.lifetime.signal.aborted)return Promise.reject(new MediaError('closed'))
  if(signal.aborted)return Promise.reject(new MediaError('cancelled'))
  const combined=AbortSignal.any([signal,this.lifetime.signal])
  const task=Promise.resolve().then(async()=>{
   if(combined.aborted)throw new MediaError('cancelled')
   try{const result=await work(combined);if(combined.aborted)throw new MediaError('cancelled');return result}
   catch(error){throw combined.aborted?new MediaError('cancelled'):error instanceof MediaError?error:new MediaError('storage-unavailable')}
  })
  this.pending.add(task);void task.then(()=>{this.pending.delete(task)},()=>{this.pending.delete(task)});return task
 }
 /** @param scope - authenticated destination. @param original - exact inspected input. @param signal - import cancellation. @returns an opaque handle only after its grant is retained; a late cancellation or failed journal can leave unreturned retained data. */
 store(scope:ConversationScope,original:OriginalMedia,signal:AbortSignal):Promise<AttachmentId>{
  return this.run(signal,async combined=>{
   const owner=this.scope(scope),stored=await saveNativeOriginal(this.options.attachments,original,this.options.storage,combined)
   const reference=this.book.register(owner,stored)
   await this.options.journal.append(this.book.exportGrant(owner,reference),combined)
   return identifier('im.attachment',reference)
  })
 }
 /** @param scope - authenticated conversation. @param attachment - untrusted handle. @param signal - caller cancellation. @returns verified original bytes after joining its independent read lease. */
 read(scope:ConversationScope,attachment:AttachmentId,signal:AbortSignal):Promise<OriginalMedia>{
  return this.run(signal,async combined=>{
   const lease=this.book.acquire(this.scope(scope),mediaReference(attachment))
   try{return await lease.read(combined)}finally{await lease.release()}
  })
 }
 /** @returns logical reference and operation counts, without paths, identities or content. */
 status():ReturnType<ScopedNativeMedia['status']>&{readonly pending:number}{return{...this.book.status(),pending:this.pending.size}}
 /** @returns shared completion after aborting and joining imports/reads and releasing every lease; native bytes and journal records are retained. */
 dispose():Promise<void>{
  if(this.closing)return this.closing
  this.closing=Promise.resolve().then(async()=>{await Promise.allSettled([...this.pending]);await this.book.close()})
  this.lifetime.abort();return this.closing
 }
}
