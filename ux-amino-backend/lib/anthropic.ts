import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, buildUserContent } from './prompt'
import type { FigmaFrameData } from './figma'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const MAX_TOKENS = 16000
const MAX_SEARCHES = 8

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export async function runAudit(data: FigmaFrameData, screenName: string): Promise<string> {
  const system = buildSystemPrompt()
  const userContent = buildUserContent(data, screenName)

  const requestParams = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' as const },
    output_config: { effort: 'high' as const },
    tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: MAX_SEARCHES }],
    system,
  }

  let messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }]
  let response = await getClient().messages.create({ ...requestParams, messages })

  // Server-side web_search tool loop caps at 10 iterations internally; a
  // paused turn resumes by re-sending the same conversation, not by
  // appending a "continue" message.
  while (response.stop_reason === 'pause_turn') {
    messages = [
      { role: 'user', content: userContent },
      { role: 'assistant', content: response.content },
    ]
    response = await getClient().messages.create({ ...requestParams, messages })
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to complete this audit (safety refusal).')
  }

  const report = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim()

  if (!report) {
    throw new Error('The model returned no report text.')
  }

  return report
}
