/** Deterministic local model for reproducible screenshots; it performs no network requests or tool calls. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

const model: LlmModelInfo = { provider: 'annotation-demo', id: 'local-demo', name: 'Annotation demo (local)', inputModalities: ['text', 'image'] }
class DemoAdapter extends LlmAdapter {
  override providerInfo() { return { id: 'annotation-demo', name: 'Annotation example · local' } }
  override async listModels() { return [model] }
  override async resolveModel() { return { ...model, context: { contextWindow: 128000 } } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const text = '## Keep the context with the question\n\nA useful annotation combines **context** with **intent**. Quote exactly what you mean, then explain what should change.\n\nThe saved snapshot remains readable even after the source changes. Web selections join the draft; document and spreadsheet comments stay in their own batch until you send them.\n\n1. Select a detail.\n2. Write a focused comment.\n3. Review and send the original evidence.\n\n*This is a deterministic local demo response; no remote model was called.*'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 150 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
export function installDemoModel(ctx: Context) { ctx.effect(() => ctx.llm.registerAdapter(['annotation-demo'], new DemoAdapter())) }
