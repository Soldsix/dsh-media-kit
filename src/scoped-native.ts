/** Scope-bound opaque references and awaited leases for native original attachments. */
import {randomBytes,createHash} from 'node:crypto'
import {z} from 'zod'
import type {Branded} from '@deepseek-ai/dsh-brand'
import {MediaError} from './errors.ts'
import {parseNativeOriginal,readNativeOriginal,type NativeStoredOriginal,type NativeStorageSpec,type VerbatimAttachmentStore} from './dsh-attachments.ts'
import type {OriginalMedia,MediaDigest} from './types.ts'
/** Opaque unpredictable reference; content hashes are not access grants. */
export type MediaReference=Branded<'media.reference'>
/** Exact authenticated owner scope, bound by the consuming Host plugin. */
export type MediaScope=Branded<'media.scope'>
/** Explicit per-book logical capacities; no item is evicted automatically. */
export interface ReferenceConfig{readonly maxReferences:number;readonly maxOriginalBytes:number;readonly maxLeases:number;readonly maxConcurrentReads:number}
/** Validated reference capacities. */
export interface ReferenceSpec extends ReferenceConfig{}
/** Owner-journal record; restoring it is a trusted Host operation, never a model tool. */
export interface MediaGrant{readonly version:1;readonly reference:MediaReference;readonly scope:MediaScope;readonly stored:NativeStoredOriginal}
/** Safe presentation omits provider/source identifiers and native attachment references. */
export interface MediaView{readonly reference:MediaReference;readonly fileName:string;readonly mime:string;readonly bytes:number;readonly sha256:MediaDigest;readonly width?:number;readonly height?:number}
/** One active owner lease protects its reference until pending reads finish. */
export interface MediaLease{
 readonly view:MediaView
 /** @param signal - cancellation of this read only. @returns an exact verified original, independently of other leases. */
 read(signal:AbortSignal):Promise<OriginalMedia>
 /** @returns completion after this lease's reads stop and its quota is released. */
 release():Promise<void>
}
const positive=z.number().int().positive().safe(),reference=z.string().regex(/^mr_[A-Za-z0-9_-]{43}$/u).transform(value=>value as MediaReference),scope=z.string().min(1).max(4096).refine(value=>value.trim()!==''&&!/[\u0000-\u001f\u007f]/u.test(value)).transform(value=>value as MediaScope)
const grant=z.strictObject({version:z.literal(1),reference,scope,stored:z.unknown()})
/** @param value - raw configured capacities. @returns resolved logical-reference limits. */
export function resolveReferences(value:ReferenceConfig):ReferenceSpec{const parsed=z.strictObject({maxReferences:positive,maxOriginalBytes:positive,maxLeases:positive,maxConcurrentReads:positive}).safeParse(value);if(!parsed.success)throw new MediaError('invalid-data');return parsed.data}
/** @param value - scope from an authenticated Host event. @returns branded owner scope. */
export function mediaScope(value:string):MediaScope{const parsed=scope.safeParse(value);if(!parsed.success)throw new MediaError('invalid-data');return parsed.data}
/** @param value - opaque handle from an untrusted request. @returns branded reference without granting access. */
export function mediaReference(value:string):MediaReference{const parsed=reference.safeParse(value);if(!parsed.success)throw new MediaError('invalid-data');return parsed.data}
function fingerprint(value:MediaGrant):string{
 const {descriptor:d,attachment:a}=value.stored
 return createHash('sha256').update(JSON.stringify([value.scope,value.stored.format,d.sha256,d.byteLength,d.mime,d.extension,d.fileName,d.detectedBy,d.source.provider,d.source.id,d.source.kind,d.image?.width,d.image?.height,d.image?.orientation,a.attachmentId,a.name,a.bytes])).digest('hex')
}
interface RecordState{readonly grant:MediaGrant;readonly fingerprint:string;pins:number}
class Lease implements MediaLease{
 private readonly lifetime=new AbortController()
 private readonly tasks=new Set<Promise<OriginalMedia>>()
 private stopping=false
 private closing:Promise<void>|undefined
 constructor(readonly view:MediaView,private readonly stored:NativeStoredOriginal,private readonly store:VerbatimAttachmentStore,private readonly spec:NativeStorageSpec,private readonly releaseQuota:()=>void,private readonly claimRead:()=>()=>void){}
 read(signal:AbortSignal):Promise<OriginalMedia>{
  if(this.stopping)return Promise.reject(new MediaError('closed'))
  let releaseRead:()=>void;try{releaseRead=this.claimRead()}catch(error){return Promise.reject(error)}
  const task=readNativeOriginal(this.store,this.stored,this.spec,AbortSignal.any([signal,this.lifetime.signal]));this.tasks.add(task)
  void task.then(()=>{this.tasks.delete(task);releaseRead()},()=>{this.tasks.delete(task);releaseRead()});return task
 }
 release():Promise<void>{
  if(this.closing)return this.closing
  this.stopping=true
  this.closing=Promise.resolve().then(async()=>{const settled=Promise.allSettled([...this.tasks]);this.lifetime.abort();await settled;this.releaseQuota()})
  return this.closing
 }
}
/**
 * Scoped reference index over a selected native attachment provider. Grant persistence belongs to the consumer's journal.
 * The book never deletes or modifies the storage owner's files and never evicts active or inactive references automatically.
 */
export class ScopedNativeMedia{
 private readonly records=new Map<MediaReference,RecordState>()
 private readonly objects=new Map<MediaDigest,{bytes:number;references:number}>()
 private readonly leases=new Set<Lease>()
 private originalBytes=0
 private reading=0
 private stopping=false
 private closing:Promise<void>|undefined
 /** @param limits - resolved logical capacities. @param store - selected verbatim native provider. @param storage - explicit original export/inspection policy. */
 constructor(private readonly limits:ReferenceSpec,private readonly store:VerbatimAttachmentStore,private readonly storage:NativeStorageSpec){}
 private open():void{if(this.stopping)throw new MediaError('closed')}
 private record(owner:MediaScope,id:MediaReference):RecordState{this.open();const record=this.records.get(id);if(!record||record.grant.scope!==owner)throw new MediaError('not-found');return record}
 private admit(value:MediaGrant):MediaReference{
  this.open();const existing=this.records.get(value.reference),identity=fingerprint(value)
  if(existing){if(existing.fingerprint!==identity)throw new MediaError('source-conflict');return value.reference}
  const {sha256,byteLength}=value.stored.descriptor,object=this.objects.get(sha256)
  if(object&&object.bytes!==byteLength)throw new MediaError('integrity-failed')
  if(this.records.size>=this.limits.maxReferences||this.originalBytes+(object?0:byteLength)>this.limits.maxOriginalBytes)throw new MediaError('capacity')
  this.records.set(value.reference,{grant:structuredClone(value),fingerprint:identity,pins:0})
  if(object)object.references++;else{this.objects.set(sha256,{bytes:byteLength,references:1});this.originalBytes+=byteLength}
  return value.reference
 }
 /** @param owner - scope bound by a trusted Host. @param stored - receipt from native save or the durable receipt parser. @returns a fresh unpredictable reference; persist exportGrant before exposing it beyond this process. */
 register(owner:MediaScope,stored:NativeStoredOriginal):MediaReference{
  this.open();let id:MediaReference;do{id=('mr_'+randomBytes(32).toString('base64url')) as MediaReference}while(this.records.has(id))
  return this.admit({version:1,reference:id,scope:owner,stored})
 }
 /** @param owner - exact authenticated owner scope. @param value - record from the consumer's trusted owner journal. @returns restored reference; never accepts records supplied by a model or ordinary chat member. */
 restore(owner:MediaScope,value:unknown):MediaReference{
  this.open();const parsed=grant.safeParse(value);if(!parsed.success)throw new MediaError('invalid-data')
  if(parsed.data.scope!==owner)throw new MediaError('not-found')
  return this.admit({...parsed.data,stored:parseNativeOriginal(parsed.data.stored)})
 }
 /** @param owner - authorized scope. @param id - scoped handle. @returns a detached record for the consumer's durable journal; no filesystem path is returned. */
 exportGrant(owner:MediaScope,id:MediaReference):MediaGrant{return structuredClone(this.record(owner,id).grant)}
 /** @param owner - authorized scope. @param id - scoped handle. @returns public metadata without backend identity or provider source labels. */
 describe(owner:MediaScope,id:MediaReference):MediaView{
  const d=this.record(owner,id).grant.stored.descriptor
  return Object.freeze({reference:id,fileName:d.fileName,mime:d.mime,bytes:d.byteLength,sha256:d.sha256,...d.image?{width:d.image.width,height:d.image.height}:{}})
 }
 /** @param owner - authenticated scope. @param id - scoped handle. @returns a lease that must be released; capacity rejection never evicts another item. */
 acquire(owner:MediaScope,id:MediaReference):MediaLease{
  const record=this.record(owner,id);if(this.leases.size>=this.limits.maxLeases)throw new MediaError('capacity')
  record.pins++
  const lease=new Lease(this.describe(owner,id),record.grant.stored,this.store,this.storage,()=>{record.pins--;this.leases.delete(lease)},()=>{this.open();if(this.reading>=this.limits.maxConcurrentReads)throw new MediaError('capacity');this.reading++;return()=>{this.reading--}})
  this.leases.add(lease);return lease
 }
 /** @param owner - authorized scope. @param id - scoped handle. @returns after revoking an idle reference; original storage bytes are retained by their owner. */
 revoke(owner:MediaScope,id:MediaReference):void{
  const record=this.record(owner,id);if(record.pins)throw new MediaError('busy')
  this.records.delete(id);const key=record.grant.stored.descriptor.sha256,object=this.objects.get(key)
  if(!object)throw new MediaError('integrity-failed')
  object.references--;if(object.references===0){this.objects.delete(key);this.originalBytes-=object.bytes}
 }
 /** @returns body-free aggregate counts; originalBytes counts unique tracked content, not total shared backend disk usage. */
 status():{readonly references:number;readonly originals:number;readonly originalBytes:number;readonly leases:number;readonly pendingReads:number;readonly closed:boolean}{return{references:this.records.size,originals:this.objects.size,originalBytes:this.originalBytes,leases:this.leases.size,pendingReads:this.reading,closed:this.stopping}}
 /** @returns completion after all leased reads stop. The original bytes and caller-owned journal records are retained. */
 close():Promise<void>{
  if(this.closing)return this.closing
  this.stopping=true
  this.closing=Promise.resolve().then(async()=>{await Promise.all([...this.leases].map(lease=>lease.release()));this.records.clear();this.objects.clear();this.originalBytes=0})
  return this.closing
 }
}
