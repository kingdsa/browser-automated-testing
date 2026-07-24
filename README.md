# Browser Automated Testing

AI 驱动的前端自动化检测工具：输入目标 URL + 测试提示词，Agent 会像测试人员一样控制浏览器检查布局、交互、接口和控制台问题，并以 **GPT 风格流式对话**反馈过程；最终输出 **完整 Markdown 测试报告**，可一键保存为 `.md` 文档。

> 说明：Codex 桌面端的 `control-chrome` 依赖私有 browser runtime / Chrome 扩展。本项目把同一测试思路产品化，使用 **Playwright + OpenAI 兼容接口** 独立运行。`skills/control-chrome` 会作为系统提示注入 Agent。

## 项目预览

![Browser Automated Testing 项目预览](./image.png)

## 功能

- 对接第三方中转站（OpenAI 兼容：`base_url` + `api_key` + `model`）
- 流式 SSE 对话，实时显示思考文本与工具执行
- Playwright 控制浏览器：打开页面、点击、输入、滚动、截图
- 支持登录态：
  - **推荐**：新开浏览器 + “等待手动登录”（无需配置 Chrome/Edge/360）
  - **可选**：自动扫描本机远程调试端口，附着已打开标签（保留登录态）
- 自动采集网络请求与控制台日志
- 最终输出完整 Markdown 测试报告；界面可 **保存最后一次 AI 的 MD 文档**
- Skills 可扩展（`skills/*/SKILL.md`）
- **需求分析**：上传 PRD/需求文档，AI 提取功能点，并以可编辑逻辑思维导图展示

## 快速开始

```bash
npm install
# 首次会自动 playwright install chromium；如失败可手动：
npx playwright install chromium

cp .env.example .env
# 可选：在 .env 写入默认 LLM 配置；也可只在页面左侧填写

npm run dev
```

- 前端：http://127.0.0.1:5199
- 需求分析：http://127.0.0.1:5199/requirements
- Agent 服务：http://127.0.0.1:8787

> 需要 Node.js `^22.18.0` 或 `>=24.12.0`。

## 使用方式

1. 左侧填写中转站 `Base URL`、`API Key`、`Model`
2. 填写目标 URL（或在提示词里说明）
3. 若页面需要登录，二选一：
   - 勾选 **等待手动登录**：开始后在弹出浏览器里登录，系统检测到业务页后自动继续
   - 或用远程调试方式启动浏览器并打开已登录页面，点“重新扫描”附着该标签（Chrome/Edge/360 等 Chromium 内核通用，无需按品牌配置）
4. 输入测试需求，并明确要求输出 Markdown 报告，例如：

```text
像测试人员一样检查当前页面：布局、可用性、接口错误、控制台报错，最后请输出完整 Markdown 测试报告。
```

5. 观察流式输出与工具轨迹（snapshot / network / screenshot 等）
6. 测试结束后点击 **保存本次测试结果**：
   - 仅保存 **最后一次 AI 完整回复** 作为 Markdown 文档
   - 支持的浏览器可弹出选目录对话框；否则回退为浏览器默认下载
   - 默认文件名形如 `browser-test-report-YYYYMMDD-HHmm.md`
   - 示例报告：[browser-test-report-20260724-1614.md](./browser-test-report-20260724-1614.md)

## 架构

```text
Vue 3 对话 UI  --SSE-->  Express Agent  --tools-->  Playwright Browser
                              |
                         skills/*.md
                              |
                    OpenAI-compatible LLM Gateway
```

### 主要目录

- `src/` 前端对话、设置与报告保存
- `src/utils/report.ts` 提取最后一次 AI Markdown 并保存本地
- `server/src/agent` LLM 工具循环与流式事件
- `server/src/browser` Playwright 会话与工具
- `server/src/skills` Skill 加载器（注入“输出完整 MD 报告”约束）
- `server/src/routes` REST / SSE API
- `skills/control-chrome/SKILL.md` 测试行为准则
- `server/data/screenshots/` 截图静态资源目录

## API

### `POST /api/chat`（SSE）

```json
{
  "messages": [{ "role": "user", "content": "检查首页布局和接口，最后输出完整 Markdown 测试报告" }],
  "llm": {
    "baseUrl": "https://your-gateway.com/v1",
    "apiKey": "sk-xxx",
    "model": "gpt-4o-mini"
  },
  "session": {
    "targetUrl": "https://example.com",
    "headless": false,
    "maxSteps": 0,
    "browserMode": "auto",
    "waitForLogin": true,
    "loginWaitSeconds": 180,
    "cdpEndpoint": "",
    "attachUrlIncludes": ""
  }
}
```

事件类型：`session` / `status` / `delta` / `tool_start` / `tool_result` / `error` / `done`

### `GET /api/skills`

返回已加载 skill 列表。

### `GET /api/defaults`

返回服务端默认 LLM / session 配置（供前端预填）。

### `GET /api/browser/tabs`

扫描本机可附着的 Chromium 远程调试标签，用于侧边栏“重新扫描”。

### `POST /api/requirements/analyze`

上传需求文档或粘贴文本，AI 提取功能点并返回思维导图 JSON（`multipart/form-data`：`file` 可选、`content` 可选、`llm` JSON 字符串）。

### `POST /api/requirements/extract`

仅解析上传文档文本（支持 `.md/.txt/.docx`）。

### `GET /api/health`

健康检查。

### `GET /screenshots/*`

访问本次测试产生的截图静态文件。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | Agent 端口，默认 8787 |
| `LLM_BASE_URL` | 默认中转站地址 |
| `LLM_API_KEY` | 默认 API Key |
| `LLM_MODEL` | 默认模型 |
| `MAX_AGENT_STEPS` | 默认最大工具循环步数（`0` = 无限） |
| `PLAYWRIGHT_HEADLESS` / `HEADLESS` | 是否默认无头；不填则自动检测（Linux 无 DISPLAY/WAYLAND_DISPLAY 时默认 `true`） |

## 服务器部署（无图形界面）

Linux 服务器通常没有 X Server，Playwright **不能**在本机弹出可操作的浏览器窗口，否则会报：

`Looks like you launched a headed browser without having a XServer running`

### 场景 1：不需要登录 / 可用固定账号脚本登录
1. 服务器安装浏览器依赖：`npx playwright install chromium` 以及（Linux）`npx playwright install-deps chromium`
2. 保持 `browserMode=auto` 或 `launch`
3. **勾选无头模式**（或设置 `PLAYWRIGHT_HEADLESS=true`）
4. **关闭**“等待手动登录”

### 场景 2：仍然要用“等待手动登录”（推荐：远程 CDP）
线上 Agent 跑在服务器，登录窗口开在你本机（或任意有界面机器）：

1. 在**有界面机器**用远程调试启动 Chromium 内核浏览器，并打开目标站：

```bash
# macOS Chrome 示例
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-bat-profile" \
  --remote-allow-origins=* \
  "https://你的业务站"
```

2. 确保服务器能访问该调试端口（同 VPC / 内网穿透 / SSH 隧道均可）。SSH 隧道示例：

```bash
# 在服务器上把本机 9222 转到你电脑的 9222
ssh -N -R 9222:127.0.0.1:9222 user@server
# 或反过来：在你电脑把服务器请求转到本机
ssh -N -L 0.0.0.0:9222:127.0.0.1:9222 user@your-laptop
```

3. 前端设置：
   - 勾选 **等待手动登录**
   - 高级里填写 `cdpEndpoint`，例如 `http://你的电脑内网IP:9222` 或隧道后的 `http://127.0.0.1:9222`
   - 开始测试后，在**那台有界面机器**的浏览器里完成登录；服务端会等待业务页出现后继续

> 说明：无图形服务器上“等待手动登录”**不能**再依赖本机弹窗；它依赖你提供的远程 headed 浏览器。

### 场景 3：必须在服务器本机 headed（虚拟显示）

```bash
# Debian/Ubuntu
sudo apt-get install -y xvfb
# 仅虚拟显示（你仍看不到窗口，除非再配 VNC）
xvfb-run -a npm run server
```

若还要**看见并操作**服务器浏览器，请再加 x11vnc / noVNC，用 VNC 客户端连上去登录。

服务端逻辑：

- 检测到 Linux 且无 `DISPLAY`/`WAYLAND_DISPLAY` 时，本地 `launch`/`auto` 会**自动强制 headless**
- `waitForLogin` 且未配置 `cdpEndpoint`：返回明确错误
- `waitForLogin` 且配置了 `cdpEndpoint`：允许，并强制通过远程 CDP 附着，等待你在远程浏览器登录

## 测试报告

Agent 系统提示会要求最终输出 **完整、可直接保存的 Markdown 文档**，建议包含：

- 测试目标
- 覆盖范围
- 问题列表（级别 / 现象 / 证据 / 建议）
- 结论与风险

前端 **保存本次测试结果** 的规则：

1. 只取会话中 **最后一次非流式 AI 回复** 的正文
2. 不拼接多轮过程、不额外包装工具轨迹
3. 因此请在用户输入中明确要求：“输出完整 Markdown 测试报告”
4. 下载文件名示例：`browser-test-report-20260724-1614.md`（完整示例见 [browser-test-report-20260724-1614.md](./browser-test-report-20260724-1614.md)）

## 与 Codex control-chrome 的关系

| 能力 | Codex Desktop | 本项目 |
| --- | --- | --- |
| 控制用户已登录 Chrome | ✅ 扩展/native host | ✅ 手动登录 / CDP 附着（Chromium 系） |
| 独立可分发产品 | ❌ | ✅ |
| 自定义中转站 LLM | 取决于 Codex 配置 | ✅ 页面可配 |
| 流式对话 UI | Codex 内置 | ✅ 自研 |
| Skill 驱动测试策略 | ✅ | ✅ `skills/` |
| 导出 Markdown 报告 | 视会话能力 | ✅ 一键保存最后一次 AI MD |

## 登录态说明

### 方案 A（本机桌面，零配置）
1. 浏览器模式选 `auto` 或 `launch`
2. 勾选 **等待手动登录**
3. 开始测试后，在弹出窗口完成登录
4. 系统识别到非登录页后自动继续

### 方案 A2（线上服务器仍要手动登录）
1. 在有界面机器启动带 `--remote-debugging-port` 的 Chromium
2. 把该地址填到 `cdpEndpoint`
3. 勾选 **等待手动登录**
4. 在那台机器上登录；Agent 附着并等待业务页后继续

### 方案 B（附着已打开标签）
1. 用远程调试端口启动任意 Chromium 内核浏览器（Chrome / Edge / 360 / Arc…）
2. 在该窗口登录并打开目标页
3. 侧边栏点 **重新扫描**，点选标签；或保持 `auto` 自动附着
4. 不需要按浏览器品牌分别配置路径

示例：

```bash
# Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-bat-profile"

# Edge
/Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge \
  --remote-debugging-port=9223 \
  --user-data-dir="$HOME/edge-bat-profile"
```

> 说明：Firefox 不走 CDP，当前不支持直接附着；请用方案 A 手动登录。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前端 + Agent |
| `npm run dev:web` | 仅 Vite 前端 |
| `npm run dev:server` | 仅 Agent 服务（热重载） |
| `npm run server` | 仅 Agent 服务 |
| `npm run build` | 类型检查 + 前端构建 |
| `npm run test:unit` | 单元测试 |
| `npm run lint` / `npm run format` | 代码检查与格式化 |

## 后续可增强

- 浏览器扩展一键附着日常窗口（无需 remote debugging）
- 多页用例编排与回归报告导出
- 视觉回归（截图 diff）
- 录制操作轨迹回放
- 报告模板自定义与多轮结果归档
