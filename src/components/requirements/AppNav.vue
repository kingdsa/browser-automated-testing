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

@media (max-width: 760px) {
  .brand__text em {
    display: none;
  }

  .link {
    padding: 7px 10px;
    font-size: 12px;
  }
}
</style>
