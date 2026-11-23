// Images in conversation payloads: inline base64, or a reference to the
// server's blob store (fork, `src-tauri/src/web/blob_store.rs`).
//
// A client that asks for `imageRefs` gets `{ mime_type, blob: { id, … } }` in
// place of `{ mime_type, data }` and loads the bytes from `/api/img/{id}`. The
// URL never changes for the same bytes, so the browser's HTTP cache serves
// every later open — which matters on a plain-http origin, where Cache
// Storage is unavailable. Everything that reads an image goes through here
// so it works with either form.

import {
  getServerBaseUrl,
  isDesktop,
  isRemoteDesktopMode,
} from "@/lib/transport"
import type { ImageBlobRef } from "@/lib/types"

export interface ImageSource {
  data?: string
  blob?: ImageBlobRef
  mime_type: string
}

/**
 * Whether this client asks the server for image references. The web client
 * only: the desktop app reads its own disk (nothing crosses a network), and a
 * remote-desktop window cannot load the remote host's URLs directly.
 */
export function wantsImageRefs(): boolean {
  return typeof window !== "undefined" && !isDesktop() && !isRemoteDesktopMode()
}

/** Whether the image carries anything to show. */
export function hasImage(img: ImageSource | null | undefined): boolean {
  return !!img && (!!img.data || !!img.blob)
}

/** `src` for an `<img>`: a `data:` URL, or the blob's URL on the server. */
export function imageSrc(img: ImageSource | null | undefined): string {
  if (!img) return ""
  if (img.data) return `data:${img.mime_type};base64,${img.data}`
  if (img.blob) return `${getServerBaseUrl()}/api/img/${img.blob.id}`
  return ""
}

/** Decoded size in bytes of a base64 string (no decoding). */
export function base64ByteLength(data: string): number {
  const trimmed = data.replace(/\s+/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

/**
 * Identity of an image that is the same whether it arrived inline or as a
 * reference: its type and decoded size. Used where the same message can
 * come back in the other form (a live prompt vs. its persisted copy).
 */
export function imageIdentity(img: ImageSource): string {
  const bytes = img.blob
    ? img.blob.bytes
    : img.data
      ? base64ByteLength(img.data.replace(/^data:[^,]*,/, ""))
      : 0
  return `${img.mime_type}:${bytes}`
}

/** Key for de-duplicating images within one payload (same form throughout). */
export function imageKey(img: ImageSource): string {
  if (img.blob) return `blob:${img.blob.id}`
  const data = img.data ?? ""
  return `${img.mime_type}:${data.length}:${data.slice(0, 64)}`
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

/** The image's base64, fetching a referenced one (copy, download, export). */
export async function loadImageBase64(img: ImageSource): Promise<string> {
  if (img.data) return img.data
  if (!img.blob) throw new Error("image has no data")
  const res = await fetch(imageSrc(img))
  if (!res.ok) throw new Error(`image ${img.blob.id}: HTTP ${res.status}`)
  return bytesToBase64(new Uint8Array(await res.arrayBuffer()))
}

/**
 * Copy of `value` with every referenced image's `data` filled in, for code
 * that needs the bytes of a whole conversation (export).
 */
export async function withInlineImages<T>(value: T): Promise<T> {
  const pending: Promise<void>[] = []
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit)
    if (!node || typeof node !== "object") return node
    const obj = node as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(obj)) out[key] = visit(child)
    const blob = obj.blob as ImageBlobRef | undefined
    if (
      blob &&
      typeof blob === "object" &&
      typeof blob.id === "string" &&
      typeof obj.mime_type === "string" &&
      !obj.data
    ) {
      pending.push(
        loadImageBase64({ blob, mime_type: obj.mime_type }).then(
          (data) => {
            out.data = data
          },
          () => {}
        )
      )
    }
    return out
  }
  const copy = visit(value) as T
  await Promise.all(pending)
  return copy
}
