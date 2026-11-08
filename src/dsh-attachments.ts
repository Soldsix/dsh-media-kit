/** Verbatim native DSH attachment storage, without using image normalization or host paths. */
import {createHash} from 'node:crypto'
import {MIMEType} from 'node:util'
import {supportedMimeTypes} from 'file-type'
import {AttachmentId,isAttachmentError,type AttachmentStore,type FileAttachmentRef} from '@deepseek-ai/dsh-attachment'
import {z} from 'zod'
import {MediaError} from './errors.ts'
import {sourceSchema,resolveInspection} from './config.ts'
import {inspectOwnedOriginal} from './inspect.ts'
import type {OriginalDescriptor,OriginalMedia,MediaDigest,InspectionConfig,InspectionSpec,InspectionRequest} from './types.ts'
/** Only the official verbatim stream capability is required. */
export type VerbatimAttachmentStore=Pick<AttachmentStore,'saveFileStream'|'readFileStream'>
/** Deployment controls for writes and complete-byte exports. */
export interface NativeStorageConfig{readonly chunkBytes:number;readonly maxReadBytes:number;readonly inspection:InspectionConfig}
/** Resolved native adapter capacities. */
export interface NativeStorageSpec extends Omit<NativeStorageConfig,'inspection'>{readonly inspection:InspectionSpec}
/** Durable Host-only receipt; it is not an authorization grant for model-supplied identifiers. */
export interface NativeStoredOriginal{readonly format:'dsh-media-native-v1';readonly descriptor:OriginalDescriptor;readonly attachment:Readonly<FileAttachmentRef>}
const positive=z.number().int().positive().safe(),hash=z.string().regex(/^[a-f0-9]{64}$/u)
const fileName=z.string().min(1).max(255).refine(value=>!/[\\/:\u0000-\u001f\u007f]/u.test(value)&&value!=='.'&&value!=='..')
const descriptorSchema=z.strictObject({sha256:hash.transform(value=>value as MediaDigest),byteLength:positive,mime:z.string().min(1).max(255).refine(value=>supportedMimeTypes.has(value)||['text/plain','text/html','application/json'].includes(value)),extension:z.string().regex(/^[a-z0-9]+$/u),fileName,detectedBy:z.enum(['signature','declared-text']),source:sourceSchema,image:z.strictObject({width:positive,height:positive,orientation:z.number().int().min(1).max(8).optional()}).optional()})
const receiptSchema=z.strictObject({format:z.literal('dsh-media-native-v1'),descriptor:descriptorSchema,attachment:z.strictObject({attachmentId:z.string().min(1).max(512).refine(value=>!/[\u0000-\u0020\u007f]/u.test(value)).transform(AttachmentId),name:fileName,bytes:positive})})
/** @param value - raw deployment capacities. @returns explicit chunk and export bounds. */
export function resolveNativeStorage(value:NativeStorageConfig):NativeStorageSpec{
 const parsed=z.strictObject({chunkBytes:positive,maxReadBytes:positive}).safeParse({chunkBytes:value.chunkBytes,maxReadBytes:value.maxReadBytes})
 if(!parsed.success||parsed.data.chunkBytes>parsed.data.maxReadBytes)throw new MediaError('invalid-data')
 const inspection=resolveInspection(value.inspection);if(inspection.maxBytes>parsed.data.maxReadBytes)throw new MediaError('invalid-data')
 return{...parsed.data,inspection}
}
function immutable(value:NativeStoredOriginal):NativeStoredOriginal{
 return Object.freeze({format:value.format,descriptor:Object.freeze({...value.descriptor,source:Object.freeze({...value.descriptor.source}),...value.descriptor.image?{image:Object.freeze({...value.descriptor.image})}:{}}),attachment:Object.freeze({...value.attachment})})
}
/** @param value - receipt read from a durable record or worker response. @returns validated immutable Host receipt. */
export function parseNativeOriginal(value:unknown):NativeStoredOriginal{
 const parsed=receiptSchema.safeParse(value);if(!parsed.success)throw new MediaError('invalid-data')
 if(parsed.data.attachment.bytes!==parsed.data.descriptor.byteLength)throw new MediaError('integrity-failed')
 const d=parsed.data.descriptor
 if(d.mime.startsWith('image/')!==Boolean(d.image)||!d.fileName.endsWith('.'+d.extension)||d.detectedBy==='declared-text'&&!['text/plain','text/html','application/json'].includes(d.mime))throw new MediaError('invalid-data')
 const {image,...metadata}=parsed.data.descriptor
 const descriptor:OriginalDescriptor={...metadata,...image?{image:{width:image.width,height:image.height,...image.orientation===undefined?{}:{orientation:image.orientation}}}:{}}
 return immutable({...parsed.data,descriptor})
}
function admitted(descriptor:OriginalDescriptor,spec:NativeStorageSpec):void{
 const policy=spec.inspection,image=descriptor.image
 if(descriptor.byteLength>spec.maxReadBytes||descriptor.byteLength>policy.maxBytes)throw new MediaError('too-large')
 if(!policy.allowedMimeTypes.has(new MIMEType(descriptor.mime).essence))throw new MediaError('unsupported-type')
 if(image&&(image.width>policy.maxWidth||image.height>policy.maxHeight||image.width*image.height>policy.maxPixels))throw new MediaError('too-large')
}
function cancelled(signal:AbortSignal):void{if(signal.aborted)throw new MediaError('cancelled')}
function storageFailure(error:unknown,signal:AbortSignal):MediaError{
 if(signal.aborted)return new MediaError('cancelled')
 if(error instanceof MediaError)return error
 if(isAttachmentError(error)){
  if(error.code==='ATTACHMENT_FILES_UNSUPPORTED')return new MediaError('storage-unsupported')
  if(error.code==='ATTACHMENT_NOT_FOUND')return new MediaError('not-found')
  if(error.code==='ATTACHMENT_CORRUPT'||error.code==='INVALID_ATTACHMENT_REF')return new MediaError('integrity-failed')
 }
 return new MediaError('storage-unavailable')
}
/**
 * Store exact inspected bytes through the Host's verbatim attachment API.
 * @param store - selected native attachment provider; image APIs are never called.
 * @param original - owned original bytes and immutable metadata.
 * @param spec - explicit stream and size limits.
 * @param signal - storage cancellation; completed immutable objects may remain if cancellation wins delivery of the receipt.
 * @returns validated content-addressed Host receipt; scope authorization belongs to the consuming plugin.
 */
export async function saveNativeOriginal(store:VerbatimAttachmentStore,original:OriginalMedia,spec:NativeStorageSpec,signal:AbortSignal):Promise<NativeStoredOriginal>{
 cancelled(signal)
 admitted(original.descriptor,spec)
 const bytes=original.copyBytes()
 async function* chunks():AsyncIterable<Uint8Array>{for(let offset=0;offset<bytes.byteLength;offset+=spec.chunkBytes){cancelled(signal);yield bytes.subarray(offset,Math.min(bytes.byteLength,offset+spec.chunkBytes))}}
 try{
  const attachment=await store.saveFileStream({data:chunks(),signal,name:'original.'+original.descriptor.extension});cancelled(signal)
  if(attachment.bytes!==original.descriptor.byteLength)throw new MediaError('integrity-failed')
  return immutable({format:'dsh-media-native-v1',descriptor:original.descriptor,attachment})
 }catch(error){throw storageFailure(error,signal)}
}
/**
 * Export one complete original only after all bytes and the digest have been verified.
 * @param store - native verbatim attachment provider.
 * @param stored - trusted receipt, parsed first when received from a durable or wire source.
 * @param spec - maximum complete export bytes and stream policy.
 * @param signal - cancellation of this read only.
 * @returns an owned exact original, after checking its signature and metadata again; no re-encoding or resizing is performed.
 */
export async function readNativeOriginal(store:VerbatimAttachmentStore,stored:NativeStoredOriginal,spec:NativeStorageSpec,signal:AbortSignal):Promise<OriginalMedia>{
 cancelled(signal)
 admitted(stored.descriptor,spec)
 const bytes=new Uint8Array(stored.descriptor.byteLength),hash=createHash('sha256');let total=0
 try{
  for await(const chunk of store.readFileStream({...stored.attachment},signal)){
   cancelled(signal);total+=chunk.byteLength
   if(total>stored.descriptor.byteLength||total>spec.maxReadBytes)throw new MediaError('integrity-failed')
   bytes.set(chunk,total-chunk.byteLength);hash.update(chunk)
  }
  cancelled(signal)
  if(total!==stored.descriptor.byteLength||hash.digest('hex')!==stored.descriptor.sha256)throw new MediaError('integrity-failed')
  let textMime:InspectionRequest['textMime']
  if(stored.descriptor.detectedBy==='declared-text'){const mime=stored.descriptor.mime;if(mime!=='text/plain'&&mime!=='text/html'&&mime!=='application/json')throw new MediaError('integrity-failed');textMime=mime}
  const original=await inspectOwnedOriginal(spec.inspection,{bytes,source:stored.descriptor.source,fileName:stored.descriptor.fileName,...textMime===undefined?{}:{textMime}},signal),actual=original.descriptor,expected=stored.descriptor
  if(actual.mime!==expected.mime||actual.extension!==expected.extension||actual.detectedBy!==expected.detectedBy||actual.fileName!==expected.fileName||actual.image?.width!==expected.image?.width||actual.image?.height!==expected.image?.height||actual.image?.orientation!==expected.image?.orientation)throw new MediaError('integrity-failed')
  return original
 }catch(error){throw storageFailure(error,signal)}
}
