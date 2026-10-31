import type { AnnotationFailure } from '../../errors.ts'

/** Mutually exclusive UI phases; a pending commit always retains its editable snapshot. */
export type PageInteraction<Selection, Draft> =
  | { readonly phase: 'idle'; readonly error: AnnotationFailure }
  | { readonly phase: 'selected'; readonly selection: Selection; readonly error: AnnotationFailure }
  | { readonly phase: 'editing'; readonly draft: Draft; readonly comment: string; readonly error: AnnotationFailure }
  | { readonly phase: 'submitting'; readonly operation: 'commit' | 'edit-remove'; readonly draft: Draft; readonly comment: string; readonly token: number; readonly error: '' }
  | { readonly phase: 'submitting'; readonly operation: 'batch-send' | 'batch-remove'; readonly token: number; readonly error: ''; readonly draft?: never; readonly comment?: never }

export type PageInteractionEvent<Selection, Draft> =
  | { readonly type: 'select'; readonly selection?: Selection | undefined }
  | { readonly type: 'edit'; readonly draft: Draft; readonly comment: string }
  | { readonly type: 'comment'; readonly value: string }
  | { readonly type: 'cancel' }
  | { readonly type: 'start'; readonly operation: 'commit' | 'batch-send' | 'batch-remove'; readonly token: number }
  | { readonly type: 'complete'; readonly token: number }
  | { readonly type: 'fail'; readonly token: number; readonly error: AnnotationFailure }

export function pageInteraction<Selection, Draft>(state: PageInteraction<Selection, Draft>, event: PageInteractionEvent<Selection, Draft>): PageInteraction<Selection, Draft> {
  switch (event.type) {
    case 'cancel': return { phase: 'idle', error: '' }
    case 'select':
      if (state.phase === 'editing' || state.phase === 'submitting') return state
      return event.selection === undefined ? { phase: 'idle', error: '' } : { phase: 'selected', selection: event.selection, error: '' }
    case 'edit': return { phase: 'editing', draft: event.draft, comment: event.comment, error: '' }
    case 'comment': return state.phase === 'editing' ? { ...state, comment: event.value } : state
    case 'start':
      if (state.phase === 'submitting') return state
      if (event.operation === 'commit') return state.phase === 'editing'
        ? { ...state, phase: 'submitting', operation: 'commit', token: event.token, error: '' } : state
      if (event.operation === 'batch-remove' && state.phase === 'editing') return { ...state, phase: 'submitting', operation: 'edit-remove', token: event.token, error: '' }
      return { phase: 'submitting', operation: event.operation, token: event.token, error: '' }
    case 'complete': return state.phase === 'submitting' && state.token === event.token ? { phase: 'idle', error: '' } : state
    case 'fail':
      if (state.phase !== 'submitting' || state.token !== event.token) return state
      return state.operation === 'commit' || state.operation === 'edit-remove'
        ? { phase: 'editing', draft: state.draft, comment: state.comment, error: event.error }
        : { phase: 'idle', error: event.error }
  }
}
