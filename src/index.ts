/** Neutral media byte inspection; importing the library opens no files and starts no application. */
export type * from './types.ts'
export {MediaError} from './errors.ts'
export {resolveInspection,mediaProvider,mediaSource} from './config.ts'
export {inspectOriginal,createUnclassifiedOriginal} from './inspect.ts'
