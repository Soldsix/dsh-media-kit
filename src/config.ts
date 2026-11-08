/** Configuration and metadata parsers, without filesystem access. */
import {z} from 'zod'
import {MIMEType} from 'node:util'
import type {InspectionConfig,InspectionSpec,MediaProviderId,MediaSourceId,MediaSource} from './types.ts'
import {MediaError} from './errors.ts'
const positive=z.number().int().positive().safe()
const config=z.strictObject({maxBytes:positive,maxDetectorBuffer:positive,maxWidth:positive,maxHeight:positive,maxPixels:positive,allowedMimeTypes:z.array(z.string().refine(value=>{try{const mime=new MIMEType(value);return mime.essence===value&&!value.includes('*')&&[...mime.params].length===0}catch(error){return false}})).min(1)})
const provider=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u).transform(value=>value as MediaProviderId)
const sourceId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}$/u).refine(value=>!value.split('/').includes('..')).transform(value=>value as MediaSourceId)
/** Validate source identities at durable and wire entry points. */
export const sourceSchema:z.ZodType<MediaSource>=z.strictObject({provider,id:sourceId,kind:z.enum(['received','generated','downloaded','fixture'])})
/** @param value - raw deployment settings. @returns a specification with explicit capacities and allowed formats. */
export function resolveInspection(value:InspectionConfig):InspectionSpec{
 const parsed=config.safeParse(value);if(!parsed.success)throw new MediaError('invalid-data')
 if(parsed.data.maxDetectorBuffer>parsed.data.maxBytes||new Set(parsed.data.allowedMimeTypes).size!==parsed.data.allowedMimeTypes.length)throw new MediaError('invalid-data')
 return{...parsed.data,allowedMimeTypes:new Set(parsed.data.allowedMimeTypes)}
}
/** @param value - provider label from configuration or source metadata. @returns validated provider identity. */
export function mediaProvider(value:string):MediaProviderId{const parsed=provider.safeParse(value);if(!parsed.success)throw new MediaError('invalid-data');return parsed.data}
/** @param value - provider-local identity without credentials or filesystem syntax. @returns validated source identity. */
export function mediaSource(value:string):MediaSourceId{const parsed=sourceId.safeParse(value);if(!parsed.success)throw new MediaError('invalid-data');return parsed.data}
