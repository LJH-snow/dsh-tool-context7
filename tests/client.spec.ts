import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context7Client, Context7Error } from '../src/client.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const testApiKey = process.env.CONTEXT7_TEST_API_KEY ?? `ctx7sk-test-${randomUUID()}`

function client(fetchImpl: ReturnType<typeof vi.fn>, apiKey = testApiKey) {
  return new Context7Client({ baseUrl: 'https://context7.test.invalid/api', apiKey, fetchImpl })
}

describe('Context7Client', () => {
  it('sends keyless requests without an authorization header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }))
    const result = await new Context7Client({ baseUrl: 'https://context7.test.invalid/api', fetchImpl }).authTest()

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://context7.test.invalid/api/v2/libs/search?query=react&libraryName=react')
    expect(init.headers as Record<string, string>).not.toHaveProperty('authorization')
  })

  it('authenticates with the bearer header without exposing the key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }))
    const result = await client(fetchImpl).authTest()

    expect(result).toEqual({ ok: true })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${testApiKey}`)
    expect(JSON.stringify(result)).not.toContain(testApiKey)
  })

  it('searches libraries with query defaulting to libraryName and caps results', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: `/org/lib-${index}`, title: `Lib ${index}`, description: `Desc ${index}`,
      totalSnippets: index, trustScore: 9, benchmarkScore: 50, versions: ['v1', 'v2'],
    }))
    const fetchImpl = vi.fn(async () => jsonResponse({ results: many }))
    const result = await client(fetchImpl).searchLibraries({ libraryName: 'react' })

    expect(result).toHaveLength(20)
    expect(result[0]).toEqual({
      id: '/org/lib-0', name: 'Lib 0', description: 'Desc 0', totalSnippets: 0, trustScore: 9, benchmarkScore: 50, versions: ['v1', 'v2'],
    })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://context7.test.invalid/api/v2/libs/search?query=react&libraryName=react')
  })

  it('gets library docs and maps code and info snippets', async () => {
    const longCode = 'c'.repeat(7000)
    const fetchImpl = vi.fn(async () => jsonResponse({
      codeSnippets: [{
        codeTitle: 'Fetch hook', codeDescription: 'Use the hook', codeLanguage: 'ts',
        codeList: [{ language: 'ts', code: longCode }, { language: 'js', code: 'short' }],
        codeId: 'code-1', pageTitle: 'Hooks Guide',
      }],
      infoSnippets: [{ content: 'Info content', breadcrumb: 'Guide > Hooks', pageId: 'page-9' }],
    }))
    const result = await client(fetchImpl).getContext({ libraryId: '/org/lib', query: 'how to use hooks' })

    expect(result.items).toHaveLength(2)
    const code = result.items[0]
    expect(code).toMatchObject({ kind: 'code', title: 'Fetch hook', language: 'ts', source: 'Hooks Guide (code-1)' })
    expect(code.content).toContain('```ts')
    expect(code.content).toHaveLength(6000)
    expect(code.content).not.toContain('```js')
    const info = result.items[1]
    expect(info).toMatchObject({ kind: 'info', title: 'Guide > Hooks', content: 'Info content', source: 'page-9' })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://context7.test.invalid/api/v2/context?query=how+to+use+hooks&libraryId=%2Forg%2Flib')
  })

  it('stops adding snippets once the total content limit is reached', async () => {
    const bigSnippet = { codeTitle: 'Big', codeDescription: '', codeLanguage: 'ts', codeList: [{ language: 'ts', code: 'x'.repeat(6000) }], codeId: 'b1' }
    const fetchImpl = vi.fn(async () => jsonResponse({
      codeSnippets: Array.from({ length: 6 }, () => bigSnippet),
      infoSnippets: [],
    }))
    const result = await client(fetchImpl).getContext({ libraryId: '/org/lib', query: 'q' })

    expect(result.truncated).toBe(true)
    expect(result.items.length).toBeGreaterThan(1)
    expect(result.items.length).toBeLessThan(6)
    const total = result.items.reduce((sum, item) => sum + item.content.length, 0)
    expect(total).toBeLessThanOrEqual(20000)
  })

  it('searches docs with repeated library params and version/language hints', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      codeSnippets: [{ codeTitle: 'S1', codeLanguage: 'py', codeList: [{ language: 'py', code: 'print(1)' }], codeId: 'c1', libraryId: '/org/lib' }],
      infoSnippets: [{ content: 'Note', pageId: 'p1', libraryId: '/org/other' }],
      rules: { global: [], libraries: [] },
    }))
    const result = await client(fetchImpl).searchDocs({ query: 'queue setup', libraries: ['/org/lib', 'other'], version: '2.0', language: 'python' })

    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'code', title: 'S1', language: 'py', libraryId: '/org/lib' }),
      expect.objectContaining({ kind: 'info', title: 'p1', content: 'Note', libraryId: '/org/other' }),
    ])
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://context7.test.invalid/api/v3/search?query=queue+setup&library=%2Forg%2Flib&library=other&version=2.0&language=python')
  })

  it('maps HTTP errors without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Rate limited' }, 429))
    await expect(client(fetchImpl).authTest()).rejects.toThrow(Context7Error)
    await expect(client(fetchImpl).authTest()).rejects.toThrow('Rate limited')
    expect(JSON.stringify({})).not.toContain(testApiKey)
  })
})
