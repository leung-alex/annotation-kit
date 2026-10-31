import { describe, expect, it, vi } from 'vitest'
import type { DraftAttachmentId, InputActions } from '../src/host-contracts.ts'
import { commitToComposer } from '../src/client/composer/commit.ts'

const id = 'snapshot-1' as DraftAttachmentId

function actions(insert = true) {
  return {
    captureInsertion: vi.fn(() => ({ draftRev: 1 } as ReturnType<InputActions['captureInsertion']>)),
    insertText: vi.fn(() => insert),
    setDraft: vi.fn(),
    persistDraft: vi.fn(),
    addAttachments: vi.fn(() => true),
    removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(),
    submit: vi.fn(),
  }
}

describe('Composer admission', () => {
  it('adds images and text to the existing input without replacing it or sending', () => {
    const input = actions()
    const release = vi.fn()
    commitToComposer(input, 'annotation', [id], () => true, release)
    expect(input.addAttachments).toHaveBeenCalledWith([id])
    expect(input.insertText).toHaveBeenCalledWith('annotation', expect.anything())
    expect(input.setDraft).not.toHaveBeenCalled()
    expect(input.submit).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it('rolls back only this batch when the draft revision changes', () => {
    const input = actions(false)
    const release = vi.fn()
    expect(() => commitToComposer(input, 'annotation', [id], () => true, release)).toThrow('草稿已变化')
    expect(input.removeAttachment).toHaveBeenCalledWith(id)
    expect(release).toHaveBeenCalledWith(id)
  })

  it('releases staged images without touching the input after a session switch', () => {
    const input = actions()
    const release = vi.fn()
    expect(() => commitToComposer(input, 'annotation', [id], () => false, release)).toThrow('会话已切换')
    expect(input.addAttachments).not.toHaveBeenCalled()
    expect(input.insertText).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith(id)
  })

  it('does not insert into a Composer unmounted during insertion capture', () => {
    const input = actions()
    const release = vi.fn()
    let mounted = true
    vi.mocked(input.captureInsertion).mockImplementation(() => {
      mounted = false
      return { draftRev: 1 } as ReturnType<InputActions['captureInsertion']>
    })

    expect(() => commitToComposer(input, 'annotation', [id], () => mounted, release)).toThrow('会话已切换')
    expect(input.addAttachments).toHaveBeenCalledWith([id])
    expect(input.insertText).not.toHaveBeenCalled()
    expect(input.removeAttachment).toHaveBeenCalledWith(id)
    expect(release).toHaveBeenCalledWith(id)
  })
})
