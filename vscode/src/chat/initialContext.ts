import {
    type AuthenticatedAuthStatus,
    type ContextItem,
    type DefaultContext,
    FeatureFlag,
    type ContextItemOpenCtx,
    type ContextItemRepository,
    REMOTE_REPOSITORY_PROVIDER_URI,
    authStatus,
    distinctUntilChanged,
    featureFlagProvider,
    fromVSCodeEvent,
    isDotCom,
    openCtx,
    pendingOperation,
    shareReplay,
    switchMap,
} from '@sourcegraph/cody-shared'
import { Observable, map } from 'observable-fns'
import * as vscode from 'vscode'
import { URI } from 'vscode-uri'
import { getSelectionOrFileContext } from '../commands/context/selection'
import { remoteReposForAllWorkspaceFolders } from '../repository/remoteRepos'
import { ChatBuilder } from './chat-view/ChatBuilder'
import { GitignoreFilter } from './gitignore_filter'

interface RemoteRepoInfo {
    name: string
    id?: number | string
    url?: string
    description?: string
}

function createEmptyObservable<T>(): Observable<T[]> {
    return new Observable<T[]>(observer => {
        observer.next([])
        observer.complete()
    })
}

function combineLatestWithTypes<T1, T2, T3, T4>(
    o1: Observable<T1>,
    o2: Observable<T2>,
    o3: Observable<T3>,
    o4: Observable<T4>
): Observable<[T1, T2, T3, T4]> {
    return new Observable<[T1, T2, T3, T4]>(observer => {
        const values: [T1 | undefined, T2 | undefined, T3 | undefined, T4 | undefined] = [undefined, undefined, undefined, undefined]
        const subscriptions = [
            o1.subscribe({
                next: value => {
                    values[0] = value
                    if (values.every(v => v !== undefined)) {
                        observer.next(values as [T1, T2, T3, T4])
                    }
                },
                error: (err: Error) => observer.error(err),
            }),
            o2.subscribe({
                next: value => {
                    values[1] = value
                    if (values.every(v => v !== undefined)) {
                        observer.next(values as [T1, T2, T3, T4])
                    }
                },
                error: (err: Error) => observer.error(err),
            }),
            o3.subscribe({
                next: value => {
                    values[2] = value
                    if (values.every(v => v !== undefined)) {
                        observer.next(values as [T1, T2, T3, T4])
                    }
                },
                error: (err: Error) => observer.error(err),
            }),
            o4.subscribe({
                next: value => {
                    values[3] = value
                    if (values.every(v => v !== undefined)) {
                        observer.next(values as [T1, T2, T3, T4])
                    }
                },
                error: (err: Error) => observer.error(err),
            }),
        ]
        return () => subscriptions.forEach(sub => sub.unsubscribe())
    })
}

export function observeDefaultContext({
    chatBuilder,
}: {
    chatBuilder: Observable<ChatBuilder>
}): Observable<DefaultContext | typeof pendingOperation> {
    return new Observable<DefaultContext | typeof pendingOperation>(observer => {
        const fileContext$ = getCurrentFileOrSelection({ chatBuilder }).pipe(distinctUntilChanged())
        const corpusContext$ = getCorpusContextItemsForEditorState().pipe(distinctUntilChanged())
        const openCtxContext$ = getOpenCtxContextItems().pipe(distinctUntilChanged())
        const noDefaultRepoChip$ = featureFlagProvider.evaluatedFeatureFlag(FeatureFlag.NoDefaultRepoChip)

        const subscription = combineLatestWithTypes(
            fileContext$,
            corpusContext$,
            openCtxContext$,
            noDefaultRepoChip$
        ).subscribe({
            next: ([fileContext, corpusContext, openCtxContext]) => {
                if (
                    typeof fileContext === 'symbol' ||
                    typeof corpusContext === 'symbol' ||
                    typeof openCtxContext === 'symbol'
                ) {
                    observer.next(pendingOperation)
                    return
                }

                observer.next({
                    initialContext: [
                        ...(openCtxContext || []),
                        ...(fileContext || []),
                        ...(corpusContext || []),
                    ],
                    corpusContext: [],
                })
            },
            error: (error: Error) => observer.error(error),
            complete: () => observer.complete(),
        })

        return () => subscription.unsubscribe()
    })
}

const activeTextEditor = fromVSCodeEvent(
    vscode.window.onDidChangeActiveTextEditor,
    () => vscode.window.activeTextEditor
).pipe(shareReplay())

export function getCurrentFileOrSelection({
    chatBuilder,
}: {
    chatBuilder: Observable<ChatBuilder>
}): Observable<ContextItem[]> {
    return activeTextEditor.pipe(
        switchMap(editor => {
            if (!editor) {
                return createEmptyObservable<ContextItem>()
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri)
            if (!workspaceFolder) {
                return createEmptyObservable<ContextItem>()
            }

            // Get gitignore filter for the workspace
            const filter = new GitignoreFilter(workspaceFolder.uri.fsPath)

            // Check if the current file should be included
            if (!filter.shouldIncludeInContext(editor.document.uri.fsPath)) {
                return createEmptyObservable<ContextItem>()
            }

            return new Observable<ContextItem[]>(observer => {
                getSelectionOrFileContext().then(items => {
                    observer.next(items)
                    observer.complete()
                }).catch(error => {
                    console.error('Error getting selection context:', error)
                    observer.next([])
                    observer.complete()
                })
            })
        })
    )
}

export function getCorpusContextItemsForEditorState(): Observable<ContextItem[]> {
    const relevantAuthStatus = authStatus.pipe(
        map((status): Partial<AuthenticatedAuthStatus> => ({
            authenticated: isDotCom(status.endpoint) && status.authenticated ? true : undefined,
            endpoint: isDotCom(status.endpoint) ? status.endpoint : '',
            username: '',
            displayName: '',
            avatarURL: '',
            primaryEmail: '',
            pendingValidation: true as const,
            organizations: [],
        })),
        distinctUntilChanged()
    )

    return new Observable<ContextItem[]>(observer => {
        const subscription = combineLatestWithTypes(
            relevantAuthStatus,
            remoteReposForAllWorkspaceFolders,
            createEmptyObservable<never>(),
            createEmptyObservable<never>()
        ).subscribe({
            next: ([status, repos]) => {
                if (!status.authenticated || !Array.isArray(repos) || repos.length === 0) {
                    observer.next([])
                    return
                }

                const items: ContextItemRepository[] = repos.map((repo: RemoteRepoInfo) => ({
                    type: 'repository',
                    provider: 'openctx',
                    uri: URI.parse(repo.url || ''),
                    repoName: repo.name || '',
                    repoID: repo.id?.toString() || repo.name || '',
                    content: null,
                    title: repo.name || '',
                    description: repo.description || '',
                    providerUri: REMOTE_REPOSITORY_PROVIDER_URI,
                }))

                observer.next(items)
            },
            error: (error: Error) => observer.error(error),
            complete: () => observer.complete(),
        })

        return () => subscription.unsubscribe()
    })
}

function getOpenCtxContextItems(): Observable<ContextItem[]> {
    const openctxController = openCtx.controller
    if (!openctxController) {
        return createEmptyObservable<ContextItem>()
    }

    return new Observable<ContextItem[]>(observer => {
        openctxController.mentions({}, { providerUri: undefined }).then(
            items => {
                observer.next(items.map(item => ({
                    type: 'openctx',
                    provider: 'openctx',
                    ...item,
                    uri: URI.parse(item.uri),
                } as ContextItemOpenCtx)))
                observer.complete()
            },
            error => {
                console.error('Error getting OpenCtx items:', error)
                observer.next([])
                observer.complete()
            }
        )
    })
}
