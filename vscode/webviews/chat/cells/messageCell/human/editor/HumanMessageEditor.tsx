import {
    type ChatMessage,
    FAST_CHAT_INPUT_TOKEN_BUDGET,
    type Model,
    ModelTag,
    type SerializedPromptEditorState,
    type SerializedPromptEditorValue,
    firstValueFrom,
    getTokenCounterUtils,
    inputTextWithoutContextChipsFromPromptEditorState,
    skipPendingOperation,
    textContentFromSerializedLexicalNode,
} from '@sourcegraph/cody-shared'
import {
    ContextItemMentionNode,
    PromptEditor,
    type PromptEditorRefAPI,
    useDefaultContextForChat,
    useExtensionAPI,
} from '@sourcegraph/prompt-editor'
import clsx from 'clsx'
import { debounce } from 'lodash'
import {
    type FocusEventHandler,
    type FunctionComponent,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react'
import type { UserAccountInfo } from '../../../../../Chat'
import { type ClientActionListener, useClientActionListener } from '../../../../../client/clientState'
import { promptModeToIntent } from '../../../../../prompts/PromptsTab'
import { getVSCodeAPI } from '../../../../../utils/VSCodeApi'
import { useTelemetryRecorder } from '../../../../../utils/telemetry'
import { useExperimentalOneBox } from '../../../../../utils/useExperimentalOneBox'
import styles from './HumanMessageEditor.module.css'
import type { SubmitButtonState } from './toolbar/SubmitButton'
import { Toolbar } from './toolbar/Toolbar'

/**
 * A component to compose and edit human chat messages and the settings associated with them.
 */
export const HumanMessageEditor: FunctionComponent<{
    models: Model[]
    userInfo: UserAccountInfo

    initialEditorState: SerializedPromptEditorState | undefined
    placeholder: string

    /** Whether this editor is for the first message (not a followup). */
    isFirstMessage: boolean

    /** Whether this editor is for a message that has been sent already. */
    isSent: boolean

    /** Whether this editor is for a followup message to a still-in-progress assistant response. */
    isPendingPriorResponse: boolean

    disabled?: boolean

    onEditorFocusChange?: (focused: boolean) => void
    onChange?: (editorState: SerializedPromptEditorValue) => void
    onSubmit: (intent?: ChatMessage['intent']) => void
    onStop: () => void

    isFirstInteraction?: boolean
    isLastInteraction?: boolean
    isEditorInitiallyFocused?: boolean
    className?: string

    editorRef?: React.RefObject<PromptEditorRefAPI | null>

    /** For use in storybooks only. */
    __storybook__focus?: boolean

    initialIntent?: ChatMessage['intent']
    transcriptTokens?: number
    imageFile?: File
    setImageFile: (file: File | undefined) => void
}> = ({
    models,
    userInfo,
    initialEditorState,
    placeholder,
    isFirstMessage,
    isSent,
    isPendingPriorResponse,
    disabled = false,
    onChange,
    onSubmit: parentOnSubmit,
    onStop,
    isFirstInteraction,
    isLastInteraction,
    isEditorInitiallyFocused,
    className,
    editorRef: parentEditorRef,
    __storybook__focus,
    onEditorFocusChange: parentOnEditorFocusChange,
    initialIntent,
    transcriptTokens,
    imageFile,
    setImageFile,
}) => {
    const telemetryRecorder = useTelemetryRecorder()

    const editorRef = useRef<PromptEditorRefAPI>(null)
    useImperativeHandle(parentEditorRef, (): PromptEditorRefAPI | null => editorRef.current, [])

    // The only PromptEditor state we really need to track in our own state is whether it's empty.
    const [isEmptyEditorValue, setIsEmptyEditorValue] = useState(
        initialEditorState
            ? textContentFromSerializedLexicalNode(initialEditorState.lexicalEditorState.root) === ''
            : true
    )
    const [tokenCount, setTokenCount] = useState<number>(0)
    const [tokenAdded, setTokenAdded] = useState<number>(0)

    useEffect(() => {
        const editor = editorRef.current
        if (!editor) {
            return
        }
        // Listen for changes to ContextItemMentionNode to update the token count.
        // This updates the token count when a mention is added or removed.
        const unregister = editor.registerMutationListener(ContextItemMentionNode, (node: any) => {
            const value = editor.getSerializedValue()
            const items = value.contextItems
            if (!items?.length) {
                setTokenAdded(0)
                return
            }
            setTokenAdded(items.reduce((acc, item) => acc + (item.size ? item.size : 0), 0))
        })
        return unregister
    }, [])

    // Move token counter outside callback for stability
    const tokenCounter = useMemo(async () => await getTokenCounterUtils(), [])

    // Create stable debounced function outside main callback
    const debouncedCount = useMemo(
        () =>
            debounce(async (text: string) => {
                const counter = await tokenCounter
                //const tokenCount = counter.encode(text).length
                setTokenCount(counter.encode(text).length)
            }, 300), // Reduced debounce time for better responsiveness
        [tokenCounter]
    )

    // Replace the current onChange implementation with:
    const onEditorChange = useCallback(
        async (value: SerializedPromptEditorValue): Promise<void> => {
            onChange?.(value)
            setIsEmptyEditorValue(!value?.text?.trim())

            // Get pure text without @-mentions
            const pureText = inputTextWithoutContextChipsFromPromptEditorState(value.editorState)

            await debouncedCount(pureText)
        },
        [onChange, debouncedCount]
    )

    const submitState: SubmitButtonState = isPendingPriorResponse
        ? 'waitingResponseComplete'
        : isEmptyEditorValue
          ? 'emptyEditorValue'
          : 'submittable'

    const experimentalOneBoxEnabled = useExperimentalOneBox()
    const [submitIntent, setSubmitIntent] = useState<ChatMessage['intent'] | undefined>(
        initialIntent || (experimentalOneBoxEnabled ? undefined : 'chat')
    )

    useEffect(() => {
        // reset the input box intent when the editor is cleared
        if (isEmptyEditorValue) {
            setSubmitIntent(undefined)
        }
    }, [isEmptyEditorValue])

    useEffect(() => {
        // set the input box intent when the message is changed or a new chat is created
        setSubmitIntent(initialIntent)
    }, [initialIntent])

    const onSubmitClick = useCallback(
        (intent?: ChatMessage['intent'], forceSubmit?: boolean): void => {
            if (!forceSubmit && submitState === 'emptyEditorValue') {
                return
            }

            if (!forceSubmit && submitState === 'waitingResponseComplete') {
                onStop()
                return
            }

            if (!editorRef.current) {
                throw new Error('No editorRef')
            }

            const value = editorRef.current.getSerializedValue()

            const processImage = async () => {
                if (imageFile) {
                    const readFileGetBase64String = (file: File): Promise<string> => {
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader()
                            reader.onload = () => {
                                const base64 = reader.result
                                if (base64 && typeof base64 === 'string') {
                                    resolve(base64.split(',')[1])
                                } else {
                                    reject(new Error('Failed to read file'))
                                }
                            }
                            reader.onerror = () => reject(new Error('Failed to read file'))
                            reader.readAsDataURL(file)
                        })
                    }

                    const base64 = await readFileGetBase64String(imageFile)
                    getVSCodeAPI().postMessage({
                        command: 'chat/upload-image',
                        image: base64,
                    })
                }
            }
            setImageFile(undefined)
            processImage()

            parentOnSubmit(intent)

            telemetryRecorder.recordEvent('cody.humanMessageEditor', 'submit', {
                metadata: {
                    isFirstMessage: isFirstMessage ? 1 : 0,
                    isEdit: isSent ? 1 : 0,
                    messageLength: value.text.length,
                    contextItems: value.contextItems.length,
                    intent: [undefined, 'chat', 'search'].findIndex(i => i === intent),
                },
                billingMetadata: {
                    product: 'cody',
                    category: 'billable',
                },
            })
        },
        [
            submitState,
            parentOnSubmit,
            onStop,
            telemetryRecorder.recordEvent,
            isFirstMessage,
            isSent,
            imageFile,
            setImageFile,
        ]
    )

    const onEditorEnterKey = useCallback(
        (event: KeyboardEvent | null): void => {
            // Submit input on Enter press (without shift) when input is not empty.
            if (!event || event.isComposing || isEmptyEditorValue || event.shiftKey) {
                return
            }

            event.preventDefault()

            // Submit search intent query when CMD + Options + Enter is pressed.
            if ((event.metaKey || event.ctrlKey) && event.altKey) {
                setSubmitIntent('search')
                onSubmitClick('search')
                return
            }

            // Submit chat intent query when CMD + Enter is pressed.
            if (event.metaKey || event.ctrlKey) {
                setSubmitIntent('chat')
                onSubmitClick('chat')
                return
            }

            onSubmitClick(submitIntent)
        },
        [isEmptyEditorValue, onSubmitClick, submitIntent]
    )

    const [isEditorFocused, setIsEditorFocused] = useState(false)
    const onEditorFocusChange = useCallback(
        (focused: boolean): void => {
            setIsEditorFocused(focused)
            parentOnEditorFocusChange?.(focused)
        },
        [parentOnEditorFocusChange]
    )

    const [isFocusWithin, setIsFocusWithin] = useState(false)
    const onFocus = useCallback(() => {
        setIsFocusWithin(true)
    }, [])
    const onBlur = useCallback<FocusEventHandler>(event => {
        // If we're shifting focus to one of our child elements, just skip this call because we'll
        // immediately set it back to true.
        const container = event.currentTarget as HTMLElement
        if (event.relatedTarget && container.contains(event.relatedTarget)) {
            return
        }

        setIsFocusWithin(false)
    }, [])

    useEffect(() => {
        if (isEditorInitiallyFocused) {
            // Only focus the editor if the user hasn't made another selection or has scrolled down.
            // It would be annoying if we clobber the user's intentional selection with the autofocus.
            const selection = window.getSelection()
            const userHasIntentionalSelection = selection && !selection.isCollapsed
            if (!userHasIntentionalSelection) {
                editorRef.current?.setFocus(true, { moveCursorToEnd: true })
                window.scrollTo({
                    top: window.document.body.scrollHeight,
                })
            }
        }
    }, [isEditorInitiallyFocused])

    /**
     * If the user clicks in a gap, focus the editor so that the whole component "feels" like an input field.
     */
    const onGapClick = useCallback(() => {
        editorRef.current?.setFocus(true, { moveCursorToEnd: true })
    }, [])
    const onMaybeGapClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            const targetIsToolbarButton = event.target !== event.currentTarget
            if (!targetIsToolbarButton) {
                event.preventDefault()
                event.stopPropagation()
                onGapClick?.()
            }
        },
        [onGapClick]
    )

    const onMentionClick = useCallback((): void => {
        if (!editorRef.current) {
            throw new Error('No editorRef')
        }
        if (editorRef.current.getSerializedValue().text.trim().endsWith('@')) {
            editorRef.current.setFocus(true, { moveCursorToEnd: true })
        } else {
            editorRef.current.appendText('@')
        }

        const value = editorRef.current.getSerializedValue()
        telemetryRecorder.recordEvent('cody.humanMessageEditor.toolbar.mention', 'click', {
            metadata: {
                isFirstMessage: isFirstMessage ? 1 : 0,
                isEdit: isSent ? 1 : 0,
                messageLength: value.text.length,
                contextItems: value.contextItems.length,
            },
            billingMetadata: {
                product: 'cody',
                category: 'billable',
            },
        })
    }, [telemetryRecorder.recordEvent, isFirstMessage, isSent])

    const extensionAPI = useExtensionAPI()

    // Set up the message listener so the extension can control the input field.
    useClientActionListener(
        // Add new context to chat from the "Cody Add Selection to Cody Chat"
        // command, etc. Only add to the last human input field.
        { isActive: !isSent },
        useCallback<ClientActionListener>(
            ({
                editorState,
                addContextItemsToLastHumanInput,
                appendTextToLastPromptEditor,
                submitHumanInput,
                setLastHumanInputIntent,
                setPromptAsInput,
            }) => {
                const updates: Promise<unknown>[] = []

                if (addContextItemsToLastHumanInput && addContextItemsToLastHumanInput.length > 0) {
                    const editor = editorRef.current
                    if (editor) {
                        updates.push(editor.addMentions(addContextItemsToLastHumanInput, 'after'))
                        updates.push(editor.setFocus(true))
                    }
                }

                if (appendTextToLastPromptEditor) {
                    // Schedule append text task to the next tick to avoid collisions with
                    // initial text set (add initial mentions first then append text from prompt)
                    updates.push(
                        new Promise<void>((resolve): void => {
                            requestAnimationFrame(() => {
                                if (editorRef.current) {
                                    editorRef.current
                                        .appendText(appendTextToLastPromptEditor)
                                        .then(resolve)
                                } else {
                                    resolve()
                                }
                            })
                        })
                    )
                }

                if (editorState) {
                    updates.push(
                        new Promise<void>(resolve => {
                            requestAnimationFrame(async () => {
                                if (editorRef.current) {
                                    await Promise.all([
                                        editorRef.current.setEditorState(editorState),
                                        editorRef.current.setFocus(true),
                                    ])
                                }
                                resolve()
                            })
                        })
                    )
                }
                if (setLastHumanInputIntent) {
                    setSubmitIntent(setLastHumanInputIntent)
                }

                let promptIntent = undefined

                if (setPromptAsInput) {
                    // set the intent
                    promptIntent = promptModeToIntent(setPromptAsInput.mode)

                    updates.push(
                        // biome-ignore lint/suspicious/noAsyncPromiseExecutor: <explanation>
                        new Promise<void>(async resolve => {
                            // get initial context
                            const { initialContext } = await firstValueFrom(
                                extensionAPI.defaultContext().pipe(skipPendingOperation())
                            )
                            // hydrate raw prompt text
                            const promptEditorState = await firstValueFrom(
                                extensionAPI.hydratePromptMessage(setPromptAsInput.text, initialContext)
                            )

                            // update editor state
                            requestAnimationFrame(async () => {
                                if (editorRef.current) {
                                    await Promise.all([
                                        editorRef.current.setEditorState(promptEditorState),
                                        editorRef.current.setFocus(true),
                                    ])
                                }
                                resolve()
                            })
                        })
                    )
                }

                if (submitHumanInput || setPromptAsInput?.autoSubmit) {
                    Promise.all(updates).then(() =>
                        onSubmitClick(promptIntent || setLastHumanInputIntent || submitIntent, true)
                    )
                }
            },
            [onSubmitClick, submitIntent, extensionAPI.hydratePromptMessage, extensionAPI.defaultContext]
        )
    )

    const currentChatModel = useMemo(() => models[0], [models[0]])

    const defaultContext = useDefaultContextForChat()
    useEffect(() => {
        let { initialContext } = defaultContext
        if (!isSent && isFirstMessage) {
            const editor = editorRef.current
            if (editor) {
                // Don't show the initial codebase context if the model doesn't support streaming
                // as including context result in longer processing time.
                if (currentChatModel?.tags?.includes(ModelTag.StreamDisabled)) {
                    initialContext = initialContext.filter(item => item.type !== 'tree')
                }
                editor.setInitialContextMentions(initialContext)
            }
        }
    }, [defaultContext, isSent, isFirstMessage, currentChatModel])

    const focusEditor = useCallback(() => editorRef.current?.setFocus(true), [])

    useEffect(() => {
        if (__storybook__focus && editorRef.current) {
            setTimeout(() => focusEditor())
        }
    }, [__storybook__focus, focusEditor])

    const focused = Boolean(isEditorFocused || isFocusWithin || __storybook__focus)
    const contextWindowSizeInTokens =
        currentChatModel?.contextWindow?.context?.user ||
        currentChatModel?.contextWindow?.input ||
        FAST_CHAT_INPUT_TOKEN_BUDGET

    const totalContextWindow =
        (currentChatModel?.contextWindow?.context?.user || 0) +
        (currentChatModel?.contextWindow?.input || 0)

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: only relevant to click areas
        <div
            className={clsx(
                styles.container,
                {
                    [styles.sent]: isSent,
                    [styles.focused]: focused,
                },
                'tw-transition',
                className
            )}
            data-keep-toolbar-open={isLastInteraction || undefined}
            onMouseDown={onMaybeGapClick}
            onClick={onMaybeGapClick}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            <PromptEditor
                seamless={true}
                placeholder={placeholder}
                initialEditorState={initialEditorState}
                onChange={onEditorChange}
                onFocusChange={onEditorFocusChange}
                onEnterKey={onEditorEnterKey}
                editorRef={editorRef}
                disabled={disabled}
                contextWindowSizeInTokens={contextWindowSizeInTokens}
                editorClassName={styles.editor}
                contentEditableClassName={styles.editorContentEditable}
            />
            {!disabled && (
                <Toolbar
                    models={models}
                    userInfo={userInfo}
                    isEditorFocused={focused}
                    onMentionClick={onMentionClick}
                    onSubmitClick={onSubmitClick}
                    submitState={submitState}
                    onGapClick={onGapClick}
                    focusEditor={focusEditor}
                    hidden={!focused && isSent}
                    className={styles.toolbar}
                    intent={submitIntent}
                    onSelectIntent={setSubmitIntent}
                    tokenCount={tokenCount + tokenAdded}
                    contextWindow={totalContextWindow}
                    transcriptTokens={transcriptTokens}
                    isLastInteraction={isLastInteraction}
                    imageFile={imageFile}
                    setImageFile={setImageFile}
                />
            )}
        </div>
    )
}
