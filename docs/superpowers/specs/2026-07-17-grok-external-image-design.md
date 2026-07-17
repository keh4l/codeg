# Grok External Image Attachment Design

## Goal

Ensure every image that a user explicitly attaches reaches an image-capable ACP
agent, including Grok, as an ACP `image` content block instead of a Markdown
`file://` path that the agent must read through the workspace-confined text file
API.

## Confirmed failure

The failing upload flow stores a local image below Codeg's global uploads root,
then inserts its absolute path as a file reference. Composer serialization turns
that reference into a single text block. Grok therefore receives no image bytes,
tries `fs/read_text_file`, and Codeg correctly rejects the path because it is
outside the session workspace. Moving the file inside the workspace is not a
complete answer because `fs/read_text_file` only accepts UTF-8 text.

The existing paste and drag flows already demonstrate the compatible protocol:
they base64-encode the selected image and produce an ACP `image` block, which
Grok can see.

## Design

### Attachment classification

All user-facing attachment entry points use the same image classification rule:
prefer `File.type`, then fall back to the existing filename-extension MIME map.
When the connected agent has effective image capability, an image is converted
to the existing `ImageInputAttachment` representation. Non-images and images
for agents without image capability retain the current resource/upload behavior.

### Grok capability compatibility

Live ACP validation with Grok 0.2.102 found that it advertises
`promptCapabilities.image=false` while successfully accepting `ImageContent`,
reading its base64 payload, and making no filesystem request. Codeg therefore
normalizes the effective image capability to true for Grok only. Other agents
continue to follow their advertised value exactly. This is an adapter protocol
compatibility correction, not a filesystem permission bypass.

The following paths are covered:

- browser and remote-desktop "Upload local file" `File` objects;
- local desktop native picker paths;
- server file picker paths;
- local and remote desktop native drag paths;
- existing browser drag and clipboard paths;
- whole-file "attach to session" events.

### Image data flow

Browser `File` objects are encoded directly with the existing `blobToBase64`
path. Native or server paths are read only after an explicit user selection,
using the existing bounded base64 reader. Remote-desktop native paths use the
local Tauri shell transport so the selected local file is read on the desktop,
not interpreted as a path on the remote server.

The outgoing draft contains `{ type: "image", data, mime_type, uri }`. The URI is
metadata only; the base64 data is the authoritative image content. The backend's
existing one-to-one ACP mapping remains unchanged.

### Security boundaries

This change does not modify `FileSystemRuntime`, expand the workspace root, add
the uploads directory to an allowlist, or grant Grok direct access to arbitrary
paths. A file is read only because the user selected or dropped it in Codeg, and
the existing image size bound applies before the bytes enter composer state.

Remote and non-image files continue through the current upload and resource-link
flows. The implementation must not use Grok shell commands, copy files into the
project, or expose the entire Codeg uploads directory.

### Lifecycle and cleanup

Images handled by the new path are not persisted to the global uploads root.
Their base64 payload lives in the existing React attachment state. Removing an
attachment drops it from that state; send, queue-save, or fork-send calls the
existing composer reset; and unmount releases the component state. Failed reads
do not append a partial attachment or create a server-side upload.

For a mixed selection, successfully read images and successfully uploaded
resources remain usable even if another item fails, matching the current
best-effort attachment behavior. Existing uploads created by older sessions are
not migrated or deleted.

## Error handling

- Preserve the existing per-file failure logging and user-facing upload toasts.
- Reject oversized native-path images through the bounded reader without
  falling back to a path-only image attachment.
- Do not silently convert an image to a Markdown link when image encoding fails.
- Keep current behavior when an agent has no effective image capability.

## Regression tests

Tests are written before production changes and must first reproduce the current
failure.

1. "Upload local file" with an external PNG and image capability sends an
   `image` block containing base64 and does not call the upload API.
2. The same entry with a non-image still calls the existing upload/resource
   path.
3. An agent without image capability retains the existing resource fallback.
4. Native and server path routing classifies supported image extensions as image
   inputs and keeps non-images as resources.
5. Removing or sending an image clears its in-memory attachment payload, and a
   failed/oversized read creates neither an image block nor an upload artifact.
6. Existing backend tests continue to prove that arbitrary paths outside the
   workspace are rejected.

## Non-goals

- Changing ACP filesystem permissions or adding binary support to
  `fs/read_text_file`.
- Migrating historical uploaded attachments.
- Changing attachment limits for non-image files.
- Adding broad per-agent capability bypasses beyond the evidence-backed Grok
  image compatibility correction.
