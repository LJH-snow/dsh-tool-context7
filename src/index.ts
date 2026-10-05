import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context7Client, Context7Error } from './client.js'

export const name = 'dsh-tool-context7'
export const inject = ['tools']

export interface Context7PluginConfig {
  baseUrl?: string
  /** Environment variable containing a Context7 API key. Optional: keyless requests use lower public rate limits. */
  apiKeyEnv?: string
  timeoutMs?: number
}

export function apply(ctx: Context, config: Context7PluginConfig = {}) {
  const apiKeyEnv = config.apiKeyEnv ?? 'CONTEXT7_API_KEY'
  const client = new Context7Client({
    baseUrl: config.baseUrl,
    apiKey: process.env[apiKeyEnv],
    timeoutMs: config.timeoutMs,
  })
  for (const tool of createTools(client)) ctx.tools.register(tool)
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }]
}

function unavailable(reason: string) {
  return { found: false, items: [], reason }
}

function errorReason(error: unknown): string {
  return error instanceof Context7Error ? error.message : error instanceof Error ? error.message : String(error)
}

const SNIPPET_RENDER_LIMIT = 6
const CONTENT_RENDER_LIMIT = 2500

function renderLibraries(items: Array<{ id?: string; name?: string; description?: string; totalSnippets?: number; trustScore?: number; benchmarkScore?: number; versions?: string[] }>) {
  if (!items.length) return text('No Context7 libraries matched.')
  return text(items.map(library => [
    `${library.id ?? ''} — ${library.name ?? ''} trust=${library.trustScore ?? 0} snippets=${library.totalSnippets ?? 0} benchmark=${library.benchmarkScore ?? 0}${library.versions?.length ? ` versions=${library.versions.join(',')}` : ''}`,
    library.description ? `  ${library.description}` : '',
  ].filter(Boolean).join('\n')).join('\n'))
}

function renderSnippets(items: Array<{ kind?: string; title?: string; language?: string; content?: string; source?: string; libraryId?: string }>) {
  if (!items.length) return text('No Context7 documentation matched.')
  const shown = items.slice(0, SNIPPET_RENDER_LIMIT).map((snippet, index) => {
    const header = `## ${index + 1}. ${snippet.title ?? ''} [${snippet.kind ?? ''}${snippet.language ? `/${snippet.language}` : ''}] source=${snippet.source ?? ''}${snippet.libraryId ? ` library=${snippet.libraryId}` : ''}`
    const content = (snippet.content ?? '').slice(0, CONTENT_RENDER_LIMIT)
    const suffix = (snippet.content ?? '').length > CONTENT_RENDER_LIMIT ? `\n[...content truncated in preview]` : ''
    return `${header}\n${content}${suffix}`
  })
  if (items.length > SNIPPET_RENDER_LIMIT) shown.push(`... ${items.length - SNIPPET_RENDER_LIMIT} more snippets omitted`)
  return text(shown.join('\n\n'))
}

export function createTools(client: Context7Client) {
  return [
    defineTool({
      name: 'context7_auth_test',
      description: 'Verify Context7 access. Reports whether an API key is configured; keyless requests use lower public rate limits.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, authenticated: { type: 'boolean' }, baseUrl: { type: 'string' } } },
        render: (_args, value) => value.ok
          ? text(`Context7 access verified at ${value.baseUrl ?? ''} authenticated=${value.authenticated ? 'yes' : 'no (public rate limits)'}`)
          : text(`Context7 access check failed: ${value.reason ?? ''}`),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'Verify Context7 access', kind: 'read' } },
      async execute(_args, exec) {
        try {
          await client.authTest(exec?.signal)
          return { ok: true, authenticated: client.hasCredentials(), baseUrl: client.getBaseUrl() }
        } catch (error) { return { ok: false, reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'context7_search_libraries',
      description: 'Search Context7 for libraries by name and get their library IDs. Results are capped at 20 entries.',
      parameters: {
        libraryName: { type: 'string', required: true, description: 'Library name to search for, e.g. react' },
        query: { type: 'string', description: 'Your task or question, used for relevance ranking; defaults to libraryName' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, totalSnippets: { type: 'number' }, trustScore: { type: 'number' }, benchmarkScore: { type: 'number' }, versions: { type: 'array', items: { type: 'string' } } } } } } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'Context7 search failed.') : renderLibraries(value.items ?? []),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Search Context7 libraries: ${args.libraryName ?? ''}`, kind: 'search' } },
      async execute(args, exec) {
        if (!args.libraryName) return unavailable('libraryName is required.')
        try {
          return { found: true, items: await client.searchLibraries({ libraryName: args.libraryName as string, query: args.query as string, signal: exec?.signal }) }
        } catch (error) { return unavailable(errorReason(error)) }
      },
    }),

    defineTool({
      name: 'context7_get_library_docs',
      description: 'Get up-to-date documentation snippets for one Context7 library ID. Content is capped; no API key is ever returned.',
      parameters: {
        libraryId: { type: 'string', required: true, description: 'Context7 library ID, e.g. /react/react' },
        query: { type: 'string', required: true, description: 'Your task or question to focus the documentation' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, truncated: { type: 'boolean' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, title: { type: 'string' }, language: { type: 'string' }, content: { type: 'string' }, source: { type: 'string' }, libraryId: { type: 'string' } } } } } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'Context7 docs unavailable.') : renderSnippets(value.items ?? []),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Context7 docs: ${args.libraryId ?? ''}`, kind: 'read' } },
      async execute(args, exec) {
        if (!args.libraryId || !args.query) return unavailable('libraryId and query are required.')
        try { return { found: true, ...await client.getContext({ libraryId: args.libraryId as string, query: args.query as string, signal: exec?.signal }) } }
        catch (error) { return unavailable(errorReason(error)) }
      },
    }),

    defineTool({
      name: 'context7_search_docs',
      description: 'Search documentation across libraries without resolving a library ID first, optionally preferring specific libraries, a version, or a language.',
      parameters: {
        query: { type: 'string', required: true, description: 'Your task or question' },
        libraries: { type: 'string', description: 'Comma-separated library names or IDs to prefer (up to 4)' },
        version: { type: 'string', description: 'Version to prefer; requires a libraries hint' },
        language: { type: 'string', description: 'Programming language to prefer when ranking snippets' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, truncated: { type: 'boolean' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, title: { type: 'string' }, language: { type: 'string' }, content: { type: 'string' }, source: { type: 'string' }, libraryId: { type: 'string' } } } } } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'Context7 search failed.') : renderSnippets(value.items ?? []),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Search docs: ${args.query ?? ''}`, kind: 'search' } },
      async execute(args, exec) {
        if (!args.query) return unavailable('query is required.')
        const libraries = typeof args.libraries === 'string' && args.libraries.trim()
          ? args.libraries.split(',').map(item => item.trim()).filter(Boolean)
          : undefined
        try {
          return { found: true, ...await client.searchDocs({
            query: args.query as string,
            libraries,
            version: args.version as string,
            language: args.language as string,
            signal: exec?.signal,
          }) }
        } catch (error) { return unavailable(errorReason(error)) }
      },
    }),
  ]
}
