/** Compatibility path; the implementation is maintained in annotation-kit. */
export { type AnnotationRect, type BrowserAnnotationSelection, type BrowserAnnotationControl, type BrowserAnnotationElement, type DesktopAnnotationEvent, type DesktopAnnotations } from 'annotation-kit'

import type { DesktopAnnotations } from 'annotation-kit'
declare global { interface Window { annotationKitDesktop?: DesktopAnnotations } }
