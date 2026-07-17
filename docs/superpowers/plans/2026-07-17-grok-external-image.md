# Grok External Image Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send every explicitly attached image to image-capable ACP agents as an
inline image block without weakening Codeg's workspace filesystem boundary.

**Architecture:** Reuse the existing `ImageInputAttachment` and ACP image
mapping. Centralize MIME-based file/path partitioning, route each UI attachment
entry through it, and read remote-desktop local image paths through the existing
bounded local Tauri command without uploading them. Non-images and agents without
image capability retain their current resource/upload behavior.

**Tech Stack:** React 19, TypeScript strict mode, Vitest, Testing Library, Tauri
transport helpers, Rust filesystem regression tests.

## Global Constraints

- Work only in `/www/gitroot/codeg-worktrees/issue-grok-external-image` on
  `codex/issue-grok-external-image`.
- Write and run a failing regression test before every production behavior
  change.
- Do not expand `FileSystemRuntime`, allowlist the global uploads root, copy an
  image into the project, or invoke Grok shell workarounds.
- Do not modify, merge, or reset `main`; do not push, deploy, or restart
  `codeg-prod`.
- Keep non-image attachment behavior and existing upload quotas unchanged.

---

### Task 1: Reproduce the local-upload regression and route image `File` objects inline

**Files:**
- Modify: `src/components/chat/message-input.test.tsx`
- Modify: `src/components/chat/message-input.tsx:1988-2003`

**Interfaces:**
- Consumes: existing `appendFilesFromInput(files: File[]): Promise<void>`.
- Produces: "Upload local file" sends image-capable agents an image block and
  keeps non-images on `uploadAndAppendFiles` through `appendFilesAsResources`.

- [ ] **Step 1: Add a failing component regression test**

  Add a hoisted partial mock for `uploadAttachment`, intercept the transient
  `<input type="file">`, provide a PNG `File`, click the upload menu item, then
  send. Assert the draft contains one image block with `mime_type: "image/png"`
  and base64 data, contains no `file://` text link, and `uploadAttachment` was not
  called.

  ```tsx
  const png = new File(["pixels"], "outside.png", { type: "image/png" })
  // Trigger the menu's transient input onchange with `png`.
  await user.click(screen.getByText(enMessages.Folder.chat.messageInput.attachLocalUpload))
  await user.click(screen.getByTitle(enMessages.Folder.chat.messageInput.send))
  expect(onSend).toHaveBeenCalledWith(
    expect.objectContaining({
      blocks: [
        expect.objectContaining({
          type: "image",
          mime_type: "image/png",
          data: "cGl4ZWxz",
        }),
      ],
    }),
    null
  )
  expect(uploadAttachmentMock).not.toHaveBeenCalled()
  ```

- [ ] **Step 2: Run the test and verify RED**

  Run:

  ```bash
  pnpm exec vitest run src/components/chat/message-input.test.tsx -t "sends an uploaded image as inline image data"
  ```

  Expected: FAIL because the current handler calls `uploadAttachment` and emits a
  Markdown `file://` reference instead of an image block.

- [ ] **Step 3: Make the smallest production change**

  Route the transient file input through the existing classifier:

  ```tsx
  input.onchange = async () => {
    const all = input.files ? Array.from(input.files) : []
    await appendFilesFromInput(all)
  }
  ```

  Update the callback dependencies and comments. Do not modify the image ACP
  mapping.

- [ ] **Step 4: Verify GREEN and non-image fallback**

  Add a second test with `notes.txt` that asserts `uploadAttachment` is called
  and no image block is produced. Run the complete file:

  ```bash
  pnpm exec vitest run src/components/chat/message-input.test.tsx
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit the task**

  ```bash
  git add src/components/chat/message-input.test.tsx src/components/chat/message-input.tsx
  git commit -m "fix(chat): inline uploaded images for ACP agents"
  ```

### Task 2: Centralize path classification and cover native/server attachment paths

**Files:**
- Create: `src/components/chat/attachment-routing.ts`
- Create: `src/components/chat/attachment-routing.test.ts`
- Modify: `src/components/chat/message-input.tsx:250-287,1529-1555,1968-2010,2175-2196`

**Interfaces:**
- Produces:

  ```ts
  export interface PartitionedAttachments<T> {
    images: T[]
    resources: T[]
  }

  export function partitionAttachmentFiles(
    files: File[],
    canAttachImages: boolean
  ): PartitionedAttachments<File>

  export function partitionAttachmentPaths(
    paths: string[],
    canAttachImages: boolean
  ): PartitionedAttachments<string>
  ```

- [ ] **Step 1: Add failing pure routing tests**

  Cover a PNG recognized by declared MIME, a PNG recognized by extension when
  MIME is empty, a text file, and an image when capability is disabled. Also
  cover POSIX and Windows-style paths.

  ```ts
  expect(partitionAttachmentPaths(["/outside/a.PNG", "C:\\x\\b.txt"], true))
    .toEqual({ images: ["/outside/a.PNG"], resources: ["C:\\x\\b.txt"] })
  ```

- [ ] **Step 2: Verify RED**

  ```bash
  pnpm exec vitest run src/components/chat/attachment-routing.test.ts
  ```

  Expected: FAIL because the routing module does not exist.

- [ ] **Step 3: Implement the routing module and replace duplicate loops**

  Move the existing MIME extension table and lookup into the focused module,
  implement the two partition functions, and use them from
  `appendFilesFromInput` and `appendPathsFromDrop`.

- [ ] **Step 4: Route user-selected paths through image handling**

  Change the local native picker, server picker, and whole-file session attach
  event to call the existing async path router. Preserve ranged text selections
  as resource references.

  ```tsx
  await appendPathsFromDrop(picked)
  void appendPathsFromDrop(paths).catch(logAttachmentFailure)
  ```

  Add component tests proving a selected `.png` calls the bounded base64 reader
  while `.txt` remains a file reference. Verify a read failure appends no image.

- [ ] **Step 5: Verify GREEN**

  ```bash
  pnpm exec vitest run src/components/chat/attachment-routing.test.ts src/components/chat/message-input.test.tsx
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit the task**

  ```bash
  git add src/components/chat/attachment-routing.ts src/components/chat/attachment-routing.test.ts src/components/chat/message-input.tsx src/components/chat/message-input.test.tsx
  git commit -m "fix(chat): classify selected image paths consistently"
  ```

### Task 3: Keep remote-desktop native image paths in memory instead of uploads

**Files:**
- Modify: `src/lib/api.ts:2410-2446`
- Modify: `src/components/chat/message-input.tsx:1563-1670`
- Modify: `src/components/chat/message-input.test.tsx`
- Test: `src/components/chat/message-input.test.tsx`

**Interfaces:**
- Produces:

  ```ts
  export interface LocalAttachmentFile {
    fileName: string
    mimeType: string | null
    size: number
    dataBase64: string
  }

  export async function readLocalPathForAttachment(
    path: string
  ): Promise<LocalAttachmentFile>
  ```

- [ ] **Step 1: Add a failing remote-path regression test**

  Given remote desktop mode and `[/outside/image.png, /outside/notes.txt]`, assert
  the PNG becomes an in-memory image attachment from
  `read_local_file_for_upload`, while only the text file reaches
  `remote_upload_attachment`.

- [ ] **Step 2: Verify RED**

  ```bash
  pnpm exec vitest run src/components/chat/message-input.test.tsx -t "keeps remote desktop images inline"
  ```

  Expected: FAIL because both paths are currently uploaded and appended as
  resource links.

- [ ] **Step 3: Extract the bounded local reader and reuse it**

  Extract the first shell call from `uploadLocalPathToRemote` into
  `readLocalPathForAttachment`; keep `uploadLocalPathToRemote` behavior unchanged
  by calling the new helper before `remote_upload_attachment`.

- [ ] **Step 4: Partition remote native paths**

  Use `partitionAttachmentPaths`. Convert successful local image reads directly
  into `ImageInputAttachment` values; upload resource paths with the existing
  concurrency, quotas, and toasts. Never fall back to a resource link after an
  image read failure.

- [ ] **Step 5: Verify GREEN and lifecycle behavior**

  Add assertions that removing the image or sending the draft clears its state,
  a second send contains no stale image data, and a failed read invokes no remote
  upload for that image.

  ```bash
  pnpm exec vitest run src/components/chat/attachment-routing.test.ts src/components/chat/message-input.test.tsx
  ```

- [ ] **Step 6: Commit the task**

  ```bash
  git add src/lib/api.ts src/components/chat/message-input.tsx src/components/chat/message-input.test.tsx
  git commit -m "fix(chat): keep remote image attachments inline"
  ```

### Task 4: Verify security, compatibility, and repository gates

**Files:**
- Modify only if a verification failure reveals an issue in files already in
  scope.

**Interfaces:**
- Verifies the outgoing frontend `PromptInputBlock[]` contract and preserves the
  Rust workspace confinement contract.

- [ ] **Step 1: Run focused frontend regressions**

  ```bash
  pnpm exec vitest run src/components/chat/attachment-routing.test.ts src/components/chat/message-input.test.tsx
  ```

- [ ] **Step 2: Run the Rust security regression**

  ```bash
  cd src-tauri
  cargo test --no-default-features --bin codeg-server --lib rejects_path_outside_workspace
  ```

  Expected: the outside-workspace path remains rejected.

- [ ] **Step 3: Run AGENTS.md frontend gates**

  ```bash
  pnpm eslint .
  pnpm test
  pnpm build
  ```

- [ ] **Step 4: Run applicable Rust gates**

  If no Rust source changed, the focused security regression in Step 2 is the
  applicable Rust check. If Rust source changes, additionally run both desktop
  and server checks/tests/clippy commands required by `AGENTS.md`.

- [ ] **Step 5: Audit scope and branch state**

  ```bash
  git diff --check
  git status --short --branch
  git log --oneline main..HEAD
  ```

  Confirm no changes to `FileSystemRuntime`, no upload-root allowlist, no project
  image copies, no `main` mutation, and no push/deploy/restart.

- [ ] **Step 6: Commit any verification-only correction**

  Only if Step 1-4 required a source correction, stage the explicit in-scope
  paths and create a focused commit. Otherwise create no empty commit.
