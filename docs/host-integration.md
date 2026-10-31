# Host integration

The library runs inside a host. The host owns sessions, viewers, drafts, attachment admission, durable submission and navigation. Reuse its React 18 root and module instance.

## Connect a host

```ts
import type { ComposerBridge } from 'annotation-kit'

const bridge: ComposerBridge = {
  hasTarget: () => currentSession() !== undefined,
  targetKey: () => currentSession()?.id,
  subscribe: listener => sessionAndDraftChanges.subscribe(listener),
  async add(request) {
    request.signal?.throwIfAborted()
    // Validate expectedTarget again immediately before admitting anything.
    // Stage request.images, insert structured references, then commit together.
    await drafts.add(request)
  },
  async sendPages(request) {
    // Submit request.items + request.images as a separate message.
    // Resolve only after admission succeeds. Preserve unrelated draft content.
    await submissions.admit(request)
  },
  dispose() {},
}
```

This is a contract sketch; `currentSession`, `drafts`, and `submissions` are your services. [DemoHost](../examples/react/host.ts) is runnable. [DSH's Composer adapter](../examples/dsh/plugin/src/client/composer/index.tsx) handles draft revision fences, attachment rollback and session retention against its pinned host.

`expectedTarget` is captured when a selection begins. Reject if the session changed. Propagate the `AbortSignal` through screenshot, upload and admission. A rejected admission leaves the snapshot available. Confirm submission exactly once at the host's durable admission boundary; if a transport can fail after accepting a request, reconcile that outcome before retrying. Model-generation failure after acceptance must not be reported as failed admission.

## Web pages

Create `AnnotationsModel(desktopBridge, bridge, leaseOf)` and render `AnnotationButton` and `AnnotationOverlay` with a `BrowserSurfaceHandle` and a translator (`en`, `zh`, or your own). The surface gives the viewport element id, source, URL and lifecycle signal. The native bridge reports a selection and a document epoch. The model requests the PNG and adds one original selection/comment/image to the draft.

The renderer owns the comment editor; visited web pages never receive the application draft API. The [same-document DOM host](../examples/react/dom-surface.ts) shows an alternative for a normal browser. It is limited to content owned by that document.

## Text, code and Markdown

`readFileSelection(range, root, kind)` reads original text and coordinates. `fileReference(snapshot)` creates a JSON-safe structured reference; `serializeFileReference` turns it into evidence plus versioned card metadata. Serialize that reference at send time, without rereading a changed source file.

`actionComponent(kind, bridge)` supplies the selection popup for a retained viewer. The adapter contract uses `[data-textpreview-url]`, `[data-textpreview-plain]` / `[data-code-preview]`, and `[data-textpreview-line]` for visible source locations. Markdown additionally uses source-block ranges; the DSH adapter derives these from DSH's retained parser and refuses ambiguous mappings. `contentId` must be the source URI, not a tab's arbitrary display id.

Code coordinates are computed from the original `pre code` text; code lines do not require a `data-textpreview-line` attribute. That line attribute belongs to plain-text viewers.

## PDF, Word and PowerPoint

The host supplies the viewer and Office-to-PDF conversion. `pageActionComponent(bridge, batches)` observes the existing preview:

- Preview wrapper: `data-textpreview-url="<source URI>"`.
- Page: `data-pdf-page="1"` (one based).
- Selectable text layer: `data-pdf-text` within its page.
- Page canvas: the already rendered page pixels for region cropping.

`DocumentWorkflow` admits text and image snapshots into `PageBatches`. `PageBatches` stores JSON snapshots in a supplied Storage and image bytes in `PageImageStore` (IndexedDB by default). It saves the image before referencing it, validates restore bytes and acknowledges only the unchanged payload that was admitted. A newer edit remains unsent.

```ts
import { PageBatches, pageImageStore, DocumentWorkflow } from 'annotation-kit'
const images = pageImageStore('my-app-annotation-images')
const batches = new PageBatches(images, localStorage, 'my-app.annotations.v1')
const workflow = new DocumentWorkflow(bridge, batches)
// workflow.commit(scope, { kind: 'batch', snapshot, image }, signal)
// workflow.send(scope, signal)
```

A `presentation-request` accepts only PowerPoint text and submits it directly. It cannot call the draft insertion method. Document UI reads `workflow.canSend`; an unavailable sender remains visible instead of falling back to the draft.

## Spreadsheets

Use `spreadsheetSnapshot(address, format, sheet, selection, cells)` for a durable snapshot. The snapshot includes sheet id/name, one rectangular range, original values, display strings, formulas and merges. Noncontiguous selections and oversized ranges are rejected.

`SheetSurface` receives the host's stable FortuneSheet Workbook, parsed sheets, workbook CSS and preview layout classes. Parsing, security/read-only patches and workbook lifetime remain host responsibilities. See the [DSH wrapper](../examples/dsh/plugin/src/client/files/sheets/SheetBody.tsx). `registerSpreadsheet` / `revealSpreadsheet` let a card reopen the matching source range without constructing a second workbook.

## Assistant reply

Create `ResponseController`, register a rendered reply root and `ResponseSource`, and mount `ResponseOverlay`. A source identifies session, message node, turn, step, sequence and original block index. Only assistant prose enters this surface; exclude reasoning, tools, images and transient UI.

Implement `bridge.responses` to read/replace/remove the host's actual persisted references. `ResponseCard` opens the source and edits the comment via the controller. `responseReference` and `serializeResponseReference` preserve quote evidence independently of future rendering. Loading an older source is a host callback.

## Sent cards

`SentAnnotations` accepts your content/attachment types as generic parameters. Supply `imageName`, `renderImage`, `renderText`, `renderDefault` and optional source openers. Unknown versions return `fallback`; ordinary content and unowned images stay with the default renderer. Match owned screenshots by exact, unique filename. `renderText` must use your normal user-text renderer, including any application redaction policy. Never evaluate snapshot text as HTML or instructions.

## Electron

```ts
import { installDesktopAnnotations, renderAnnotationGuestPreload } from 'annotation-kit/electron'
// Main process, after the host has established ownership:
const annotations = installDesktopAnnotations(policy, ipcMain, randomUUID, {
  channelPrefix: 'my-app', sourceOf: lease => 'browser',
})
// Build tooling: write this string as the guest's sandboxed CJS preload.
const preload = renderAnnotationGuestPreload({ channelPrefix: 'my-app' })
```

`policy` provides `leases`, `owners` and `ownsApplicationFrame(event)`. A lease has `id`, `owner`, `guest` and library-owned `annotation` state. Call `attached`, `navigation` (including same-document navigation) and `disposed` on the corresponding verified lease. Bind to both full navigation and in-page navigation, and reject guests from another window or subframe. The [DSH patch](../examples/dsh/patches/dsh-0.2.1-rc.5.patch) is the complete version-specific wiring, including the main-frame-only renderer API.

The bridge validates guest URL, selection geometry, epoch and PNG. It waits for marker paint, captures the owned guest, then verifies that the target stayed valid. Keep the host's navigation/permission rules and main-frame ownership checks. Do not expose `ipcRenderer` to visited content.

`AnnotationUiProvider` lets an Electron host supply its native `WindowOverlay` and interactive-region attributes. Keep full-window roots transparent to hit testing; only bounded controls should be draggable-excluded regions. DSH's default example uses the library overlay; Aione supplies its shared window-region primitives.
