import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { AnnotationsModel, ResponseController, en, type AnnotationKey } from 'annotation-kit'
import { AnnotationButton, AnnotationOverlay, actionComponent, ResponseCard, ResponseOverlay, SelectionCard, SentAnnotations } from 'annotation-kit/react'
import 'annotation-kit/styles.css'
import { DemoHost } from './host.ts'
import { DomSurface } from './dom-surface.ts'
import './style.css'

const host = new DemoHost()
const t = (key: AnnotationKey, values?: Record<string, string | number>) => Object.entries(values ?? {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), en[key])
const TextAction = actionComponent('text', host)
const source = `# Shipping a thoughtful product\n\nStart with the people who will use it.\nMake one clear promise, and keep it.\n\nAnnotations preserve a point in time.\nA later edit must never change the quoted evidence.\n\nThe host owns previews, sessions, and submission.\nThe library owns selections, comments, and snapshots.`
const responseText = 'A useful annotation combines context with intent.\nQuote exactly what you mean, then explain what should change.\nThe saved snapshot remains readable even after the source changes.'

function App() {
  useSyncExternalStore(host.subscribe, host.getSnapshot)
  const [scene, setScene] = useState('web')
  const root = useRef<HTMLDivElement>(null)
  const [web, setWeb] = useState<{ model: AnnotationsModel; desktop: DomSurface }>()
  const surface = useMemo(() => ({ id: 'demo-browser', source: 'browser', viewportId: 'demo-browser', title: 'Orbit', url: location.href, enabled: true }), [])
  const responses = useMemo(() => new ResponseController(host, async () => {}), [])
  const assistant = useRef<HTMLDivElement>(null)
  useEffect(() => { host.responses.open = (snapshot, edit, trigger) => responses.open(snapshot, edit, trigger); return () => { host.responses.open = undefined; responses.dispose() } }, [])
  useEffect(() => {
    if (scene === 'assistant' && assistant.current) return responses.register({ root: assistant.current, source: { sessionId: host.session, nodeKey: 'assistant-1', nodeId: 'assistant-1', turn: 1, step: 1, seq: 1, blockIndex: 0, text: responseText }, reveal: () => assistant.current?.scrollIntoView({ block: 'center' }) })
  }, [scene])
  useEffect(() => {
    if (scene !== 'web' || !root.current) return
    const desktop = new DomSurface(root.current)
    const model = new AnnotationsModel(desktop, host, () => 'demo')
    setWeb({ model, desktop })
    return () => { model.dispose(); setWeb(undefined) }
  }, [scene])
  const down = useRef<{ x: number; y: number }>()
  return <div className="shell">
    <header className="masthead"><a className="wordmark" href="#">✳ <strong>annotation-kit</strong><span>0.1.0</span></a><span className="env">React 18 · browser host example</span><a href="https://github.com/leung-alex/annotation-kit">GitHub ↗</a></header>
    <div className="intro"><p className="eyebrow">CONTEXT, KEPT CLOSE.</p><h1>Point. Comment. Keep the context.</h1><p>Selections become snapshots your application can edit, save, and send.</p></div>
    <main className="workspace"><section className="preview">
      <div className="toolbar"><nav>{['web','text','assistant','sent'].map(value => <button key={value} aria-pressed={scene === value} onClick={() => setScene(value)}>{({ web:'Web page',text:'Text / Markdown',assistant:'Assistant reply',sent:'Sent cards' })[value]}</button>)}</nav>{scene === 'web' && web && <AnnotationButton surface={surface} model={web.model} t={t} />}</div>
      {scene === 'web' && <div ref={root} id="demo-browser" className="web-page" onPointerDown={event => { if (web?.desktop.mode === 'region') down.current = { x: event.clientX, y: event.clientY } }} onPointerUp={event => {
        if (!web || web.desktop.mode === 'off') return
        event.preventDefault()
        if (down.current && web.desktop.mode === 'region') { const start = down.current; down.current = undefined; const rect = new DOMRect(Math.min(start.x,event.clientX),Math.min(start.y,event.clientY),Math.abs(start.x-event.clientX),Math.abs(start.y-event.clientY)); if (rect.width > 4 && rect.height > 4) web.desktop.select(root.current!,rect,'region') }
        else web.desktop.select(event.target as HTMLElement)
      }}><div className="site-nav"><b>◒ orbit</b><span>Product　 Resources　 Company</span><button>Get started</button></div><p className="eyebrow">A BETTER WAY TO SHIP</p><h2>Good ideas deserve<br/>a clear next step.</h2><p className="lead">Keep your team in sync, from the first sketch<br/>to the moment you launch.</p><div className="site-actions"><button id="start-project">Start a project <span>↗</span></button><a>Explore the workspace →</a></div><div className="launch-card" id="launch-checklist"><div><span className="status">IN PROGRESS</span><h3>Website launch</h3><p>Three small steps. One shared goal.</p></div><ul><li>✓ Define the story</li><li>✓ Review the first draft</li><li>◯ Polish the final details</li></ul></div><footer>Made for teams that care about the details.</footer></div>}
      {scene === 'text' && <div className="text-document" data-textpreview-url="memory://demo/guide.md"><div className="file-heading"><span>↳ guide.md</span><span>Original source · immutable snapshot</span><TextAction content={{ kind:'text',text:source,eof:true }} useTabInfo={() => ({ tab:{ id:'text',contentId:'memory://demo/guide.md',signal:new AbortController().signal,navigation:{params:{url:'memory://demo/guide.md'}} } })} t={t}/></div><article data-textpreview-plain>{source.split('\n').map((line,index) => <div key={index} data-textpreview-line={index+1}><span className="line-number" aria-hidden="true">{index+1}</span><span>{line || '\u200b'}</span></div>)}</article><p className="hint">Select a sentence to add the original text to the draft.</p></div>}
      {scene === 'assistant' && <div className="assistant-document" data-chat-flow><div className="assistant-label">✳ ASSISTANT</div><div ref={assistant} data-response-source>{responseText.split('\n').map((line,index) => <p key={index}>{line}</p>)}</div><div className="hint">Select any sentence, add it to the draft, then edit its comment.</div><ResponseOverlay controller={responses} sessionId={host.session} t={t}/></div>}
      {scene === 'sent' && <div className="sent-document"><p className="eyebrow">PERSISTED MESSAGES</p><h2>Context travels with the message.</h2>{host.state.sent.length === 0 && <p>Save a selection and send the draft to see its card here.</p>}{host.state.sent.map(message => <div className="sent-row" key={message.id}><span className="message-author">YOU</span><SentAnnotations content={message.content} attachments={message.attachments} t={t} fallback={<p>Unknown message format</p>} renderText={text => text} renderDefault={blocks => blocks.length ? <pre>{JSON.stringify(blocks,null,2)}</pre> : null} imageName={image => image.name} renderImage={image => <img className="screenshot" src={image.url} alt={image.name}/>}/></div>)}</div>}
      {web && scene === 'web' && <AnnotationOverlay surface={surface} model={web.model} t={t}/>}
    </section><aside className="draft"><div className="draft-heading"><span>YOUR APPLICATION</span><span className="dot"/></div><h2>A draft with context.</h2><p className="muted">The library hands snapshots to your host.<br/>Your app decides when to send.</p><div className="draft-cards">{host.state.web.map(entry => <article className="web-draft" key={entry.id}><small>WEB ANNOTATION {entry.id}</small><p>{entry.comment}</p><code>{entry.selection.selector}</code><img src={host.images.find(image => image.name===entry.image.name)?.url} alt="Captured page"/></article>)}<SelectionCard draft initiallyOpen items={host.state.files} t={t}/><ResponseCard draft items={host.state.responses} t={t} onOpen={(snapshot,edit,trigger) => host.responses.open?.(snapshot,edit,trigger)}/>{!host.state.web.length&&!host.state.files.length&&!host.state.responses.length&&<div className="empty-draft"><span>＋</span><p>Select something meaningful.<br/>Its context will appear here.</p></div>}</div><textarea id="demo-composer" placeholder="Add your own message…"/><button className="send-draft" onClick={() => { host.sendDraft(); setScene('sent') }}>Send draft <span>↑</span></button><details><summary>Host events · {host.events.length}</summary><pre>{host.events.join('\n\n')}</pre></details></aside></main><footer className="page-footer">Independent React example · no DSH installation required<span>Web capture: same-document DOM rasterization</span></footer>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
