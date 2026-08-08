// 客户端版本挡板的探测 / 重试（docs/feature/client-protocol.md）。
// 挡板本身由响应拦截器识别（426 → UpgradeRequiredError + 处置钩子），这里只提供
// 「主动问一次服务端」的入口：启动探测（不等用户操作就知道自己该升级了）与弹窗内的重试。
import { UpgradeRequiredError } from './request'
import { fetchCategories } from './wordbook'

/**
 * 探测当前客户端版本是否被服务端接受。
 * 借道现成的 GET /word-books/categories（无参、无副作用；未登录时是业务码 10005（HTTP 200），
 * 不影响探测语义）——直接复用 fetchCategories 而非另写一份路径字面量，端点改名时编译期即暴露，
 * 否则探测会静默 404 成「没被挡」，启动挡板悄悄失效。
 * **只认 426**：离线、未登录、服务端 500 一律视为「没被挡」返回 true——「离线不挡」，
 * 误判会把断网用户永久锁在升级弹窗里。
 */
export async function probeClientVersion(): Promise<boolean> {
  try {
    await fetchCategories()
    return true
  } catch (error) {
    return !(error instanceof UpgradeRequiredError)
  }
}

/**
 * 弹窗「重试」：探测通过才整页 reload（经 initSession 干净重建会话与引擎——引擎 stopped 置位后
 * 单例即废弃，原地恢复要引入额外状态机，不值得）。返回探测结果供弹窗显示「仍要求更新」。
 * reload 参数化仅为可测性。
 */
export async function retryUpgradeGate(
  reload: () => void = () => window.location.reload(),
): Promise<boolean> {
  const passed = await probeClientVersion()
  if (passed) reload()
  return passed
}
