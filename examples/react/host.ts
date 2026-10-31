import { annotationPresentation, formatAnnotations, serializeFileReference, fileReference, serializeResponseReference, responseReference, type AnnotationEntry, type ComposerBridge, type ComposerAddRequest, type FileSnapshot, type ResponseAnnotationSnapshot } from 'annotation-kit'

export interface Image { name: string; url: string }
export interface Message { id: string; content: unknown[]; attachments: Image[] }
interface State { web: AnnotationEntry[]; files: FileSnapshot[]; responses: ResponseAnnotationSnapshot[]; sent: Message[] }
/** Deliberately small example host. A real application owns admission, authentication and persistence. */
export class DemoHost implements ComposerBridge {
  private listeners = new Set<() => void>()
  private revision = 0
  session = 'example-session'
  state: State = { web: [], files: [], responses: [], sent: [] }
  images: Image[] = []
  events: string[] = []
  constructor() {
    try { this.state.sent = JSON.parse(localStorage.getItem('annotation-kit.demo.messages') ?? '[]') } catch { /* A corrupt demo log starts empty. */ }
  }
  getSnapshot = () => this.revision
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  changed = () => { this.revision++; for (const listener of this.listeners) listener() }
  targetKey = () => this.session
  hasTarget = () => true
  dispose() { this.listeners.clear() }
  async add(request: ComposerAddRequest) {
    request.signal?.throwIfAborted()
    if (request.expectedTarget && request.expectedTarget !== this.session) throw new Error('Session changed')
    if (request.annotations) this.state.web.push(...request.annotations)
    if (request.fileSelection) this.state.files.push(request.fileSelection)
    if (request.responseSelection) this.state.responses.push(request.responseSelection)
    for (const file of request.images ?? []) this.images.push({ name: file.name, url: await dataUrl(file) })
    this.events.unshift(`Composer.add: ${request.annotations ? 'web screenshot + immutable selection' : request.fileSelection ? 'text snapshot' : 'assistant quote'}`)
    this.changed()
  }
  sendPages: NonNullable<ComposerBridge['sendPages']> = async request => {
    request.signal.throwIfAborted()
    if (request.expectedTarget !== this.session) throw new Error('Session changed')
    const attachments = await Promise.all(request.images.map(async file => ({ name: file.name, url: await dataUrl(file) })))
    request.signal.throwIfAborted()
    this.state.sent.push({ id: crypto.randomUUID(), attachments,
      content: request.items.map(item => ({ type: 'text', ...serializeFileReference(fileReference(item).ref, request.signal) })) })
    this.events.unshift(`sendPages: independent batch of ${request.items.length}; composer draft retained`)
    this.persist()
  }
  responses = {
    read: (session: string) => session === this.session ? this.state.responses : [],
    replace: (snapshot: ResponseAnnotationSnapshot) => { this.state.responses = this.state.responses.map(s => s.id === snapshot.id ? snapshot : s); this.changed() },
    remove: (_session: string, id: string) => { this.state.responses = this.state.responses.filter(s => s.id !== id); this.changed() },
    clear: () => { this.state.responses = []; this.changed() },
    focus: () => document.querySelector<HTMLTextAreaElement>('#demo-composer')?.focus(),
    open: undefined as undefined | ((snapshot: ResponseAnnotationSnapshot, edit: boolean, trigger?: HTMLElement) => Promise<void>),
  }
  sendDraft() {
    const content: unknown[] = []
    if (this.state.web.length) content.push({ type: 'text', text: formatAnnotations(this.state.web), presentation: annotationPresentation(crypto.randomUUID(), this.state.web) })
    for (const item of this.state.files) content.push({ type: 'text', ...serializeFileReference(fileReference(item).ref, new AbortController().signal) })
    for (const item of this.state.responses) content.push({ type: 'text', ...serializeResponseReference(responseReference(item, 'Assistant quote').ref, new AbortController().signal) })
    if (!content.length) return
    this.state.sent.push({ id: crypto.randomUUID(), content, attachments: [...this.images] })
    this.state.web = []; this.state.files = []; this.state.responses = []; this.images = []
    this.events.unshift('sendDraft: serialized evidence + versioned card metadata')
    this.persist()
  }
  private persist() { localStorage.setItem('annotation-kit.demo.messages', JSON.stringify(this.state.sent)); this.changed() }
}
async function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
}
