// 跨进程共享的句子翻译桥契约（main 转发 / preload 传参 / renderer 消费的单一事实源）。
// 原文固定英文、译文固定中文（本 app 的学习场景写死），故通道只收「文本 + 服务商」，不带语言参数。
// 渲染层直连 Google/Azure 翻译接口会被 CORS / Origin 校验拦截，须经 main 的 fetch 转发（对齐 suggest）。

/** 句子翻译服务商：都是免费公开接口、无需密钥。 */
export type TranslateProvider = 'google' | 'azure'

/** 一次翻译请求：英文原文 + 指定服务商。 */
export interface TranslateRequest {
  text: string
  provider: TranslateProvider
}
