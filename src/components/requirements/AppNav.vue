<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <nav class="app-nav" aria-label="主导航">
    <RouterLink class="brand" to="/">BAT</RouterLink>
    <div class="links">
      <RouterLink
        class="link"
        :class="{ active: route.path === '/' }"
        to="/"
      >
        浏览器测试
      </RouterLink>
      <RouterLink
        class="link"
        :class="{ active: route.path.startsWith('/requirements') }"
        to="/requirements"
      >
        需求分析
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand {
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
  text-decoration: none;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.brand:hover {
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--accent));
  transform: translateY(-1px);
}

.links {
  display: flex;
  align-items: center;
  gap: 6px;
}

.link {
  text-decoration: none;
  color: var(--muted);
  font-size: 13px;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.link:hover {
  color: var(--text);
  background: var(--panel-soft);
  border-color: var(--border);
}

.link.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  background: var(--accent-soft);
  font-weight: 600;
}
</style>
