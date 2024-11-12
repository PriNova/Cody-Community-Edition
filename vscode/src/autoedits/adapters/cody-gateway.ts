import type { AutoEditsTokenLimit } from '@sourcegraph/cody-shared'
import type * as vscode from 'vscode'
import type {
    AutocompleteContextSnippet,
    DocumentContext,
} from '../../../../lib/shared/src/completions/types'
import { autoeditsLogger } from '../logger'
import type { AutoeditsModelAdapter, ChatPrompt, PromptResponseData } from '../prompt-provider'
import { getModelResponse } from '../prompt-provider'
import { type CodeToReplaceData, SYSTEM_PROMPT, getBaseUserPrompt } from '../prompt-utils'

export class CodyGatewayAdapter implements AutoeditsModelAdapter {
    getPrompt(
        docContext: DocumentContext,
        document: vscode.TextDocument,
        position: vscode.Position,
        context: AutocompleteContextSnippet[],
        tokenBudget: AutoEditsTokenLimit
    ): PromptResponseData {
        const { codeToReplace, prompt: userPrompt } = getBaseUserPrompt(
            docContext,
            document,
            position,
            context,
            tokenBudget
        )
        const promptResponse: ChatPrompt = [
            {
                role: 'system',
                content: SYSTEM_PROMPT,
            },
            {
                role: 'user',
                content: userPrompt,
            },
        ]
        return { codeToReplace, promptResponse }
    }

    postProcessResponse(codeToReplace: CodeToReplaceData, response: string): string {
        return response
    }

    async getModelResponse(
        url: string,
        model: string,
        apiKey: string,
        prompt: ChatPrompt
    ): Promise<string> {
        try {
            const headers = {
                'X-Sourcegraph-Feature': 'chat_completions',
            }
            const body = {
                stream: false,
                model: model,
                messages: prompt,
                temperature: 0.2,
                max_tokens: 256,
                response_format: {
                    type: 'text',
                },
            }
            const response = await getModelResponse(url, JSON.stringify(body), apiKey, headers)
            return response.choices[0].message.content
        } catch (error) {
            autoeditsLogger.logDebug('AutoEdits', 'Error calling Cody Gateway:', error)
            throw error
        }
    }
}