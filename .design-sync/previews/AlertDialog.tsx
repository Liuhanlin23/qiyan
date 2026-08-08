import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction, Button,
} from 'desktop'

/** 破坏性确认。Action 用 danger 变体，Cancel 用 secondary。 */
export function Basic() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="danger">移除词书</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除「四级核心词汇」？</AlertDialogTitle>
          <AlertDialogDescription>学习进度会保留，可随时重新加入。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="danger">移除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
