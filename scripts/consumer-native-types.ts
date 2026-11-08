/** Both native subpaths compile against the installed public attachment interface. */
import type {OriginalMedia} from 'dsh-media-kit'
import {saveNativeOriginal,readNativeOriginal,type VerbatimAttachmentStore,type NativeStorageSpec} from 'dsh-media-kit/dsh-attachments'
import {ScopedNativeMedia,type ReferenceSpec,type MediaScope} from 'dsh-media-kit/scoped-native'
export async function useNative(store:VerbatimAttachmentStore,original:OriginalMedia,spec:NativeStorageSpec,limits:ReferenceSpec,owner:MediaScope,signal:AbortSignal):Promise<OriginalMedia>{
 const stored=await saveNativeOriginal(store,original,spec,signal),book=new ScopedNativeMedia(limits,store,spec),ref=book.register(owner,stored),lease=book.acquire(owner,ref)
 try{return await lease.read(signal)}finally{await lease.release();await book.close()}
}
export const read=readNativeOriginal
