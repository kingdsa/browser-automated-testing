export type SkillCategory = 'function-point' | 'test-case' | 'control-chrome'

export interface CategorySkill {
  name: string
  description: string
  content: string
  fileName: string
  isDefault: boolean
  selected: boolean
}

export async function listCategorySkills(category: SkillCategory): Promise<CategorySkill[]> {
  const res = await fetch(`/api/skills/${encodeURIComponent(category)}`)
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean
    skills?: CategorySkill[]
    error?: string
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `获取 skills 失败: HTTP ${res.status}`)
  }
  return data.skills || []
}

export async function selectCategorySkills(
  category: SkillCategory,
  fileNames: string[],
): Promise<CategorySkill[]> {
  const res = await fetch(`/api/skills/${encodeURIComponent(category)}/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileNames }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean
    skills?: CategorySkill[]
    error?: string
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `更新 skills 选择失败: HTTP ${res.status}`)
  }
  return data.skills || []
}

export async function uploadCategorySkill(
  category: SkillCategory,
  file: File,
): Promise<CategorySkill[]> {
  const form = new FormData()
  form.append('file', file)
  form.append('fileName', file.name)
  const res = await fetch(`/api/skills/${encodeURIComponent(category)}/upload`, {
    method: 'POST',
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean
    skills?: CategorySkill[]
    error?: string
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `上传 skill 失败: HTTP ${res.status}`)
  }
  return data.skills || []
}

export async function deleteCategorySkill(
  category: SkillCategory,
  fileName: string,
): Promise<CategorySkill[]> {
  const res = await fetch(
    `/api/skills/${encodeURIComponent(category)}/${encodeURIComponent(fileName)}`,
    { method: 'DELETE' },
  )
  const data = (await res.json().catch(() => ({}))) as {
    ok: boolean
    skills?: CategorySkill[]
    error?: string
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `删除 skill 失败: HTTP ${res.status}`)
  }
  return data.skills || []
}
