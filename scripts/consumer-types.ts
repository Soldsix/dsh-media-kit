/** Public root entry compiles without importing native attachment peers. */
import {inspectOriginal,resolveInspection,type InspectionRequest,type OriginalMedia} from 'dsh-media-kit'
const policy=resolveInspection({maxBytes:1024,maxDetectorBuffer:1024,maxWidth:100,maxHeight:100,maxPixels:10000,allowedMimeTypes:['image/png']})
const read=(request:InspectionRequest,signal:AbortSignal):Promise<OriginalMedia>=>inspectOriginal(policy,request,signal)
export {read}
