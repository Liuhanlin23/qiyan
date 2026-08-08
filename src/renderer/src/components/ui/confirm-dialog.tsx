import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'
import { buttonVariants } from './button'

/**
 * 破坏性操作确认弹窗：AlertDialog 之上的收口封装 —— 标题 / 描述 / 确认文案 / 确认按钮 variant 可配，
 * 固定「取消 + 确认」双按钮。确认后由 Radix Action 自动关闭，onConfirm 只承接动作本身。
 * 非破坏性确认用 primary，破坏性不可逆（移除 / 清空）用 danger。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmVariant = 'primary',
  cancelText = '取消',
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description: React.ReactNode
  confirmText: string
  confirmVariant?: 'primary' | 'brand' | 'danger'
  cancelText?: string
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: confirmVariant })} onClick={onConfirm}>
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
