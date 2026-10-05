# dsh-tool-context7

[English](README.md) | [中文](README.zh.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 [Context7](https://context7.com) 实时文档 Cordis 插件。Agent 可以搜索库、按库 ID 拉取最新文档片段、跨库搜索文档——让回答基于当前 API 而不是过时的训练数据。

## 安装

```sh
npm install @libai168/dsh-tool-context7
```

需要 peer dependency：`@deepseek-ai/cordis`（^4.0.1）和 `@deepseek-ai/dsh-tools`（^0.1.0-rc.6）。

## 配置

```yaml
- name: 'github:LJH-snow/dsh-tool-context7'
  config:
    # baseUrl: 'https://context7.com/api'
    # apiKeyEnv: 'CONTEXT7_API_KEY'
    # timeoutMs: 30000
```

API Key 是可选的：不配置时请求走 Context7 公共模式（限流较低）。配置后，插件从 `apiKeyEnv` 指定的环境变量读取密钥（格式 `ctx7sk-...`，默认变量名 `CONTEXT7_API_KEY`）。不要把可用密钥写入源码、示例、测试或提交的配置文件。密钥在 Context7 控制台创建。

`baseUrl` 覆盖 必须是绝对的 `http://` 或 `https://` 根地址。只允许公网可达主机：localhost、环回、私有、链路本地、CGNAT、组播、保留/文档/基准测试网段以及全部 IANA 特殊用途地址段都会被拒绝；DNS 结果包含任一此类地址时会在发出请求前 fail closed。不允许 credentials、query、fragment 或非根路径。

## 工具

| 工具 | 说明 | 写操作 |
|---|---|---|
| `context7_auth_test` | 验证访问并报告是否配置了密钥 | 否 |
| `context7_search_libraries` | 按名称搜索库并返回库 ID | 否 |
| `context7_get_library_docs` | 获取单个库 ID 的文档片段 | 否 |
| `context7_search_docs` | 跨库搜索文档，可指定库/版本/语言偏好 | 否 |

## 安全契约

- API Key 在插件启动时从环境变量读取，不进入工具返回值或渲染文本；不配置时请求直接省略 authorization 头。
- 库搜索上限 20 条；文档响应最多 12 个片段（搜索为 8 代码 + 8 信息），单片段 6000 字符、单响应 20000 字符，超出时返回 `truncated` 标记。
- 所有工具均为只读；不提供任何写、删除或账号管理工具。
- 调用方取消信号会传递给 `fetch`，默认请求超时 30 秒。
- API 错误会规范化为 `{ ok: false, reason }` 或 `{ found: false, reason }`。

## API 范围

当前版本使用经官方 SDK 源码核对的 Context7 v2/v3 端点：`GET /v2/libs/search`、`GET /v2/context`、`GET /v3/search`（`library` 参数以重复键序列化，最多 4 个）。该服务没有公开写接口，因此不做任何写操作。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## 许可证

[MIT](LICENSE)
