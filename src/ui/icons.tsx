import type { SVGProps } from 'react'
type IconProps = SVGProps<SVGSVGElement>
function icon(path: string, filled = false) {
  return function Icon({ width = 18, height = 18, ...props }: IconProps) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={path} /></svg>
  }
}
export const Chat = icon('M20 11.5a8 8 0 0 1-8 8H5l-3 3v-11a9 9 0 0 1 18 0Z')
export const ChatFilled = icon('M12 2a10 10 0 0 0-10 10v10l4-3h6a8.5 8.5 0 1 0 0-17Z', true)
export const X = icon('m6 6 12 12M18 6 6 18')
export const Trash = icon('M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7')
export const Pencil = icon('m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z')
export const EditPencil = Pencil
export const SettingsSlider = icon('M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m8 4v6')
