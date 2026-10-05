# dsh-tool-context7

[English](README.md) | [中文](README.zh.md)

[Context7](https://context7.com) up-to-date documentation integration for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) as a Cordis plugin. The agent can search libraries, pull current documentation snippets for a library ID, and search docs across libraries — so answers use current APIs instead of outdated training data.

## Install

```sh
npm install @libai168/dsh-tool-context7
```

Requires `@deepseek-ai/cordis` (^4.0.1) and `@deepseek-ai/dsh-tools` (^0.1.0-rc.6) as peer dependencies.

## Configuration

```yaml
- name: 'github:LJH-snow/dsh-tool-context7'
  config:
    # baseUrl: 'https://context7.com/api'
    # apiKeyEnv: 'CONTEXT7_API_KEY'
    # timeoutMs: 30000
```

The API key is optional: without one, requests run in Context7's public mode with lower rate limits. When configured, the plugin reads the key (format `ctx7sk-...`) from the environment variable named by `apiKeyEnv` (default: `CONTEXT7_API_KEY`). Do not put a usable key in source, examples, tests, or committed configuration. Create the key in the Context7 dashboard.

## Tools

| Tool | Description | Write |
|---|---|---|
| `context7_auth_test` | Verify access and report whether a key is configured | No |
| `context7_search_libraries` | Search libraries by name and return library IDs | No |
| `context7_get_library_docs` | Get documentation snippets for one library ID | No |
| `context7_search_docs` | Search docs across libraries with optional library/version/language hints | No |

## Security contract

- The API key is read from an environment variable at plugin startup and is never included in tool output or rendered text; without a key, requests simply omit the authorization header.
- Library results are capped at 20 entries; docs responses at 12 snippets (8 code + 8 info for search) with 6,000 characters per snippet and 20,000 characters per response, flagged via `truncated`.
- All tools are read-only; there are no write, delete, or account-management tools.
- The client passes caller cancellation signals through to `fetch` and uses a 30-second timeout by default.
- API failures are normalized into `{ ok: false, reason }` or `{ found: false, reason }` tool results.

## API scope

This version uses the Context7 v2/v3 endpoints verified against the official SDK source: `GET /v2/libs/search`, `GET /v2/context`, and `GET /v3/search` (repeated `library` params for up to four library hints). There is no documented write surface, so none is implemented.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## License

[MIT](LICENSE)
