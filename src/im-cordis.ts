/** Optional type-only Cordis service declaration for original IM media. */
import type {} from '@deepseek-ai/cordis'
import type {ImMediaRuntime} from './im.ts'

/** The selected provider plugin contributes this service through its scoped lifecycle. */
export interface ImMediaContext{readonly imMedia:ImMediaRuntime}

declare module '@deepseek-ai/cordis'{interface Context extends ImMediaContext{}}
