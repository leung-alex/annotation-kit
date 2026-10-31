/** One browser occurrence. The native bridge verifies the guest lease separately. */
export interface BrowserSurfaceHandle {
  readonly id: string
  readonly source: string
  readonly viewportId: string
  readonly title: string
  readonly url?: string
  readonly enabled: boolean
  readonly signal?: AbortSignal
}
