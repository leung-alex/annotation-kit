/** Native side of the annotation bridge. No visited page receives this API. */
export function createAnnotationChannels(prefix = 'annotation-kit') {
  return Object.freeze({
    setMode: `${prefix}:annotation-set-mode`, capture: `${prefix}:annotation-capture`,
    event: `${prefix}:annotation-event`, guestSelection: `${prefix}:annotation-guest-selection`,
    guestPainted: `${prefix}:annotation-guest-painted`, guestCommand: `${prefix}:annotation-guest-command`,
  })
}
export const ANNOTATION_IPC = createAnnotationChannels()

const MAX_TEXT = 2048
const MAX_SELECTOR = 2048
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function validRect(rect, viewport) {
  return rect && typeof rect === 'object' && !Array.isArray(rect)
    && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))
    && rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1
}

function validSelection(value, guestUrl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['element', 'region'].includes(value.kind)
    || typeof value.url !== 'string' || value.url !== guestUrl
    || typeof value.title !== 'string' || value.title.length > MAX_TEXT
    || typeof value.selector !== 'undefined' && (typeof value.selector !== 'string' || value.selector.length > MAX_SELECTOR)
    || typeof value.text !== 'undefined' && (typeof value.text !== 'string' || value.text.length > MAX_TEXT)
    || typeof value.element !== 'undefined' && !validElement(value.element)) return false
  const viewport = value.viewport
  return viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)
    && viewport.width > 0 && viewport.height > 0 && viewport.width <= 100000 && viewport.height <= 100000
    && value.scroll && Number.isFinite(value.scroll.x) && Number.isFinite(value.scroll.y)
    && validRect(value.rect, viewport)
    && (value.anchor === undefined || value.anchor && Number.isFinite(value.anchor.x) && Number.isFinite(value.anchor.y)
      && value.anchor.x >= 0 && value.anchor.y >= 0 && value.anchor.x <= viewport.width && value.anchor.y <= viewport.height)
}

function validControl(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.tagName === 'string' && value.tagName.length <= 128
    && (value.role === undefined || typeof value.role === 'string' && value.role.length <= 1024)
    && value.attributes && typeof value.attributes === 'object' && !Array.isArray(value.attributes)
    && Object.entries(value.attributes).length <= 16
    && Object.entries(value.attributes).every(([key, text]) => key.length <= 64 && typeof text === 'string' && text.length <= 1024)
}

function validElement(value) {
  return validControl(value) && typeof value.path === 'string' && value.path.length <= MAX_SELECTOR
    && typeof value.frame === 'string' && value.frame.length <= 1024
    && (value.controls === undefined || Array.isArray(value.controls) && value.controls.length <= 8 && value.controls.every(validControl))
}

function pngSize(bytes) {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('annotation-kit: annotation capture did not return PNG')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!width || !height) throw new Error('annotation-kit: annotation PNG has no dimensions')
  return { width, height }
}

/**
 * @template {{ id: string, owner: any, guest?: any, annotation?: any }} L
 * @param {{ leases: ReadonlyMap<string, L>, owners: ReadonlySet<any>, ownsApplicationFrame(event: any): boolean }} policy
 * @param {any} ipcMain Electron's IpcMain, supplied by the owning application.
 * @param {() => string} randomUUID
 * @param {{ channelPrefix?: string, sourceOf?: (lease: L) => string, identitySource?: string, isSourceReady?: (lease: L) => boolean }} [options]
 */
export function installDesktopAnnotations(policy, ipcMain, randomUUID, options = {}) {
  const ANNOTATION_IPC = createAnnotationChannels(options.channelPrefix)
  const sourceOf = options.sourceOf ?? (() => 'browser')
  const identitySource = options.identitySource ?? 'browser'
  let identityUsed = false
  const pendingPaints = new Map()
  const rejectPending = (guest, reason) => {
    for (const [requestId, pending] of pendingPaints) {
      if (pending.guest !== guest) continue
      pendingPaints.delete(requestId)
      pending.reject(new Error(reason))
    }
  }
  const leaseForGuest = guest => [...policy.leases.values()].find(lease => lease.guest === guest)
  const publish = (lease, kind, extra = {}) => {
    if (!lease.owner.isDestroyed()) lease.owner.send(ANNOTATION_IPC.event, {
      lease: lease.id, documentEpoch: lease.annotation?.epoch ?? '', kind,
      source: sourceOf(lease), ...extra,
    })
  }
  const activeLease = (event, id) => {
    if (!policy.ownsApplicationFrame(event) || typeof id !== 'string') {
      throw new Error('annotation-kit: annotation requires an owned application main frame')
    }
    const lease = policy.leases.get(id)
    if (!lease || lease.owner !== event.sender || !lease.guest || lease.guest.isDestroyed()) {
      throw new Error('annotation-kit: annotation guest lease is unavailable')
    }
    return lease
  }
  const supportedDocument = lease => {
    const url = lease.guest.getURL()
    if (!URL.canParse(url) || !['http:', 'https:'].includes(new URL(url).protocol)) {
      throw new Error('annotation-kit: annotation needs a loaded web page')
    }
    if (options.isSourceReady && !options.isSourceReady(lease)) {
      throw new Error('annotation-kit: host identity cleanup is in progress')
    }
  }
  const visibleApplication = async lease => {
    if (await lease.owner.executeJavaScript('document.visibilityState', true) !== 'visible') {
      throw new Error('annotation-kit: bring the application window to the foreground before saving an annotation screenshot')
    }
  }
  ipcMain?.handle(ANNOTATION_IPC.setMode, (event, id, mode) => {
    const lease = activeLease(event, id)
    supportedDocument(lease)
    if (!['off', 'element', 'region'].includes(mode)) throw new Error('annotation-kit: invalid annotation mode')
    if (!lease.annotation) lease.annotation = { epoch: randomUUID(), mode: 'off', selection: undefined }
    rejectPending(lease.guest, 'annotation-kit: annotation mode changed during capture')
    lease.annotation.mode = mode
    lease.annotation.selection = undefined
    if (mode !== 'off') {
      lease.annotation.everActive = true
      if (sourceOf(lease) === identitySource) identityUsed = true
    }
    lease.guest.send(ANNOTATION_IPC.guestCommand, { kind: 'mode', mode, epoch: lease.annotation.epoch })
    return { documentEpoch: lease.annotation.epoch }
  })
  ipcMain?.handle(ANNOTATION_IPC.capture, async (event, id, epoch, selection, number) => {
    const lease = activeLease(event, id)
    supportedDocument(lease)
    await visibleApplication(lease)
    if (typeof epoch !== 'string' || epoch !== lease.annotation?.epoch
      || !Number.isSafeInteger(number) || number < 1 || number > 999
      || !validSelection(selection, lease.guest.getURL())
      || JSON.stringify(selection) !== JSON.stringify(lease.annotation.selection)
      || (lease.annotation.mode !== selection.kind
        && !(lease.annotation.mode === 'element' && selection.kind === 'region'))) {
      throw new Error('annotation-kit: annotation selection is stale')
    }
    const guest = lease.guest
    const requestId = randomUUID()
    const painted = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingPaints.delete(requestId)
        reject(new Error('annotation-kit: annotation marker timed out'))
      }, 3000)
      pendingPaints.set(requestId, { guest, epoch,
        resolve: () => { clearTimeout(timer); resolve() },
        reject: error => { clearTimeout(timer); reject(error) } })
    })
    guest.send(ANNOTATION_IPC.guestCommand, { kind: 'paint', epoch, requestId, selection, number })
    try {
      await painted
      if (policy.leases.get(id) !== lease || lease.guest !== guest || guest.isDestroyed()
        || lease.annotation?.epoch !== epoch || guest.getURL() !== selection.url
        || JSON.stringify(selection) !== JSON.stringify(lease.annotation.selection)) {
        throw new Error('annotation-kit: annotation page changed before capture')
      }
      let captureTimeout
      const image = await Promise.race([
        guest.capturePage(),
        new Promise((_resolve, reject) => {
          captureTimeout = setTimeout(() => reject(new Error('annotation-kit: annotation screenshot timed out')), 10000)
        }),
      ]).finally(() => clearTimeout(captureTimeout))
      const png = image.toPNG()
      if (png.length === 0) throw new Error('annotation-kit: annotation screenshot is empty')
      const { width, height } = pngSize(png)
      if (policy.leases.get(id) !== lease || lease.annotation?.epoch !== epoch || guest.isDestroyed()
        || JSON.stringify(selection) !== JSON.stringify(lease.annotation.selection)) {
        throw new Error('annotation-kit: annotation page changed during capture')
      }
      const verifyId = randomUUID()
      const verified = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingPaints.delete(verifyId)
          reject(new Error('annotation-kit: annotation verification timed out'))
        }, 3000)
        pendingPaints.set(verifyId, { guest, epoch,
          resolve: () => { clearTimeout(timer); resolve() },
          reject: error => { clearTimeout(timer); reject(error) } })
      })
      guest.send(ANNOTATION_IPC.guestCommand, { kind: 'verify', epoch, requestId: verifyId, selection })
      try { await verified } finally { pendingPaints.delete(verifyId) }
      if (policy.leases.get(id) !== lease || lease.annotation?.epoch !== epoch || guest.isDestroyed()
        || JSON.stringify(selection) !== JSON.stringify(lease.annotation.selection)) {
        throw new Error('annotation-kit: annotation page changed during capture')
      }
      return { png: Uint8Array.from(png), width, height,
        viewportWidth: selection.viewport.width, viewportHeight: selection.viewport.height }
    } finally { pendingPaints.delete(requestId) }
  })
  if (typeof ipcMain?.on === 'function') ipcMain.on(ANNOTATION_IPC.guestSelection, (event, payload) => {
    const lease = leaseForGuest(event.sender)
    if (!lease || event.senderFrame !== event.sender.mainFrame || lease.owner.isDestroyed()
      || !lease.annotation || lease.annotation.mode === 'off'
      || payload?.epoch !== lease.annotation.epoch) return
    if (payload.escape === true) {
      lease.annotation.mode = 'off'
      lease.annotation.selection = undefined
      rejectPending(lease.guest, 'annotation-kit: annotation cancelled')
      lease.guest.send(ANNOTATION_IPC.guestCommand, { kind: 'mode', mode: 'off', epoch: lease.annotation.epoch })
      publish(lease, 'mode-ended')
      return
    }
    if (payload.selection === null) {
      lease.annotation.selection = undefined
      rejectPending(lease.guest, 'annotation-kit: annotation viewport changed')
      publish(lease, 'selection-cleared')
      return
    }
    if ((payload?.selection?.kind !== lease.annotation.mode
        && !(lease.annotation.mode === 'element' && payload?.selection?.kind === 'region'))
      || !validSelection(payload.selection, lease.guest.getURL())) return
    lease.annotation.selection = payload.selection
    publish(lease, 'selection', { selection: payload.selection })
  })
  if (typeof ipcMain?.on === 'function') ipcMain.on(ANNOTATION_IPC.guestPainted, (event, payload) => {
    const pending = pendingPaints.get(payload?.requestId)
    if (!pending || pending.guest !== event.sender || event.senderFrame !== event.sender.mainFrame
      || pending.epoch !== payload.epoch) return
    pendingPaints.delete(payload.requestId)
    if (typeof payload.error === 'string') pending.reject(new Error('annotation-kit: annotation page changed; select the target again'))
    else pending.resolve()
  })
  return {
    attached(lease) {
      lease.annotation = { epoch: randomUUID(), mode: 'off', selection: undefined, everActive: false }
    },
    navigation(lease) {
      if (!lease.annotation) return
      if (lease.guest) rejectPending(lease.guest, 'annotation-kit: annotation page changed during capture')
      const everActive = lease.annotation.everActive
      lease.annotation = { epoch: randomUUID(), mode: 'off', selection: undefined, everActive }
      if (lease.guest && !lease.guest.isDestroyed()) {
        lease.guest.send(ANNOTATION_IPC.guestCommand,
          { kind: 'mode', mode: 'off', epoch: lease.annotation.epoch })
      }
      if (everActive) publish(lease, 'navigation')
    },
    disposed(lease) {
      if (lease.guest) rejectPending(lease.guest, 'annotation-kit: annotation guest closed during capture')
      if (lease.annotation?.everActive) publish(lease, 'disposed')
    },
    identityCleared() {
      if (!identityUsed) return
      identityUsed = false
      for (const owner of policy.owners) {
        if (!owner.isDestroyed()) owner.send(ANNOTATION_IPC.event, {
          lease: '', documentEpoch: '', kind: 'identity-cleared', source: identitySource,
        })
      }
    },
  }
}
