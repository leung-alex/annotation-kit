import { createContext, forwardRef, useContext, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './regions.module.css'

export type WindowOverlayStyle = Omit<CSSProperties, 'position' | 'inset' | 'pointerEvents'> & {
  readonly position?: never
  readonly inset?: never
  readonly pointerEvents?: never
  readonly WebkitAppRegion?: never
  readonly appRegion?: never
}
export type WindowOverlayProps = Omit<HTMLAttributes<HTMLDivElement>, 'style'> & { readonly style?: WindowOverlayStyle }
const DefaultOverlay = forwardRef<HTMLDivElement, WindowOverlayProps>(function DefaultOverlay({ children, className, style, ...props }, ref) {
  if (typeof document === 'undefined') return null
  return createPortal(<div {...props} ref={ref} style={style} className={`${css.overlay}${className ? ` ${className}` : ''}`} data-annotation-window-overlay>{children}</div>, document.body)
})
const defaultRegions = {
  Overlay: DefaultOverlay,
  interactiveWindowRegion: Object.freeze({ 'data-annotation-window-interactive': '' }) as Record<string, string>,
}
export interface AnnotationUiRegions {
  readonly Overlay: typeof DefaultOverlay
  readonly interactiveWindowRegion: Readonly<Record<string, string>>
}
const Regions = createContext<AnnotationUiRegions>(defaultRegions)
export function AnnotationUiProvider({ value, children }: { readonly value: AnnotationUiRegions; readonly children: ReactNode }) {
  return <Regions.Provider value={value}>{children}</Regions.Provider>
}
export function useInteractiveWindowRegion() { return useContext(Regions).interactiveWindowRegion }
export const WindowOverlay = forwardRef<HTMLDivElement, WindowOverlayProps>(function WindowOverlay(props, ref) {
  const { Overlay } = useContext(Regions)
  return <Overlay {...props} ref={ref} />
})
