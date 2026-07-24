# Browser Automated Testing

AI 驱动的前端自动化检测工具：输入目标 URL + 测试提示词，Agent 会像测试人员一样控制浏览器检查布局、交互、接口和控制台问题，并以 **GPT 风格流式对话**反馈过程与结论。

> 说明：Codex 桌面端的 `control-chrome` 依赖私有 browser runtime / Chrome 扩展。本项目把同一测试思路产品化，使用 **Playwright + OpenAI 兼容接口** 独立运行。`skills/control-chrome` 会作为系统提示注入 Agent。

## 功能

- 对接第三方中转站（OpenAI 兼容：`base_url` + `api_key` + `model`）
- 流式 SSE 对话，实时显示思考文本与工具执行
- Playwright 控制浏览器：打开页面、点击、输入、滚动、截图
- 自动采集网络请求与控制台日志
- Skills 可扩展（`skills/*/SKILL.md`）

## 快速开始

```bash
npm install
# 首次会自动 playwright install chromium；如失败可手动：
npx playwright install chromium

cp .env.example .env
# 可选：在 .env 写入默认 LLM 配置；也可只在页面左侧填写

npm run dev
```

- 前端：http://127.0.0.1:5173
- Agent 服务：http://127.0.0.1:8787

## 使用方式

1. 左侧填写中转站 `Base URL`、`API Key`、`Model`
2. 填写目标 URL（或在提示词里说明）
3. 输入测试需求，例如：

```text
像测试人员一样检查当前页面：布局、可用性、接口错误、控制台报错，并输出分级问题报告。
```

4. 观察流式输出与工具轨迹（snapshot / network / screenshot 等）
5. 查看最终问题报告

## 架构

```text
Vue 3 对话 UI  --SSE-->  Express Agent  --tools-->  Playwright Browser
                              |
                         skills/*.md
                              |
                    OpenAI-compatible LLM Gateway
```

### 主要目录

- `src/` 前端对话与设置界面
- `server/src/agent` LLM 工具循环与流式事件
- `server/src/browser` Playwright 会话与工具
- `server/src/skills` Skill 加载器
- `skills/control-chrome/SKILL.md` 测试行为准则

## API

### `POST /api/chat`（SSE）

```json
{
  "messages": [{ "role": "user", "content": "检查首页布局和接口" }],
  "llm": {
    "baseUrl": "https://your-gateway.com/v1",
    "apiKey": "sk-xxx",
    "model": "gpt-4o-mini"
  },
  "session": {
    "targetUrl": "https://example.com",
    "headless": false,
    "maxSteps": 16
  }
}
```

事件类型：`session` / `status` / `delta` / `tool_start` / `tool_result` / `error` / `done`

### `GET /api/skills`

返回已加载 skill 列表。

### `GET /api/health`

健康检查。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | Agent 端口，默认 8787 |
| `LLM_BASE_URL` | 默认中转站地址 |
| `LLM_API_KEY` | 默认 API Key |
| `LLM_MODEL` | 默认模型 |
| `MAX_AGENT_STEPS` | 默认最大工具循环步数 |

## 与 Codex control-chrome 的关系

| 能力 | Codex Desktop | 本项目 |
| --- | --- | --- |
| 控制用户已登录 Chrome | ✅ 扩展/native host | 可选后续增强 |
| 独立可分发产品 | ❌ | ✅ |
| 自定义中转站 LLM | 取决于 Codex 配置 | ✅ 页面可配 |
| 流式对话 UI | Codex 内置 | ✅ 自研 |
| Skill 驱动测试策略 | ✅ | ✅ `skills/` |

## 后续可增强

- 连接用户本机 Chrome（CDP / 扩展）复用登录态
- 多页用例编排与回归报告导出
- 视觉回归（截图 diff）
- 录制操作轨迹回放
