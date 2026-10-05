import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context7Client } from '../src/client.ts'
import { createTools } from '../src/index.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const clientForTest = () => new Context7Client({ apiKey: process.env.CONTEXT7_TEST_API_KEY ?? `ctx7sk-test-${randomUUID()}` })

describe('dsh-tool-context7 tools', () => {
  it('registers the Context7 tool set', () => {
    expect(createTools(clientForTest()).map(tool => tool.name)).toEqual([
      'context7_auth_test',
      'context7_search_libraries',
      'context7_get_library_docs',
      'context7_search_docs',
    ])
  })

  it('renders library results and doc snippets', () => {
    const tools = createTools(clientForTest())
    const search = tools.find(item => item.name === 'context7_search_libraries')!
    const searchView = search.output.render({}, {
      found: true,
      items: [{ id: '/react/react', name: 'React', description: 'UI library', totalSnippets: 120, trustScore: 10, benchmarkScore: 95, versions: ['19'] }],
    }) as Array<{ text: string }>
    expect(searchView[0].text).toContain('/react/react — React trust=10 snippets=120 benchmark=95 versions=19')
    expect(searchView[0].text).toContain('UI library')

    const docs = tools.find(item => item.name === 'context7_get_library_docs')!
    const docsView = docs.output.render({}, {
      found: true,
      truncated: false,
      items: [{ kind: 'code', title: 'Fetch hook', language: 'ts', content: 'const x = 1', source: 'Guide (c1)', libraryId: '/react/react' }],
    }) as Array<{ text: string }>
    expect(docsView[0].text).toContain('## 1. Fetch hook [code/ts] source=Guide (c1) library=/react/react')
    expect(docsView[0].text).toContain('const x = 1')

    const emptyView = docs.output.render({}, { found: true, items: [] }) as Array<{ text: string }>
    expect(emptyView[0].text).toContain('No Context7 documentation matched')
  })

  it('marks every tool as read or search and runs the library search through the tool layer', async () => {
    const tools = createTools(clientForTest())
    expect(tools.find(item => item.name === 'context7_auth_test')!.presentCall({})).toMatchObject({ kind: 'read' })
    expect(tools.find(item => item.name === 'context7_search_libraries')!.presentCall({ libraryName: 'react' })).toMatchObject({ kind: 'search' })
    expect(tools.find(item => item.name === 'context7_get_library_docs')!.presentCall({ libraryId: '/r/r', query: 'q' })).toMatchObject({ kind: 'read' })
    expect(tools.find(item => item.name === 'context7_search_docs')!.presentCall({ query: 'q' })).toMatchObject({ kind: 'search' })

    const fetchImpl = vi.fn(async () => jsonResponse({ results: [{ id: '/react/react', title: 'React', description: 'UI', totalSnippets: 1, trustScore: 10, benchmarkScore: 99 }] }))
    const mockedTools = createTools(new Context7Client({ apiKey: `ctx7sk-test-${randomUUID()}`, fetchImpl }))
    const mockedSearch = mockedTools.find(item => item.name === 'context7_search_libraries')!
    const args = { libraryName: 'react' }
    const found = await mockedSearch.execute(args)
    expect(found).toMatchObject({ found: true, items: [{ id: '/react/react', name: 'React' }] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const auth = mockedTools.find(item => item.name === 'context7_auth_test')!
    const result = await auth.execute({})
    expect(result).toMatchObject({ ok: true, authenticated: true })
  })
})
