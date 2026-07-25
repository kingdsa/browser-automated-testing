<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView v-slot="{ Component }">
    <keep-alive :include="['HomeView', 'RequirementsView']">
      <component :is="Component" />
    </keep-alive>
  </RouterView>
</template>
