import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { PropsLocale } from '../src/host-contracts.ts'
import { zh, en } from '../src/client/locales.ts'
import { BatchControls, CommentEditor } from '../src/client/files/pages/DocumentChrome.tsx'
import { AnnotationError, annotationErrorText } from '../src/client/errors.ts'
import { errorCopy } from '../src/client/error-copy.ts'
import { spreadsheetSnapshot } from '../src/client/files/sheets/snapshot.ts'

afterEach(cleanup)
const translate = (dict: typeof en) => ((key: keyof typeof en) => dict[key]) as PropsLocale<'annotations'>['t']

it('renders Chinese document controls and updates existing controls when the locale changes', () => {
  const props = { bounds: new DOMRect(0, 0, 600, 600), count: 2, busy: false, sendDisabled: false, cancel: vi.fn(), send: vi.fn() }
  const view = render(<BatchControls {...props} t={translate(zh)} />)
  expect(screen.getByText('2 条批注')).toBeTruthy()
  expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  view.rerender(<BatchControls {...props} t={translate(en)} />)
  expect(screen.getByText('2 annotations')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
})

it('localizes placeholders, saved actions, quick-submit accessibility and Add to chat', () => {
  const props = { style: {}, input: createRef<HTMLTextAreaElement>(), comment: '用户原文', setComment: vi.fn(), busy: false, saved: false, save: vi.fn(), cancel: vi.fn(), remove: vi.fn() }
  const view = render(<CommentEditor {...props} t={translate(zh)} />)
  expect(screen.getByPlaceholderText('描述修改或提出问题')).toBeTruthy()
  view.rerender(<CommentEditor {...props} saved t={translate(zh)} />)
  expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '删除批注' })).toBeTruthy()
  view.rerender(<CommentEditor {...props} direct t={translate(zh)} />)
  expect(screen.getByPlaceholderText('描述你希望的修改…')).toBeTruthy()
  expect(screen.getByRole('button', { name: '提交修改请求' })).toBeTruthy()
  expect(zh['file.add']).toBe('加入聊天')
  expect(zh.add).toBe('加入聊天')
  expect(zh['page.request']).toBe('请求修改')
  expect(zh['page.ask']).toBe('提出修改')
})

it('has complete Chinese and English UI dictionaries, including every owned failure', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  for (const text of Object.values(zh)) expect(text).toMatch(/\p{Script=Han}/u)
  for (const text of Object.values(en)) { expect(text.trim()).not.toBe(''); expect(text).not.toMatch(/\p{Script=Han}/u) }
  for (const key of Object.keys(errorCopy) as (keyof typeof errorCopy)[]) {
    const failure = new AnnotationError(key)
    expect(annotationErrorText(failure, translate(zh))).toBe(zh[key])
    expect(annotationErrorText(failure, translate(en))).toBe(en[key])
  }
  // Upstream diagnostics and user-authored content must not be guessed or translated.
  expect(annotationErrorText(new Error('Provider detail: 123'), translate(zh))).toBe('Provider detail: 123')
})

it('retains a real selection failure key until it is displayed in the active language', () => {
  let failure: Error | undefined
  try { spreadsheetSnapshot('dsh-resource://file/absolute/D:/a.xlsx', 'xlsx', { id: 's', name: '数据' }, { row: [0, 5000], column: [0, 0] }, []) }
  catch (error) { if (error instanceof Error) failure = error; else throw error }
  expect(failure).toMatchObject({ key: 'error.selectionTooLarge' })
  expect(annotationErrorText(failure!, translate(en))).toContain('Select a smaller range')
  expect(annotationErrorText(failure!, translate(zh))).toContain('请缩小范围')
})
