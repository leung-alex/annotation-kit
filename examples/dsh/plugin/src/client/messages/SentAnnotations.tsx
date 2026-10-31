import { SentAnnotations as AnnotationCards } from 'annotation-kit/react'
import type { PropsLocale, PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageContentOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { FileSnapshot, ResponseAnnotationSnapshot } from 'annotation-kit'
type Props = MessageContentOwnerProps & PropsLocale<'annotations'> & PropsRenderFactories & {
  openFile?: (snapshot: FileSnapshot) => void | Promise<void>
  openResponse?: (snapshot: ResponseAnnotationSnapshot) => void | Promise<void>
}
export function SentAnnotations({ renderFactorySlot, renderMessageImages, ...props }: Props) {
  return <AnnotationCards {...props}
    renderText={text => renderFactorySlot('conversation.user.text', { text, facts: {}, interactive: true }, { fallback: text })}
    imageName={attachment => attachment.type === 'image' ? 'attachment' in attachment.image ? attachment.image.attachment.name : attachment.image.preview.name : undefined}
    renderImage={attachment => attachment.type === 'image' ? renderMessageImages({ images: [attachment.image], align: 'end', compact: true }) : null}
  />
}
export type SentAnnotationsProps = PropsRuntime<'conversation.message.content'> & PropsLocale<'annotations'>
