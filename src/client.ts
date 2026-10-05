/** Context7 REST API client (v2 libs/context, v3 search) with injected fetch for testability. */
import { assertSafeUrl, EndpointSecurityError, normalizeBaseUrl, type LookupImpl } from './url-security.js'

export interface Context7ClientOptions {
  /** Context7 API root, for example https://context7.com/api. */
  baseUrl?: string
  /** Context7 API key (ctx7sk-...). Optional: requests work keyless with lower rate limits. */
  apiKey?: string
  /** HTTP request timeout in milliseconds. 0 disables the timeout. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Test-only DNS lookup override; production uses node:dns/promises. */
  lookupImpl?: LookupImpl
}

export class Context7Error extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'Context7Error'
  }
}

export interface Context7LibraryInfo {
  id: string
  name: string
  description: string
  totalSnippets: number
  trustScore: number
  benchmarkScore: number
  versions: string[]
}

export interface Context7SnippetInfo {
  kind: 'code' | 'info'
  title: string
  language: string
  content: string
  source: string
  libraryId: string
}

export interface Context7DocsResult {
  items: Context7SnippetInfo[]
  truncated: boolean
}

export interface Context7SearchResult {
  items: Context7SnippetInfo[]
  truncated: boolean
}

const SNIPPET_LIMIT = 6000
const DOCS_SNIPPETS_LIMIT = 12
const DOCS_TOTAL_LIMIT = 20000
const SEARCH_CODE_LIMIT = 8
const SEARCH_INFO_LIMIT = 8
const SEARCH_TOTAL_LIMIT = 20000
const LIBRARIES_LIMIT = 20

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clampText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value
}

function mapLibrary(value: unknown): Context7LibraryInfo {
  const record = asRecord(value)
  return {
    id: asString(record.id),
    name: asString(record.title),
    description: asString(record.description),
    totalSnippets: asNumber(record, 'totalSnippets'),
    trustScore: asNumber(record, 'trustScore'),
    benchmarkScore: asNumber(record, 'benchmarkScore'),
    versions: asArray(record.versions).map(version => asString(version)).filter(Boolean),
  }
}

function mapSnippet(value: unknown, kind: 'code' | 'info'): Context7SnippetInfo {
  const record = asRecord(value)
  if (kind === 'code') {
    const blocks = asArray(record.codeList)
      .map(block => {
        const item = asRecord(block)
        const language = asString(item.language)
        const code = clampText(asString(item.code), SNIPPET_LIMIT)
        return code ? `\`\`\`${language}\n${code}\n\`\`\`` : ''
      })
      .filter(Boolean)
    const codeId = asString(record.codeId)
    const pageTitle = asString(record.pageTitle)
    return {
      kind,
      title: asString(record.codeTitle) || pageTitle || codeId,
      language: asString(record.codeLanguage) || asString(asRecord(asArray(record.codeList)[0]).language),
      content: blocks.join('\n\n'),
      source: pageTitle ? `${pageTitle} (${codeId})` : codeId,
      libraryId: asString(record.libraryId),
    }
  }
  return {
    kind,
    title: asString(record.breadcrumb) || asString(record.pageId),
    language: '',
    content: asString(record.content),
    source: asString(record.pageId),
    libraryId: asString(record.libraryId),
  }
}

export class Context7Client {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly lookupImpl: LookupImpl | undefined

  constructor(options: Context7ClientOptions = {}) {
    try {
      this.baseUrl = normalizeBaseUrl(options.baseUrl, 'https://context7.com/api')
    } catch (error) {
      if (error instanceof EndpointSecurityError) throw new Context7Error(error.message, 400)
      throw error
    }
    this.apiKey = options.apiKey ?? ''
    this.timeoutMs = options.timeoutMs ?? 30000
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.lookupImpl = options.lookupImpl
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey)
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  private async request<T = unknown>(path: string, params: Record<string, string | readonly string[] | undefined>, signal?: AbortSignal): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item))
    }
    try {
      await assertSafeUrl(url, this.lookupImpl)
    } catch (error) {
      if (error instanceof EndpointSecurityError) throw new Context7Error(error.message, 400)
      throw error
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.hasCredentials()) headers.authorization = `Bearer ${this.apiKey}`
    const controller = new AbortController()
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const timer = this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined
    try {
      const response = await this.fetchImpl(url.toString(), { method: 'GET', headers, signal: combined })
      const raw = await response.text()
      let json: unknown = {}
      if (raw) {
        try { json = JSON.parse(raw) } catch { json = {} }
      }
      if (!response.ok) {
        const record = asRecord(json)
        const message = asString(record.error) || asString(record.message) || raw.slice(0, 300) || response.statusText
        throw new Context7Error(`Context7 API GET ${path} returned HTTP ${response.status}: ${message}`, response.status)
      }
      return json as T
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async authTest(signal?: AbortSignal): Promise<{ ok: boolean }> {
    await this.request('/v2/libs/search', { query: 'react', libraryName: 'react' }, signal)
    return { ok: true }
  }

  async searchLibraries(options: { libraryName: string; query?: string; signal?: AbortSignal }): Promise<Context7LibraryInfo[]> {
    const raw = await this.request('/v2/libs/search', {
      query: options.query ?? options.libraryName,
      libraryName: options.libraryName,
    }, options.signal)
    return asArray(asRecord(raw).results).map(mapLibrary)
      .filter(library => library.id)
      .slice(0, LIBRARIES_LIMIT)
  }

  async getContext(options: { libraryId: string; query: string; signal?: AbortSignal }): Promise<Context7DocsResult> {
    const raw = await this.request('/v2/context', { query: options.query, libraryId: options.libraryId }, options.signal)
    const record = asRecord(raw)
    return this.collectSnippets([
      ...asArray(record.codeSnippets).map(item => mapSnippet(item, 'code')),
      ...asArray(record.infoSnippets).map(item => mapSnippet(item, 'info')),
    ], DOCS_SNIPPETS_LIMIT, DOCS_TOTAL_LIMIT)
  }

  async searchDocs(options: { query: string; libraries?: string[]; version?: string; language?: string; signal?: AbortSignal }): Promise<Context7SearchResult> {
    const raw = await this.request('/v3/search', {
      query: options.query,
      library: options.libraries?.slice(0, 4).filter(Boolean),
      version: options.version,
      language: options.language,
    }, options.signal)
    const record = asRecord(raw)
    return this.collectSnippets([
      ...asArray(record.codeSnippets).slice(0, SEARCH_CODE_LIMIT).map(item => mapSnippet(item, 'code')),
      ...asArray(record.infoSnippets).slice(0, SEARCH_INFO_LIMIT).map(item => mapSnippet(item, 'info')),
    ], SEARCH_CODE_LIMIT + SEARCH_INFO_LIMIT, SEARCH_TOTAL_LIMIT)
  }

  private collectSnippets(snippets: Context7SnippetInfo[], countLimit: number, totalLimit: number): Context7DocsResult {
    const items: Context7SnippetInfo[] = []
    let total = 0
    let truncated = false
    for (const snippet of snippets) {
      if (items.length >= countLimit) {
        truncated = true
        break
      }
      const content = clampText(snippet.content, SNIPPET_LIMIT)
      if (total + content.length > totalLimit) {
        truncated = true
        break
      }
      total += content.length
      items.push({ ...snippet, content })
    }
    return { items, truncated }
  }
}
