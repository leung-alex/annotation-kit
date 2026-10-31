import type { ComponentType } from 'react'
// DSH's retained frame supplies the React root. The library owns only its controls.
export function withAnnotationUi<P extends object>(Component: ComponentType<P>) {
  return function AnnotationUi(props: P) { return <Component {...props} /> }
}
