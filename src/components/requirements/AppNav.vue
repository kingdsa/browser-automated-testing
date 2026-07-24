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
  font-size: 14px;
  letter-spacing: 0.04em;
  color: var(--accent);
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
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
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  transition: 0.15s ease;
}

.link:hover {
  color: var(--text);
  background: var(--panel-soft);
}

.link.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  font-weight: 600;
}
</style>
