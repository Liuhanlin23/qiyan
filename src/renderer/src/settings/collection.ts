// settings 同步件（形态 A′，sync.md §3.5）：user_setting 由 lwwCollection 参数化生成，键级 KV、无墓碑。
// engine 从这里显式导入本件、在固定顺序 words→notes→settings→reviewLogs 中调用（依赖方向 engine → settings）。
import { userSetting } from '@/db/schema'
import { lwwCollection, type LwwCollection } from '@/sync/lww'
import type { SettingsRow } from '@/sync/protocol'

/** settings：LWW 集合，自然键 settingKey（wire），载荷 value（opaque JSON 编码标量文本），无墓碑。 */
export const settings: LwwCollection<SettingsRow> = lwwCollection<SettingsRow>({
  table: userSetting,
  key: [{ col: userSetting.settingKey, prop: 'settingKey', wire: true }],
  payload: [{ col: userSetting.value, prop: 'value' }],
  hasTombstone: false,
})
