/** The optional messaging entries compile against their independently installed peers. */
import type {} from 'dsh-media-kit/im-cordis'
import type {Context} from '@deepseek-ai/cordis'
import {ImMediaRuntime,resolveImMedia,type ImMediaProvider} from 'dsh-media-kit/im'
import {NativeImMediaProvider,type NativeImMediaOptions} from 'dsh-media-kit/im-native'
import type {ConversationScope,AttachmentId} from 'dsh-im-kit'
import type {OriginalMedia} from 'dsh-media-kit'
export function create(options:NativeImMediaOptions):ImMediaProvider{return new NativeImMediaProvider(options)}
export function read(runtime:ImMediaRuntime,scope:ConversationScope,ref:AttachmentId,signal:AbortSignal):Promise<OriginalMedia>{return runtime.read(scope,ref,signal)}
export const limits=resolveImMedia({maxProviders:2,maxPendingPerProvider:8})
export const fromContext=(ctx:Context):ImMediaRuntime=>ctx.imMedia
