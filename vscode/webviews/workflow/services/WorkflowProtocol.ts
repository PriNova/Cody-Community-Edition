import type { Edge, WorkflowNode } from '../components/nodes/Nodes'

export type WorkflowToExtension = {
    type: 'save_workflow' | 'load_workflow' | 'execute_workflow'
    data?: {
        nodes: WorkflowNode[] | undefined
        edges: Edge[] | undefined
    }
}

export type WorkflowFromExtension = {
    type:
        | 'hello_webview'
        | 'workflow_loaded'
        | 'execution_started'
        | 'execution_completed'
        | 'node_execution_status'
    data?: {
        nodes: WorkflowNode[]
        edges: Edge[]
        nodeId?: string
        status?: 'running' | 'completed' | 'error'
        result?: string
    }
}
