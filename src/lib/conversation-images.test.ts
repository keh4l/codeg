import { afterEach, describe, expect, it, vi } from "vitest"
import {
  base64ByteLength,
  hasImage,
  imageIdentity,
  imageKey,
  imageSrc,
  loadImageBase64,
  wantsImageRefs,
  withInlineImages,
} from "./conversation-images"

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const PNG_B64 = btoa(String.fromCharCode(...PNG_BYTES))
const REF = { id: "0123456789abcdef0123456789abcdef", bytes: PNG_BYTES.length }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("conversation-images", () => {
  it("asks for references on the web client", () => {
    expect(wantsImageRefs()).toBe(true)
  })

  it("renders inline data as a data: URL and a reference as its server URL", () => {
    expect(imageSrc({ data: PNG_B64, mime_type: "image/png" })).toBe(
      `data:image/png;base64,${PNG_B64}`
    )
    expect(imageSrc({ blob: REF, mime_type: "image/png" })).toBe(
      `${window.location.origin}/api/img/${REF.id}`
    )
    expect(imageSrc(null)).toBe("")
    expect(hasImage({ blob: REF, mime_type: "image/png" })).toBe(true)
    expect(hasImage({ mime_type: "image/png" })).toBe(false)
  })

  it("gives an image the same identity inline and by reference", () => {
    expect(base64ByteLength(PNG_B64)).toBe(PNG_BYTES.length)
    expect(base64ByteLength("YQ==")).toBe(1)
    expect(imageIdentity({ data: PNG_B64, mime_type: "image/png" })).toBe(
      imageIdentity({ blob: REF, mime_type: "image/png" })
    )
    expect(imageKey({ blob: REF, mime_type: "image/png" })).toBe(
      `blob:${REF.id}`
    )
  })

  it("fetches a referenced image's bytes for copy, download and export", async () => {
    const fetchMock = vi.fn(async () => new Response(PNG_BYTES))
    vi.stubGlobal("fetch", fetchMock)

    expect(await loadImageBase64({ blob: REF, mime_type: "image/png" })).toBe(
      PNG_B64
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/api/img/${REF.id}`
    )

    const turns = [
      {
        blocks: [
          { type: "text", text: "hi" },
          { type: "image", blob: REF, mime_type: "image/png" },
          {
            type: "image_generation",
            image: { blob: REF, mime_type: "image/png" },
          },
        ],
      },
    ]
    const inline = await withInlineImages(turns)
    expect(inline[0].blocks[1]).toMatchObject({ data: PNG_B64, blob: REF })
    expect(
      (inline[0].blocks[2] as { image: { data: string } }).image.data
    ).toBe(PNG_B64)
    // The input is left as it was.
    expect(turns[0].blocks[1]).not.toHaveProperty("data")
  })
})
