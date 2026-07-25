# DESIGN.md

> Signal Lab — 把浏览器检测做成一间安静、精密、可读的 AI 信号实验室。

## 1. Visual Theme & Atmosphere

**Style**: Dark Precision Console（暗黑精密 × 极简克制）
**Keywords**: 信号、精密、深石墨、电青绿、可读、工具优先、低噪声、AI 控制台
**Tone**: 冷静专业、信息密度适中、可信赖 — NOT 花哨营销页、NOT 霓虹赛博过载、NOT 通用蓝 Chat 皮肤
**Feel**: 像一间压暗灯光的 QA 实验室，屏幕上只亮着通过信号与工具轨迹。

**Interaction Tier**: L2 流畅交互
**Dependencies**: CSS only + IntersectionObserver 可选；无 GSAP / Lenis

## 2. Color Palette & Roles

```css
:root {
  /* Backgrounds — dark first */
  --bg: #0B0F14;
  --bg-elevated: #0F141B;
  --panel: #121820;
  --panel-soft: #171E28;
  --surface-alt: #1B2330;
  --surface-hover: #222C3A;
  --input: #0E141C;

  /* Borders */
  --border: rgba(148, 163, 184, 0.14);
  --border-hover: rgba(148, 163, 184, 0.28);
  --border-strong: rgba(46, 230, 168, 0.45);

  /* Text */
  --text: #E8EEF7;
  --text-secondary: #A7B4C6;
  --muted: #7C8A9E;
  --text-on-accent: #04130E;

  /* Accent — signal mint */
  --accent: #2EE6A8;
  --accent-hover: #5EF0BE;
  --accent-soft: rgba(46, 230, 168, 0.12);
  --accent-secondary: #8B9CFF; /* AI thinking */
  --accent-secondary-soft: rgba(139, 156, 255, 0.14);
  --accent-rgb: 46, 230, 168;
  --bg-rgb: 11, 15, 20;

  /* Semantic */
  --success: #2EE6A8;
  --success-soft: rgba(46, 230, 168, 0.12);
  --success-border: rgba(46, 230, 168, 0.32);
  --success-text: #8AF5CC;
  --warning: #F0C14A;
  --warning-soft: rgba(240, 193, 74, 0.12);
  --warning-border: rgba(240, 193, 74, 0.32);
  --warning-text: #F6D98A;
  --error: #FF6B7A;
  --error-soft: rgba(255, 107, 122, 0.12);
  --error-border: rgba(255, 107, 122, 0.32);
  --error-text: #FFA0A9;
  --info: #8B9CFF;
  --info-soft: rgba(139, 156, 255, 0.12);
  --info-border: rgba(139, 156, 255, 0.32);
  --info-text: #B4BFFF;

  /* Code */
  --code-bg: #080C11;
  --code-text: #D7E7DF;
  --code-inline-bg: rgba(46, 230, 168, 0.1);

  /* Radius / Shadow / Motion */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-pill: 999px;
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-sm: 0 4px 14px rgba(0, 0, 0, 0.28);
  --shadow-md: 0 10px 28px rgba(0, 0, 0, 0.36);
  --shadow-focus: 0 0 0 3px rgba(46, 230, 168, 0.22);
  --shadow-float: 0 16px 40px rgba(0, 0, 0, 0.45);
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-fast: 150ms;
  --duration-normal: 220ms;
}
```

**Color Rules:**
- 所有颜色通过 CSS 变量引用，禁止组件内硬编码 hex
- 主强调色只用于 CTA、激活导航、成功/通过信号
- AI 思考/流式状态使用 `--accent-secondary`，与成功色分离
- 同一卡片内最多一个强调色主导

## 3. Typography Rules

**Font Stack:**
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700&family=Sora:wght@400;500;600;700&display=swap');
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| App H1 | Sora + Noto Sans SC | 18-20px | 700 | 1.25 | -0.02em |
| Section H2 | Sora + Noto Sans SC | 14-15px | 650/600 | 1.35 | -0.01em |
| Body | Sora + Noto Sans SC | 14px | 400 | 1.7 | 0.02em |
| Label | Sora + Noto Sans SC | 12px | 500 | 1.4 | 0.02em |
| Mono/Code | JetBrains Mono | 12px | 400-500 | 1.5 | 0 |

**Typography Rules:**
- 中文字族在前可回退：`'Sora', 'Noto Sans SC', ...`
- 正文 ≥ 14px，中文行高 ≥ 1.7
- 工具名/代码必须用 mono
- **NEVER use**: Inter-only stacks, Comic Sans, 纯系统默认无中文字体栈

**Text Decoration:**
- App H1：无渐变、无投影（工具密度场景）
- Section H2：无装饰
- Brand mark「BAT」：可用 accent 实色，不做渐变大字

## 4. Component Stylings

### Buttons
- Primary: accent fill, text-on-accent, hover lift -1px + stronger shadow
- Ghost: border + panel-soft, hover surface-hover
- Danger: error-soft fill + error border
- Disabled: opacity 0.5, cursor not-allowed
- Focus-visible: shadow-focus ring

### Cards / Panels
- panel bg, 1px border, radius-lg, shadow-xs
- Hover interactive cards: border-hover + translateY(-1px)

### Navigation
- Pill links, active = accent-soft + accent text + soft border
- Brand chip: accent-soft bg, uppercase tracking

### Inputs
- input bg, border, radius-md, focus accent border + focus shadow
- Labels 12px muted

### Badges
- Pill, soft semantic backgrounds
- Health ok = success; down = error; checking = info

### Composer / Chat bubbles
- User: accent-tinted panel
- AI: panel with subtle border
- Streaming: indigo pulse badge
- Tool rails: mono names, compact list

## 5. Layout Principles

**App Shell:**
- Topbar height: 56-64px, full width
- Config rail: 320-340px
- Requirements side: 360-380px
- Workspace: fluid 1fr
- Page padding: 16-24px

**Spacing Scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32

**Grid:**
```css
.shell-body {
  display: grid;
  grid-template-columns: 320px 1fr;
  min-height: 0;
  flex: 1;
}
```

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | no shadow | page bg, nested rows |
| Subtle | shadow-xs | cards, side panels |
| Elevated | shadow-sm/md | composer box, primary hover |
| Float | shadow-float | toasts, jump-latest |
| Focus | shadow-focus | inputs/buttons focus |

Ambient: soft radial mint + indigo glows on bg, low opacity grid optional.

## 7. Animation & Interaction

**Motion Philosophy**: 只动 opacity / transform；信号脉冲克制，不为动而动。
**Tier**: L2

### Entrance
```css
@keyframes fade-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.message, .card, .empty {
  animation: fade-up 0.45s var(--ease-out) both;
}
```

### Streaming pulse
```css
@keyframes pulse-soft {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.streaming { animation: pulse-soft 1.4s ease-in-out infinite; }
```

### Hover
- Buttons/cards: translateY(-1px) + border/shadow
- Chips: accent soft wash

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 8. Do's and Don'ts

### Do
- 用 CSS 变量表达全部颜色与圆角
- 保持工具信息 mono + 紧凑层级
- 状态色语义一致（成功/警告/错误/信息）
- 触摸目标 ≥ 40px（桌面可略密，移动 ≥ 44px）
- 流式输出保持可读滚动与状态提示
- 暗色默认，亮色作为 prefers-color-scheme: light 可选

### Don't
- ❌ 硬编码 hex/rgb 在组件 scoped 样式
- ❌ 用 emoji 充当功能图标
- ❌ 大面积 backdrop-filter > 14px
- ❌ 滚动劫持 / 多处 pin / WebGL 常驻
- ❌ 纯色块假装截图占位
- ❌ 同一区域混用多套强调色
- ❌ 正文字号 < 13px 长读
- ❌ 无 focus-visible 的可交互控件
- ❌ 把营销 Landing 的巨型 Hero 塞进工具台

## 9. Responsive Behavior

| Name | Width | Key Changes |
|------|-------|-------------|
| Desktop | > 1100px | 顶栏 + 侧栏 + 主区 |
| Tablet | 760-1100px | 侧栏变顶/可折叠，主区优先 |
| Mobile | < 760px | 单列，配置抽屉/堆叠，工具栏换行 |

**Touch Targets:** minimum 44×44px on mobile
**Collapsing Strategy:** 导航保留，标题可缩，次要 ghost 按钮进 overflow 或换行

```css
@media (max-width: 1100px) {
  .shell-body { grid-template-columns: 1fr; }
}
```
