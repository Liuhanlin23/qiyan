import request from './request'

/**
 * 发送邮箱验证码。登录即注册、无独立注册接口，故只有「发码 + 验码登录」两个端点。
 * 邮箱服务端会 trim + 小写归一，前端提交前也先归一（防御）。
 */
export const sendEmailCode = (email: string): Promise<void> =>
  request.post('/auth/email/send-code', { email })

export interface EmailSignInRequest {
  email: string
  code: string
}

/** 登录成功响应（与后端 EmailSignInVO 对齐）。 */
export interface LoginResult {
  token: string
  tokenType: string
  expiresInSeconds: number
  userId: number
  email: string
}

/** 邮箱验证码登录；邮箱首次登录时后端自动创建账号。 */
export const emailSignIn = (req: EmailSignInRequest): Promise<LoginResult> =>
  request.post('/auth/email/sign-in', req)
