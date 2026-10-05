import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context7Client, Context7Error } from '../src/client.ts'

/** Deterministic DNS so tests never depend on real resolution. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }]


function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const testApiKey = process.env.CONTEXT7_TEST_API_KEY ?? `ctx7sk-test-${randomUUID()}`

function client(fetchImpl: ReturnType<typeof vi.fn>, apiKey = testApiKey) {
  return new Context7Client({ lookupImpl: publicLookup, baseUrl: 'https://context7.test.invalid/api', apiKey, fetchImpl })
}

describe('Context7Client', () => {
  it('sends keyless requests without an authorization header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }))
    const result = await new Context7Client({ lookupImpl: publicLookup, baseUrl: 'https://context7.test.invalid/api', fetchImpl }).authTest()

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

describe('Context7 endpoint security', () => {
  const valid = { apiKey: 'ctx7sk_test' }

  it('rejects invalid base URLs without exposing their contents', () => {
    for (const baseUrl of [
      'context7.com/api',
      'ftp://context7.com/api',
      'https://user:secretcontext7.com/api',
      'https://context7.com/api?token=secret',
      'https://context7.com/api#fragment',
    ]) {
      let error: unknown
      try { new Context7Client({ ...valid, baseUrl }) } catch (thrown) { error = thrown }
      expect(error).toBeInstanceOf(Context7Error)
      expect(String(error)).not.toContain('secret')
    }
  })

  it('rejects literal local, private, and reserved addresses before fetch', async () => {
    for (const baseUrl of [
      'http://localhost',
      'http://service.localhost',
      'http://service.local',
      'http://127.0.0.1',
      'http://169.254.169.254',
      'http://0.0.0.0',
      'http://10.0.0.1',
      'http://192.168.1.1',
      'http://192.0.2.1',
      'http://198.18.0.1',
      'http://224.0.0.1',
      'http://192.175.48.1',
      'http://[::1]',
      'http://[::]',
      'http://[fc00::1]',
      'http://[fe80::1]',
      'http://[fec0::1]',
      'http://[2001:db8::1]',
      'http://[2001:3::1]',
      'http://[2001:4:112::1]',
      'http://[2001:30::1]',
      'http://[5f00::1]',
      'http://[100:0:0:1::1]',
      'http://[2620:4f:8000::1]',
      'http://[64:ff9b::7f00:1]',
      'http://[ff02::1]',
    ]) {
      const fetchImpl = vi.fn()
      await expect(new Context7Client({ ...valid, baseUrl, fetchImpl }).authTest()).rejects.toBeInstanceOf(Context7Error)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('fails closed on blocked, failed, empty, or inconsistent DNS results', async () => {
    for (const lookupImpl of [
      async () => [{ address: '192.168.1.10', family: 4 as const }],
      async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '169.254.169.254', family: 4 as const }],
      async () => { throw new Error('dns failure') },
      async () => [],
      async () => [{ address: '2001:db8::1', family: 4 as const }],
    ]) {
      const fetchImpl = vi.fn()
      await expect(new Context7Client({ ...valid, baseUrl: 'https://context7.example.test', fetchImpl, lookupImpl }).authTest()).rejects.toBeInstanceOf(Context7Error)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('allows a public endpoint that resolves to a public address', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await new Context7Client({ ...valid, baseUrl: 'https://context7.example.test', fetchImpl, lookupImpl: publicLookup }).authTest().catch(() => undefined)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
