/** Signature and header inspection preserves every original byte. */
import {createHash} from 'node:crypto'
import {MIMEType} from 'node:util'
import {fileTypeFromBuffer} from 'file-type'
import {imageSize} from 'image-size'
import {z} from 'zod'
import {sourceSchema} from './config.ts'
import {MediaError} from './errors.ts'
import type {InspectionRequest,InspectionSpec,OriginalDescriptor,OriginalMedia,MediaDigest,ImageDimensions} from './types.ts'
const labels=z.strictObject({source:sourceSchema,fileName:z.string().min(1).max(255).refine(value=>!/[\\/:\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)&&value!=='.'&&value!=='..').optional(),textMime:z.enum(['text/plain','text/html','application/json']).optional()})
class OwnedOriginal implements OriginalMedia{
 readonly #bytes:Uint8Array
 constructor(bytes:Uint8Array,readonly descriptor:OriginalDescriptor){this.#bytes=bytes}
 copyBytes():Uint8Array{return new Uint8Array(this.#bytes)}
}
function cancelled(signal:AbortSignal):void{if(signal.aborted)throw new MediaError('cancelled')}
function name(label:string|undefined,extension:string):string{
 if(label===undefined)return'media.'+extension
 const base=label.replace(/\.[^.]*$/u,'');return(base||'media')+'.'+extension
}
/**
 * Inspect a bounded byte copy using signatures and image headers, without decoding or transformation.
 * @param spec - explicit resolved capacities and accepted MIME types.
 * @param request - original bytes and source labels; text MIME is accepted only for valid UTF-8 without a binary signature.
 * @param signal - cancellation of this inspection.
 * @returns isolated original bytes and immutable metadata; signature detection is not a complete decoder or malware check.
 */
export async function inspectOwnedOriginal(spec:InspectionSpec,request:InspectionRequest,signal:AbortSignal):Promise<OriginalMedia>{
 cancelled(signal)
 if(request.bytes.byteLength===0)throw new MediaError('invalid-data')
 if(request.bytes.byteLength>spec.maxBytes)throw new MediaError('too-large')
 const parsed=labels.safeParse({source:request.source,...request.fileName===undefined?{}:{fileName:request.fileName},...request.textMime===undefined?{}:{textMime:request.textMime}})
 if(!parsed.success)throw new MediaError('invalid-data')
 const bytes=request.bytes,input=parsed.data
 let detected:Awaited<ReturnType<typeof fileTypeFromBuffer>>
 try{detected=await fileTypeFromBuffer(bytes,{signal,maxBufferSize:spec.maxDetectorBuffer})}catch(error){cancelled(signal);throw new MediaError('malformed-media')}
 cancelled(signal)
 let mime:string,extension:string,detectedBy:'signature'|'declared-text'
 if(detected){mime=detected.mime;extension=detected.ext;detectedBy='signature'}
 else{
  if(!input.textMime)throw new MediaError('unsupported-type')
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch(error){throw new MediaError('malformed-media')}
  if(text.includes('\u0000'))throw new MediaError('malformed-media')
  if(input.textMime==='application/json'){try{JSON.parse(text)}catch(error){throw new MediaError('malformed-media')}}
  mime=input.textMime;extension=mime==='text/html'?'html':mime==='application/json'?'json':'txt';detectedBy='declared-text'
 }
 const essence=new MIMEType(mime).essence
 if(!spec.allowedMimeTypes.has(essence))throw new MediaError('unsupported-type')
 let image:ImageDimensions|undefined
 if(mime.startsWith('image/')){
  let dimensions:ReturnType<typeof imageSize>;try{dimensions=imageSize(bytes)}catch(error){throw new MediaError('malformed-media')}
  const {width,height,orientation}=dimensions
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new MediaError('malformed-media')
  if(width>spec.maxWidth||height>spec.maxHeight||width*height>spec.maxPixels)throw new MediaError('too-large')
  if(orientation!==undefined&&(!Number.isSafeInteger(orientation)||orientation<1||orientation>8))throw new MediaError('malformed-media')
  image=Object.freeze({width,height,...orientation===undefined?{}:{orientation}})
 }
 cancelled(signal)
 const descriptor:OriginalDescriptor=Object.freeze({sha256:createHash('sha256').update(bytes).digest('hex') as MediaDigest,byteLength:bytes.byteLength,mime,extension,fileName:name(input.fileName,extension),detectedBy,source:Object.freeze({...input.source}),...image?{image}:{}})
 return new OwnedOriginal(bytes,descriptor)
}
/** @param spec - resolved inspection policy. @param request - caller-owned original and source labels. @param signal - inspection cancellation. @returns an isolated original; caller buffers are copied before asynchronous work. */
export async function inspectOriginal(spec:InspectionSpec,request:InspectionRequest,signal:AbortSignal):Promise<OriginalMedia>{
 cancelled(signal)
 if(request.bytes.byteLength===0)throw new MediaError('invalid-data')
 if(request.bytes.byteLength>spec.maxBytes)throw new MediaError('too-large')
 return inspectOwnedOriginal(spec,{...request,bytes:new Uint8Array(request.bytes)},signal)
}
