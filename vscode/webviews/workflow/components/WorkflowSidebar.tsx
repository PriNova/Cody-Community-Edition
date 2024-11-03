import type React from 'react'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '../../components/shadcn/ui/accordion'
import { Button } from '../../components/shadcn/ui/button'
import { PropertyEditor } from './PropertyEditor'
import { NodeType, type WorkflowNode } from './nodes/Nodes'

interface WorkflowSidebarProps {
    onNodeAdd: (nodeLabel: string, nodeType: NodeType) => void
    selectedNode?: WorkflowNode | null
    onNodeUpdate?: (nodeId: string, data: Partial<WorkflowNode['data']>) => void
}

export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
    onNodeAdd,
    selectedNode,
    onNodeUpdate,
}) => {
    return (
        <div className="tw-w-64 tw-border-r tw-border-border tw-h-full tw-bg-sidebar-background tw-p-4">
            <Accordion type="single" collapsible>
                <AccordionItem value="cli">
                    <AccordionTrigger>CLI Actions</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <div className="tw-border">
                                <Button
                                    onClick={() => onNodeAdd('Git Diff', NodeType.CLI)}
                                    className="tw-w-full tw-justify-start"
                                    variant="ghost"
                                >
                                    Git Diff
                                </Button>
                            </div>
                            <div className="tw-border">
                                <Button
                                    onClick={() => onNodeAdd('Git Commit', NodeType.CLI)}
                                    className="tw-w-full tw-justify-start"
                                    variant="ghost"
                                >
                                    Git Commit
                                </Button>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem value="llm">
                    <AccordionTrigger>Cody LLM Actions</AccordionTrigger>
                    <AccordionContent>
                        <div className="tw-flex tw-flex-col tw-gap-2">
                            <div className="tw-border">
                                <Button
                                    onClick={() => onNodeAdd('Cody Generate Commit', NodeType.LLM)}
                                    className="tw-w-full tw-justify-start"
                                    variant="ghost"
                                >
                                    Cody Inference
                                </Button>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            <div className="tw-my-4 tw-border-t tw-border-border" />

            <div className="tw-p-2">
                <h3 className="tw-text-sm tw-font-medium">Property Editor</h3>
                {selectedNode ? (
                    <PropertyEditor node={selectedNode} onUpdate={onNodeUpdate || (() => {})} />
                ) : (
                    <p className="tw-text-sm tw-text-muted-foreground tw-mt-2">
                        Select a node to edit its properties
                    </p>
                )}
            </div>
        </div>
    )
}
