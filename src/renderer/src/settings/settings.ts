// 用户设置（user_setting 变更流 LWW 集合，键级 KV，sync.md §2 / db/01）。每键一行 setting_key → value，无墓碑。
// getSettings 读全表已知键装配 Settings（缺键补默认、坏值回退默认 + 大声提示、未知键忽略）；
// updateSettings 逐键 JSON.stringify upsert（各自 dirty + editTime），只写 patch 里出现的键。editTime 由门面传入。
import type { Db } from '@/db/client'
import { userSetting } from '@/db/schema'
import { toast } from '@/lib/toast'
import { DEFAULT_SETTINGS, SETTINGS_REGISTRY, type SettingSpec } from './defaults'
import type { Settings } from './types'

// 全默认视图单一常量源见 ./defaults；本处再导出保持既有引用面。
export { DEFAULT_SETTINGS }

/** 每键每会话只提示一次坏值，读路径高频调用不刷屏。 */
const warnedKeys = new Set<string>()

/** 读设置：SELECT 全表 → 按注册表装配。缺键补默认；坏值（parse 失败/校验不过）回退默认 + toast + console.error。 */
export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db
    .select({ settingKey: userSetting.settingKey, value: userSetting.value })
    .from(userSetting)
    .all()
  const byKey = new Map(rows.map((r) => [r.settingKey, r.value]))
  const out: Record<string, unknown> = {}
  for (const [prop, s] of Object.entries(SETTINGS_REGISTRY)) {
    out[prop] = readOne(s, byKey.get(s.key))
  }
  return out as unknown as Settings
}

/** 单键读取：无行 → 默认（默认不落库）；parse 失败或校验不过 → 回退默认 + 大声提示。 */
function readOne(s: SettingSpec, raw: string | undefined): unknown {
  if (raw === undefined) return s.default
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback(s, `无法解析 JSON：${raw}`)
  }
  return s.validate(parsed) ? parsed : fallback(s, `值非法：${raw}`)
}

/** 坏值回退：fail loudly（与 skippedInvalid>0 同级），每键每会话只弹一次 toast。 */
function fallback(s: SettingSpec, reason: string): unknown {
  console.error(`设置项 ${s.key} ${reason}，已回退默认值`)
  if (!warnedKeys.has(s.key)) {
    warnedKeys.add(s.key)
    toast.error(`设置「${s.key}」数据异常已回退默认，请反馈此问题`)
  }
  return s.default
}

/** 改设置：逐键 JSON.stringify upsert（dirty=1 + editTime），只写 patch 里出现的键；键级独立，改 A 不产生 B 的行。 */
export async function updateSettings(
  db: Db,
  patch: Partial<Settings>,
  editTime: number,
): Promise<void> {
  for (const prop of Object.keys(patch) as (keyof Settings)[]) {
    const value = patch[prop]
    if (value === undefined) continue
    const settingKey = SETTINGS_REGISTRY[prop].key
    const encoded = JSON.stringify(value)
    await db
      .insert(userSetting)
      .values({ settingKey, value: encoded, editTime, dirty: 1 })
      .onConflictDoUpdate({
        target: userSetting.settingKey,
        set: { value: encoded, editTime, dirty: 1 },
      })
      .run()
  }
}
