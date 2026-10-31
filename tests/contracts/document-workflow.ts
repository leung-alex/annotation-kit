import type { DocumentAnnotationBridge, DocumentCommit } from '../../src/client/files/document-workflow.ts'
import type { PageInteraction } from '../../src/client/files/pages/interaction.ts'
import type { PageSnapshot } from '../../src/client/files/pages/snapshot.ts'
import type { SpreadsheetSnapshot } from '../../src/client/files/sheets/snapshot.ts'
import type { TextSnapshot } from '../../src/client/files/references.ts'

declare const bridge: DocumentAnnotationBridge
declare const page: PageSnapshot
declare const sheet: SpreadsheetSnapshot
declare const text: TextSnapshot
declare const image: File

// @ts-expect-error Document callers cannot insert into the unrelated Composer draft.
bridge.add
const ordinary: DocumentCommit = { kind: 'batch', snapshot: page, image }
const cells: DocumentCommit = { kind: 'batch', snapshot: sheet }
// @ts-expect-error Version 1 text-file Composer references are not document batches.
const legacy: DocumentCommit = { kind: 'batch', snapshot: text }
// @ts-expect-error Presentation quick requests cannot accidentally send spreadsheet cells.
const wrongScene: DocumentCommit = { kind: 'presentation-request', snapshot: sheet }
// @ts-expect-error Presentation quick text cannot carry a region screenshot.
const wrongImage: DocumentCommit = { kind: 'presentation-request', snapshot: page, image }

type Interaction = PageInteraction<string, PageSnapshot>
const editing: Interaction = { phase: 'editing', draft: page, comment: 'Keep on failure', error: '' }
// @ts-expect-error Commit admission must retain its editable draft and comment for retry.
const lostDraft: Interaction = { phase: 'submitting', operation: 'commit', token: 1, error: '' }
// @ts-expect-error A batch send is a different phase from editing a selection.
const mixed: Interaction = { phase: 'submitting', operation: 'batch-send', draft: page, comment: 'wrong', token: 1, error: '' }
// @ts-expect-error An idle editor cannot contain a live editable snapshot.
const idleDraft: Interaction = { phase: 'idle', draft: page, error: '' }
void [ordinary, cells, legacy, wrongScene, wrongImage, editing, lostDraft, mixed, idleDraft]
