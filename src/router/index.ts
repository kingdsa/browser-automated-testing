import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'requirements',
      component: () => import('../views/RequirementsView.vue'),
    },
    {
      path: '/browser-test',
      name: 'browser-test',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/requirements',
      redirect: '/',
    },
  ],
})

export default router
