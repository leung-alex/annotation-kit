/** Browser and file context are owned by the client plugin. */
import type { Context } from '@deepseek-ai/cordis'
import { installDemoModel } from './demo-model.ts'
export const inject: string[] = ['llm']
export function apply(ctx: Context): void { installDemoModel(ctx) }
