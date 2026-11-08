/** Prepare the archive destination on clean checkouts. */
import {mkdir} from 'node:fs/promises'
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true})
