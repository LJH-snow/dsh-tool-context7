# dsh-tool-context7 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-context7` |
| 定位 | DeepSeek Harness 的 Context7 实时文档插件 |
| 版本 | v0.1.0 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | Context7 v2/v3 REST（`https://context7.com/api`，契约取自官方 SDK `upstash/context7` 源码） |
| 认证 | `Authorization: Bearer ctx7sk-...`（可选；无 Key 走公共限流模式，头整体省略） |

### 1.1 目录

```text
src/client.ts        Context7Client：fetch 注入、超时、AbortSignal、错误映射、限长
src/index.ts         4 个 defineTool 定义与插件 apply
 tests/client.spec.ts 客户端认证、端点路径、映射、限长、错误测试
 tests/tools.spec.ts  工具注册、render、kind 与端到端测试
examples/cordis.yml  dsh 组合配置示例
```

## 2. 技术决策

### 2.1 端点契约（2026-10 对照官方 SDK 核对）

- `GET /v2/libs/search?query={任务}&libraryName={库名}` → `{ results: [{ id, title, description, versions?, totalSnippets?, trustScore?, benchmarkScore? }] }`；`title` 映射为 `name`。
- `GET /v2/context?query={任务}&libraryId={库ID}` → `{ codeSnippets: [{ codeTitle, codeDescription, codeLanguage, codeList: [{language, code}], codeId, pageTitle? }], infoSnippets: [{ content, breadcrumb?, pageId }] }`。
- `GET /v3/search?query={任务}[&library=...&library=...][&version=][&language=]` → 同上片段各带 `libraryId`；`library` 以重复键序列化（最多 4 个）。
- 数组参数用 `URLSearchParams.append` 重复键；无 Key 时不发 authorization 头（对齐官方 HTTP 客户端）。

### 2.2 工具范围

- 全部只读：auth_test、search_libraries、get_library_docs、search_docs。
- 不做：任何写操作（服务无公开写接口）、缓存代理、本地文档存储。

### 2.3 限长与脱敏

- 库搜索截取前 20 条；docs 片段 12 个（v3 搜索 8 代码 + 8 信息），单片段 6000 字符、单响应累计 20000 字符，超限置 `truncated` 并停止添加。
- Key 只从 `apiKeyEnv`（默认 `CONTEXT7_API_KEY`）读取，不进入 URL、返回值、渲染文本；测试用运行时随机 `ctx7sk-test-...` 值。
- 代码片段重新拼装为围栏代码块（```lang），保留 language/source 元数据。

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

测试覆盖无 Key/有 Key 的请求头行为、端点与查询参数序列化（含重复 library）、库结果映射与截断、代码/信息片段映射、单片段与总量限长、HTTP 错误映射、工具注册、render、kind 与端到端执行。

## 4. 后续方向

- 跟随 Context7 API 版本演进（v3 端点尚新）补充兼容性测试。
- 增加可选的响应磁盘缓存以降低重复查询。
- 按 trustScore/benchmarkScore 提供排序提示参数。
