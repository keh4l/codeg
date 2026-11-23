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
  getActiveRemoteConnectionId,
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

// A remote-desktop window loads referenced images through the app's own
// loopback listener (`remote_image_base`, `commands/remote_images.rs`), which
// fetches them from the remote server with the connection's credentials. Its
// base URL is asked for once; until it is known, requests ask for inline data.
let remoteImageBase: string | null = null
let remoteImageBaseRequested = false

function remoteImageUrlBase(): string | null {
  const connectionId = getActiveRemoteConnectionId()
  if (connectionId === null) return null
  if (remoteImageBase) return `${remoteImageBase}/${connectionId}`
  if (!remoteImageBaseRequested) {
    remoteImageBaseRequested = true
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("remote_image_base"))
      .then((base) => {
        remoteImageBase = base
      })
      .catch(() => {
        // An app without the command (older build): keep inline images.
      })
  }
  return null
}

/**
 * Whether this client asks the server for image references: the web client,
 * and a remote-desktop window once its image listener is up. The local
 * desktop app reads its own disk; nothing crosses a network.
 */
export function wantsImageRefs(): boolean {
  if (typeof window === "undefined") return false
  if (isRemoteDesktopMode()) return remoteImageUrlBase() !== null
  return !isDesktop()
}

/**
 * Whether a remote-desktop window can take images by reference: its image
 * listener is up (asked for on first use). What its event stream offers the
 * server as `wire: 2` (fork).
 */
export function remoteWindowTakesImageRefs(): boolean {
  return typeof window !== "undefined" && remoteImageUrlBase() !== null
}

/** @internal Test-only. */
export function __setRemoteImageBaseForTests(base: string | null): void {
  remoteImageBase = base
  remoteImageBaseRequested = base !== null
}

/** Whether the image carries anything to show. */
export function hasImage(img: ImageSource | null | undefined): boolean {
  return !!img && (!!img.data || !!img.blob)
}

/**
 * `src` for an `<img>`: a `data:` URL, or the blob's URL on the server.
 * `"thumb"` (inline chips and cards) asks for the server's 512 px thumbnail
 * when the image has one; the preview dialog and every byte consumer use the
 * full image.
 */
export function imageSrc(
  img: ImageSource | null | undefined,
  variant: "full" | "thumb" = "full"
): string {
  if (!img) return ""
  if (img.data) return `data:${img.mime_type};base64,${img.data}`
  if (img.blob) {
    const query = variant === "thumb" && img.blob.thumb ? "?thumb=512" : ""
    if (isRemoteDesktopMode()) {
      const base = remoteImageUrlBase()
      return base ? `${base}/${img.blob.id}${query}` : ""
    }
    return `${getServerBaseUrl()}/api/img/${img.blob.id}${query}`
  }
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
