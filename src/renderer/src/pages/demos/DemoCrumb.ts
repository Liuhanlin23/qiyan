import { createContext, useContext, useEffect } from 'react'

/**
 * Demo 详情页面包屑桥：demo 在内部下钻（如资源页 ?category=）时上报当前子级名，
 * DemoView 顶栏据此显示「demo 标题 / 子级」。放在独立叶子模块里，只依赖 react，避免与 registry 形成循环引用。
 */
export const DemoCrumbContext = createContext<(crumb: string | null) => void>(() => {})

/** 上报一层面包屑名；crumb 为 null 或组件卸载时自动清除。demo 内无条件调用即可。 */
export function useDemoCrumb(crumb: string | null): void {
  const setCrumb = useContext(DemoCrumbContext)
  useEffect(() => {
    setCrumb(crumb)
    return () => setCrumb(null)
  }, [setCrumb, crumb])
}
