<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <nav class="app-nav" aria-label="主导航">
    <RouterLink class="brand" to="/" title="Browser Automated Testing">
      <span class="brand__mark" aria-hidden="true"></span>
      <span class="brand__text">
        <strong>BAT</strong>
        <em>Signal Lab</em>
      </span>
    </RouterLink>
    <div class="links">
      <RouterLink
        class="link"
        :class="{ active: route.path === '/' || route.name === 'requirements' }"
        to="/"
      >
        需求分析
      </RouterLink>
      <RouterLink
        class="link"
        :class="{ active: route.path.startsWith('/browser-test') }"
        to="/browser-test"
      >
        浏览器测试
      </RouterLink>
    </div>
    <a
      class="github"
      href="https://github.com/kingdsa/browser-automated-testing"
      target="_blank"
      rel="noopener noreferrer"
      title="在 GitHub 查看源码"
      aria-label="在 GitHub 查看源码"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 2C6.477 2 2 6.486 2 12.021c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.013-1.7-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.467-1.11-1.467-.908-.621.069-.609.069-.609 1.004.071 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.833.091-.647.35-1.088.636-1.339-2.221-.253-4.555-1.113-4.555-4.952 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.747-1.026 2.747-1.026.546 1.378.203 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.338 4.696-4.566 4.944.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.748 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.021C22 6.486 17.523 2 12 2z"
        />
      </svg>
    </a>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--text);
  min-width: 0;
}

.brand__mark {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  flex-shrink: 0;
  background:
    radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--accent) 85%, white), var(--accent) 55%, color-mix(in srgb, var(--accent) 55%, #0b0f14)),
    linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent-secondary) 55%, var(--accent)));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
    0 8px 18px rgba(var(--accent-rgb), 0.22);
  position: relative;
}

.brand__mark::after {
  content: '';
  position: absolute;
  inset: 8px 7px 8px 12px;
  border-radius: 2px;
  border-right: 2px solid rgba(4, 19, 14, 0.75);
  border-bottom: 2px solid rgba(4, 19, 14, 0.75);
  transform: rotate(-45deg);
  opacity: 0.9;
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  min-width: 0;
}

.brand__text strong {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.brand__text em {
  font-style: normal;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.02em;
}

.brand:hover .brand__mark {
  transform: translateY(-1px);
}

.brand__mark {
  transition: transform var(--duration-fast) var(--ease-out);
}

.links {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-soft) 80%, transparent);
}

.link {
  text-decoration: none;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  padding: 7px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.link:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.link.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent);
}

.github {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-left: 2px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
  background: color-mix(in srgb, var(--panel-soft) 80%, transparent);
  text-decoration: none;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
  flex-shrink: 0;
}

.github:hover {
  color: var(--text);
  background: var(--surface-hover);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.12);
}

.github:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .brand__text em {
    display: none;
  }

  .link {
    padding: 7px 10px;
    font-size: 12px;
  }

  .github {
    width: 32px;
    height: 32px;
  }
}
</style>
