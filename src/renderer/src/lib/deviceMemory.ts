/**
 * 设备级工具记忆 —— 界面被动记住的「上次行为」（划词高亮线型 / 句子翻译引擎 / App 主题…）。
 *
 * 落 localStorage，**不进 `user_setting`、不进 sqlite、不同步**，设置界面也没有入口：
 * 判据是「换设备时用户不会期待它跟过来」——在台式机上惯用波浪线，不该把笔记本上的习惯也改掉。
 * 与之相对的「用户设置」（字号 / 字体族等主动配置项）走 `@/settings` 门面落库并同步。
 *
 * 本 helper 只封装「读 + 校验回退 + 写」三件事，**刻意不做**集中注册表 / 变更订阅 / schema 校验：
 * 各功能的记忆定义就放在各自模块旁边，读一处即知全貌。key 约定 `qiyan.<域>.<名>`。
 */

/** 一项设备级记忆的读写口。read 永不抛：读不出 / 认不得的值一律退回出厂默认。 */
export interface DeviceMemory<T> {
  read: () => T
  store: (value: T) => void
}

/**
 * 定义一项设备级记忆。
 *
 * @param key       localStorage 键，约定 `qiyan.<域>.<名>`（改名 = 丢用户的上次选择，慎改）
 * @param fallback  出厂默认：无记录 / 读写异常 / 校验不过时的回退值
 * @param sanitize  把 JSON.parse 后的未知值收成合法 T（认不得的部分自行退回默认）
 */
export function defineDeviceMemory<T>(
  key: string,
  fallback: T,
  sanitize: (raw: unknown) => T,
): DeviceMemory<T> {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return fallback
        return sanitize(JSON.parse(raw))
      } catch {
        // 存储不可用 / JSON 坏了 / sanitize 抛了：一条脏记录不该卡住功能本身。
        return fallback
      }
    },
    store(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        // 写不进去（无痕模式 / 配额满）只是记不住上次选择，当次操作照常，不打断用户。
        console.warn(`[deviceMemory] 写入 ${key} 失败：`, e)
      }
    },
  }
}
