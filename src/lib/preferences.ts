// 用户偏好：存于 User.preferences（JSON 字符串），结构与解析
export interface UserPreferences {
  /** 看盘页历史收益默认区间（PerformancePreset 键） */
  defaultRange?: string
}

export function parsePreferences(raw: string | null): UserPreferences {
  try {
    const parsed = raw ? (JSON.parse(raw) as UserPreferences) : {}
    return typeof parsed === 'object' && parsed != null ? parsed : {}
  } catch {
    return {}
  }
}
