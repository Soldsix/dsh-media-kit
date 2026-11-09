---
kind: package-library
description: Preserve original media bytes and isolate conversation references for DSH plugins.
---

# dsh-media-kit

## Summary

Original media inspection, native verbatim attachment storage and scoped opaque references for DSH plugin consumers. This independent library has no bundle, GUI, model client or application launcher. No production data is included.

## Table of Contents

- [Media inspection](#media-inspection)
- [Native storage](#native-storage)
- [Scoped references](#scoped-references)
- [Example](#example)
- [Verification and limitations](#verification-and-limitations)

## Media inspection

`inspectOriginal` copies caller bytes before asynchronous work, detects the binary signature, checks configured MIME/byte/dimension limits and computes SHA256 over the complete original. Filename extensions do not determine the format. Exported byte copies cannot mutate the retained original. Image header inspection is not a full decoder or malware check; no resizing, rotation or recompression occurs.

Detection uses [file-type](https://github.com/sindresorhus/file-type); image headers use [image-size](https://codeberg.org/image-size/image-size). MIME allowlists contain explicit essences such as `audio/ogg`; codec parameters in detector results remain metadata. Valid UTF-8 plain text, HTML and JSON can be explicitly declared when no binary signature is present. The inspector refuses unknown binary formats. To retain unknown codecs, a Host can explicitly call `createUnclassifiedOriginal` with an `application/octet-stream` allowance; the result stays unclassified and makes no playback or format-verification claim. Text files are never executed.

## Native storage

The optional `dsh-media-kit/dsh-attachments` entry uses the public DSH `saveFileStream` and `readFileStream` APIs. It stores every media type as a verbatim file rather than calling the image-normalization path. Canonical backing names allow equivalent byte inputs with different display names to share the native object; the display filename stays in separate metadata.

`saveNativeOriginal` returns a versioned Host-only receipt. Native attachment identifiers stay opaque; the adapter does not assume they equal an unprefixed hash. `parseNativeOriginal` validates durable records. `readNativeOriginal` checks complete byte count, digest, signature and image metadata before returning an owned original. Changed bytes or inconsistent dimensions fail. Explicitly unclassified originals only undergo byte and label validation; no codec is inferred. The native backend owns files and retention; the library does not derive paths, open its files directly or delete them. Storage failures expose stable codes without backend paths or exception bodies.

## Scoped references

The optional `dsh-media-kit/scoped-native` entry provides `ScopedNativeMedia`. The consuming Host binds an exact authenticated scope; models must never choose it. `register` issues a random 256-bit handle, and foreign or unknown handles return the same not-found code. Public views omit backend and source identifiers. Quotas cover references, unique tracked original bytes, leases and concurrent exports. Admission refuses excess work and never evicts another reference.

Acquire a lease before reading. Revocation refuses leased references. Release cancels and joins only its own reads; close stops admission and joins all leased reads before clearing the in-memory index. It does not delete original attachments. Logical byte counts are not a quota on the shared backend's entire disk usage.

The book does not own a metadata database. The consumer must persist `exportGrant` in its own owner journal before exposing a reference outside the process, then restore trusted records after restart. `restore` is not a model or ordinary-member operation. Validate request identity and output disclosure in the consuming plugin. Model-visible handles and metadata must be recorded in that plugin's DSH session events. This library cannot sandbox malicious Host code or privileged filesystem users.

## Example

```ts
import {inspectOriginal, resolveInspection, mediaProvider, mediaSource} from 'dsh-media-kit'
import {saveNativeOriginal, resolveNativeStorage} from 'dsh-media-kit/dsh-attachments'
import {ScopedNativeMedia, resolveReferences, mediaScope} from 'dsh-media-kit/scoped-native'

const policy = {
  maxBytes: 8 * 1024 * 1024, maxDetectorBuffer: 1024 * 1024,
  maxWidth: 8192, maxHeight: 8192, maxPixels: 32_000_000,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'audio/wav'],
}
const inspection = resolveInspection(policy)
const storage = resolveNativeStorage({chunkBytes: 65536, maxReadBytes: policy.maxBytes, inspection: policy})
// bytes, signal, attachments and persistToOwnerJournal are supplied by your Host plugin.
const original = await inspectOriginal(inspection, {
  bytes, fileName: 'incoming.jpg',
  source: {provider: mediaProvider('example'), id: mediaSource('input-1'), kind: 'received'},
}, signal)
const stored = await saveNativeOriginal(attachments, original, storage, signal)
const book = new ScopedNativeMedia(resolveReferences({
  maxReferences: 100, maxOriginalBytes: 64 * 1024 * 1024, maxLeases: 4, maxConcurrentReads: 2,
}), attachments, storage)
const owner = mediaScope('authenticated-account-and-conversation')
const reference = book.register(owner, stored)
await persistToOwnerJournal(book.exportGrant(owner, reference))
const lease = book.acquire(owner, reference)
try { const exactBytes = (await lease.read(signal)).copyBytes() } finally { await lease.release() }
await book.close()
```

The snippet is a library integration sketch, not a standalone application. Supported DSH applications still launch through profiles. Peer APIs target DSH 0.2.2-rc.1; the native entries require its attachment capability. All capacities are supplied by the consumer rather than hidden deployment defaults.

## Verification and limitations

Local Node 24 tests cover signature/suffix disagreement, immutable original copies, text and WAV data, scoped grants, capacity and lease cleanup, real native attachment restart, integrity failures, 1080p/2K/4K PNG originals and a two-frame GIF. All original-byte comparisons are exact. The GIF and large images are generated fixtures, not user assets. No model requests or QQ messages are sent.

The clean consumer test installs the archive, verifies installed files and strict NodeNext declarations, and mounts the real native attachment service. This repository defines Windows/Linux × Node 22/24 CI; release notes record observed results. The consuming offline-lab plugin delivers its media adapter separately. This is not evidence of OCR accuracy, image identity recognition, voice playback, full video decoding or superiority over other projects. No real QQ, desktop or competitor runtime comparison has been performed.

## Dev Note

This library has no profile-install command; consuming plugins declare a dependency and choose the required public entries.
