import 'server-only'

import OpenAI from 'openai'

import {
  parseQuestionRecap,
  QUESTION_RECAP_MODEL,
  questionRecapPrompt,
} from '@/lib/providerQuestions/questionRecap'

import { aiConfigured } from './draft'

/**
 * Restate a Provider Question for the patient. Never throws: '' means "leave
 * the question out of the letter", which is always safe to send.
 */
export async function writeQuestionRecap(question: string): Promise<string> {
  if (!question.trim() || !aiConfigured()) return ''

  const { system, user } = questionRecapPrompt(question)
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const completion = await openai.chat.completions.create({
      model: QUESTION_RECAP_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: 200,
    })
    return parseQuestionRecap(completion.choices[0]?.message?.content ?? '')
  } catch (error) {
    console.error('[ai/questionRecap] request failed:', error)
    return ''
  }
}
