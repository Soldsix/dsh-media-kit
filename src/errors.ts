/** Sanitized media operation failures. */
import type {MediaFailure} from './types.ts'
/** A stable operational code without source material. */
export class MediaError extends Error{constructor(readonly code:MediaFailure){super('Media: '+code)}}
