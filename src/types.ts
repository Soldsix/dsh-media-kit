/** Original-byte inspection types shared by media providers and consumers. */
import type {Branded} from '@deepseek-ai/dsh-brand'
/** Hash of the complete original bytes, independent of filenames. */
export type MediaDigest=Branded<'media.sha256'>
/** A provider identifier, without credentials or local file locations. */
export type MediaProviderId=Branded<'media.provider'>
/** A provider-local opaque source identity, never a filesystem path. */
export type MediaSourceId=Branded<'media.source'>
/** Source identity is retained separately from inferred content metadata. */
export interface MediaSource{readonly provider:MediaProviderId;readonly id:MediaSourceId;readonly kind:'received'|'generated'|'downloaded'|'fixture'}
/** Deployment limits are required and explicitly resolved before inspection. */
export interface InspectionConfig{readonly maxBytes:number;readonly maxDetectorBuffer:number;readonly maxWidth:number;readonly maxHeight:number;readonly maxPixels:number;readonly allowedMimeTypes:readonly string[]}
/** Validated inspection settings. */
export interface InspectionSpec extends Omit<InspectionConfig,'allowedMimeTypes'>{readonly allowedMimeTypes:ReadonlySet<string>}
/** Input labels never determine a binary signature. */
export interface InspectionRequest{readonly bytes:Uint8Array;readonly source:MediaSource;readonly fileName?:string;readonly textMime?:'text/plain'|'text/html'|'application/json'}
/** Header dimensions describe encoded pixels; no rotation, resizing or recompression is performed. */
export interface ImageDimensions{readonly width:number;readonly height:number;readonly orientation?:number}
/** Public metadata excludes the host filesystem and all raw bytes. */
export interface OriginalDescriptor{readonly sha256:MediaDigest;readonly byteLength:number;readonly mime:string;readonly extension:string;readonly fileName:string;readonly detectedBy:'signature'|'declared-text';readonly source:MediaSource;readonly image?:ImageDimensions}
/** An owned original whose internal bytes cannot be mutated by a caller. */
export interface OriginalMedia{
 readonly descriptor:OriginalDescriptor
 /** @returns an independent exact copy, suitable for later storage or sending. */
 copyBytes():Uint8Array
}
/** Sanitized errors never include source names, labels, bytes or paths. */
export type MediaFailure='invalid-data'|'too-large'|'unsupported-type'|'malformed-media'|'cancelled'|'storage-unavailable'|'storage-unsupported'|'integrity-failed'|'not-found'|'capacity'|'closed'|'busy'|'source-conflict'
