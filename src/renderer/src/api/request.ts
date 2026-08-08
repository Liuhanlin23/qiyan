// 全 app 唯一一套 HTTP（axios）。信封解包 + 滑动续期 + 错误码只在此写一次，按请求 flag 分两种模式：
// - 交互模式（页面发起，缺省）：登录失效 toast + 触发登出跳登录；其余错误 toast。
// - 静默模式（引擎 / 后台取数，silent:true）：一律抛类型化错误（AuthError/NetworkError/ServerError），
//   由调用方（引擎退避、缓存降级）自行处置，不弹 toast、不跳转。
// 详见 docs/desktop/api-convention.md。
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { getRecord, getToken, setToken } from '@/session/tokenStore'
import { authBridge } from '@/platform'
import { toast } from '@/lib/toast'

// 拦截器成功分支直接 return res.data（解包后的 T）；用模块增强把返回类型覆写为 Promise<T>，
// 并给请求配置加 silent 开关（交互 / 静默两种模式）。
declare module 'axios' {
  interface AxiosRequestConfig {
    /** 静默模式：错误抛类型化异常而非 toast/跳转（引擎、后台取数用）。 */
    silent?: boolean
  }
  interface AxiosInstance {
    get<T = unknown>(url: string, config?: import('axios').AxiosRequestConfig): Promise<T>
    post<T = unknown>(
      url: string,
      data?: unknown,
      config?: import('axios').AxiosRequestConfig,
    ): Promise<T>
    put<T = unknown>(
      url: string,
      data?: unknown,
      config?: import('axios').AxiosRequestConfig,
    ): Promise<T>
    delete<T = unknown>(url: string, config?: import('axios').AxiosRequestConfig): Promise<T>
  }
}

/** 后端统一响应信封（见 api-convention.md 第一节）。 */
interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

/** 未登录 / 令牌失效：引擎收到即停手，等重新登录。 */
export class AuthError extends Error {}
/** 网络 / HTTP 层错误：引擎按指数退避重试。 */
export class NetworkError extends Error {}
/** 业务错误码（非登录失效）：引擎按指数退避重试。 */
export class ServerError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}
/** 服务端版本挡板（HTTP 426）：一切服务端交互到此为止，等用户升级客户端。 */
export class UpgradeRequiredError extends Error {}

/** 登录失效错误码（与后端 AuthErrorCode 对齐）：TOKEN_MISSING(10005) / TOKEN_INVALID(10006)。 */
const AUTH_FAILURE_CODES = [10005, 10006]

// 交互模式登录失效的处置钩子由 session 注册（停引擎 + 关库 + 清凭据 + 跳登录），避免 request→session 循环。
let onAuthFailure: (() => void) | null = null
export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler
}

// 版本挡板的处置钩子同样由组合根注册（停引擎 + 弹阻断弹窗），避免 request→sync/UI 循环。
let onUpgradeRequired: (() => void) | null = null
export function setUpgradeRequiredHandler(handler: (() => void) | null): void {
  onUpgradeRequired = handler
}

// baseURL：dev 指向本地 server(:8081/api)；prod 经 VITE_API_BASE_URL 换线上域名（同样以 /api 结尾）。
const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api',
  timeout: 15000,
})

/**
 * 请求头注入：版本挡板头**无条件**带（服务端对全部端点含 /auth/** 做相等比对，缺头即 426，
 * 见 docs/feature/client-protocol.md）；Authorization 仅在有 token 时带。
 */
export function applyRequestHeaders(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  config.headers.set('X-Client-Version', __APP_VERSION__)
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
}

request.interceptors.request.use(applyRequestHeaders)

/**
 * HTTP 层错误（非业务信封）分流。
 * 426 = 服务端版本挡板，静默与交互**一视同仁**：触发升级处置钩子 + 抛 UpgradeRequiredError，
 * 不 toast（阻断弹窗已覆盖提示职责）。判断必须在 silent 分支之前——否则引擎的静默请求撞挡板
 * 会被吞成 NetworkError，退化成默默退避重试（client-protocol.md）。
 * 其余错误（含离线）维持原双模式处置：离线不挡。
 */
export function handleHttpError(error: unknown): Promise<never> {
  const failure = error as { response?: { status?: number }; config?: { silent?: boolean } } | null
  if (failure?.response?.status === 426) {
    onUpgradeRequired?.()
    return Promise.reject(new UpgradeRequiredError('客户端版本不匹配，请升级'))
  }
  if (failure?.config?.silent === true) {
    return Promise.reject(new NetworkError(error instanceof Error ? error.message : String(error)))
  }
  toast.error('网络服务出错，请稍后重试')
  return Promise.reject(error)
}

// 响应拦截器：滑动续期 + 统一解包(code===0) + 双模式错误处置。
// 成功分支 return 解包后的 data（非 AxiosResponse）——与实例方法的 Promise<T> 覆写对齐，故返回 any。
request.interceptors.response.use(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (response: AxiosResponse<ApiResponse<unknown>>): any => {
    // 滑动续期：服务端临近过期时下发新令牌，静默换发（换内存 token + 落盘，收敛在此一处）。
    // 身份护栏：仅当当前登录态仍是**发起本请求**的那枚令牌时才换发——否则在途请求（登出/换账号后才返回）
    // 会把旧令牌写回，污染新会话或让磁盘残留已登出凭据（对抗式复核确认的跨账号竞态）。
    const refreshed = response.headers['x-refreshed-token']
    const sentAuth = String(response.config.headers?.Authorization ?? '')
    const current = getRecord()
    if (typeof refreshed === 'string' && refreshed && current && sentAuth === `Bearer ${current.token}`) {
      setToken(refreshed)
      void authBridge.set(getRecord()!)
    }
    const res = response.data
    if (res.code === 0) return res.data

    const silent = response.config.silent === true
    if (AUTH_FAILURE_CODES.includes(res.code)) {
      if (!silent) {
        toast.error(res.message || '登录已过期，请重新登录')
        onAuthFailure?.()
      }
      return Promise.reject(new AuthError(res.message))
    }
    const message = res.message || '请求失败，请稍后重试'
    if (!silent) toast.error(message)
    return Promise.reject(new ServerError(res.code, message))
  },
  handleHttpError,
)

export default request

/** 静默 GET / POST（引擎与后台取数用；错误抛类型化异常）。extraHeaders 预留（同步端点已无自定义头）。 */
export const apiGet = <T>(url: string, extraHeaders?: Record<string, string>): Promise<T> =>
  request.get<T>(url, { silent: true, headers: extraHeaders })
export const apiPost = <T>(
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> => request.post<T>(url, body, { silent: true, headers: extraHeaders })
