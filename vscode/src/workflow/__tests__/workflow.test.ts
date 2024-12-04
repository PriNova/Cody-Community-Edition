import { v4 as uuidv4 } from 'uuid'
import { expect, test } from 'vitest'
import {
    type CLINode,
    NodeType,
    type WorkflowNodes,
} from '../../../webviews/workflow/components/nodes/Nodes'
import { topologicalSort } from '../workflow-executor'

test('workflow executes correctly with UUID node IDs', () => {
    const id1 = uuidv4()
    const id2 = uuidv4()

    const nodes: WorkflowNodes[] = [
        {
            id: id1,
            type: NodeType.CLI,
            data: { title: 'CLI Node', command: 'echo "hello"' },
            position: { x: 0, y: 0 },
        } as CLINode,
        {
            id: id2,
            type: 'preview' as NodeType,
            data: { title: 'Preview Node' },
            position: { x: 0, y: 0 },
        },
    ]
    const edges = [{ id: uuidv4(), source: id1, target: id2 }]

    const sortedNodes = topologicalSort(nodes, edges)
    expect(sortedNodes[0].id).toBe(id1)
    expect(sortedNodes[1].id).toBe(id2)
})

test('topology sort maintains order with UUID nodes', () => {
    const id1 = uuidv4()
    const id2 = uuidv4()
    const id3 = uuidv4()

    const nodes: WorkflowNodes[] = [
        {
            id: id1,
            type: 'cli' as NodeType,
            data: { title: 'First CLI' },
            position: { x: 0, y: 0 },
        },
        {
            id: id2,
            type: 'llm' as NodeType,
            data: { title: 'LLM Node' },
            position: { x: 0, y: 0 },
        },
        {
            id: id3,
            type: 'preview' as NodeType,
            data: { title: 'Preview' },
            position: { x: 0, y: 0 },
        },
    ]

    const edges = [
        { id: uuidv4(), source: id1, target: id2 },
        { id: uuidv4(), source: id2, target: id3 },
    ]

    const sortedNodes = topologicalSort(nodes, edges)
    expect(sortedNodes).toHaveLength(3)
    expect(sortedNodes[0].id).toBe(id1)
    expect(sortedNodes[1].id).toBe(id2)
    expect(sortedNodes[2].id).toBe(id3)
})
