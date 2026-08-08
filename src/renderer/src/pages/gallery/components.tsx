// 组件展示区 —— 21 个 CDS 组件,每个一节:状态矩阵 + props/用法速查。
// 覆盖层/命令式组件(Dialog/Popover/Dropdown/Tooltip/Toast)渲染真实可交互触发器,当场打开即所见即所得。
import { useRef, useState } from 'react'
import {
  Info,
  Check,
  Star,
  Settings,
  Trash2,
  Pencil,
  Copy,
  MessageSquare,
  Layers,
  Briefcase,
  Palette,
} from 'lucide-react'
import {
  Button,
  Badge,
  Avatar,
  AvatarFallback,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Alert,
  AlertIcon,
  AlertContent,
  AlertDescription,
  AlertAction,
  Input,
  Label,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectGroup,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuShortcut,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  ScrollArea,
  Separator,
  Skeleton,
  Toast,
  ToastProvider,
  ToastViewport,
  type ToastVariant,
  Sidebar,
  SidebarHeader,
  SidebarBody,
  SidebarAction,
  SidebarGroup,
  SidebarItem,
  SidebarFooter,
} from '@/components/ui'
import { Block, Cell, PropsTable, Row, Section, type GallerySection } from './primitives'

// ── 需要本地状态的演示子件 ──────────────────────────────────────────────

function SwitchDemo(): React.JSX.Element {
  const [on, setOn] = useState(true)
  return (
    <Row>
      <Cell label="checked">
        <Switch checked={on} onCheckedChange={setOn} />
      </Cell>
      <Cell label="off">
        <Switch checked={false} onCheckedChange={() => {}} />
      </Cell>
      <Cell label="disabled">
        <Switch disabled />
      </Cell>
      <Cell label="disabled checked">
        <Switch disabled checked />
      </Cell>
    </Row>
  )
}

function ToggleDemo(): React.JSX.Element {
  const [v, setV] = useState('en-first')
  return (
    <ToggleGroup value={v} onValueChange={(val) => val && setV(val)}>
      <ToggleGroupItem value="en-first">英文优先</ToggleGroupItem>
      <ToggleGroupItem value="zh-first">中文优先</ToggleGroupItem>
      <ToggleGroupItem value="both">双语</ToggleGroupItem>
    </ToggleGroup>
  )
}

function ToastDemo(): React.JSX.Element {
  const [items, setItems] = useState<{ id: number; variant: ToastVariant; title: string; msg: string }[]>([])
  const idRef = useRef(0)
  const push = (variant: ToastVariant, title: string, msg: string): void =>
    setItems((list) => [...list, { id: ++idRef.current, variant, title, msg }])
  return (
    <ToastProvider swipeDirection="right">
      <Row>
        <Button variant="secondary" onClick={() => push('info', '已保存', '你的修改已同步到云端。')}>
          info
        </Button>
        <Button variant="secondary" onClick={() => push('warning', '注意', '离线模式下部分功能受限。')}>
          warning
        </Button>
        <Button variant="danger" onClick={() => push('danger', '出错了', '无法连接服务器,请稍后重试。')}>
          danger
        </Button>
      </Row>
      {items.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          title={t.title}
          onOpenChange={(open) => !open && setItems((l) => l.filter((x) => x.id !== t.id))}
        >
          {t.msg}
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

// ── 各组件分区 ──────────────────────────────────────────────────────────

export const COMPONENT_SECTIONS: GallerySection[] = [
  {
    id: 'c-button',
    label: 'Button',
    render: () => (
      <Section id="c-button" title="Button" description="主操作按钮 · cva 驱动(variant × size)。">
        <Block label="variant">
          <Row>
            <Button variant="primary">Primary</Button>
            <Button variant="brand">Brand</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Row>
        </Block>
        <Block label="size">
          <Row>
            <Button size="lg">Large</Button>
            <Button size="default">Default</Button>
            <Button size="sm">Small</Button>
            <Button size="icon" aria-label="设置">
              <Settings className="size-4" />
            </Button>
            <Button size="iconSm" aria-label="设置">
              <Settings className="size-4" />
            </Button>
            <Button size="iconXs" aria-label="设置">
              <Settings className="size-3.5" />
            </Button>
          </Row>
        </Block>
        <Block label="状态">
          <Row>
            <Cell label="loading">
              <Button loading>提交中</Button>
            </Cell>
            <Cell label="disabled">
              <Button disabled>不可用</Button>
            </Cell>
            <Cell label="round">
              <Button round variant="brand">
                全圆角
              </Button>
            </Cell>
            <Cell label="icon + 文本">
              <Button variant="secondary">
                <Star className="size-4" /> 收藏
              </Button>
            </Cell>
          </Row>
        </Block>
        <PropsTable
          rows={[
            { name: 'variant', type: 'primary|brand|secondary|ghost|danger', def: 'primary' },
            { name: 'size', type: 'default|sm|lg|icon|iconXs|iconSm|iconLg', def: 'default' },
            { name: 'loading', type: 'boolean', def: 'false', note: '显示加载态并禁用' },
            { name: 'round', type: 'boolean', def: 'false', note: '强制全圆角' },
            { name: 'asChild', type: 'boolean', def: 'false', note: '渲染为子元素(Slot)' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-badge',
    label: 'Badge',
    render: () => (
      <Section id="c-badge" title="Badge" description="状态/分类小药丸 · chip 底 + 语义文字成对。">
        <Block label="variant">
          <Row>
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="danger">Danger</Badge>
            <Badge variant="outline">Outline</Badge>
          </Row>
        </Block>
        <PropsTable
          rows={[
            { name: 'variant', type: 'neutral|accent|success|warning|danger|outline', def: 'neutral' },
            { name: 'asChild', type: 'boolean', def: 'false' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-avatar',
    label: 'Avatar',
    render: () => (
      <Section id="c-avatar" title="Avatar" description="圆形头像 + 首字母回退。">
        <Block label="size">
          <Row>
            <Cell label="sm">
              <Avatar size="sm">
                <AvatarFallback>启</AvatarFallback>
              </Avatar>
            </Cell>
            <Cell label="default">
              <Avatar>
                <AvatarFallback>言</AvatarFallback>
              </Avatar>
            </Cell>
            <Cell label="lg">
              <Avatar size="lg">
                <AvatarFallback>LV</AvatarFallback>
              </Avatar>
            </Cell>
          </Row>
        </Block>
        <PropsTable
          rows={[
            { name: 'size', type: 'sm|default|lg', def: 'default' },
            { name: '子组件', type: 'AvatarImage / AvatarFallback', note: '图片失败时回退首字母' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-card',
    label: 'Card',
    render: () => (
      <Section id="c-card" title="Card" description="发丝描边 + 无投影的卡片容器(surface-1 + card-ring)。">
        <Block label="复合结构">
          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>每日单词</CardTitle>
              <CardDescription>今天还有 12 个待复习。</CardDescription>
            </CardHeader>
            <CardContent className="text-body text-text-300">
              卡片由 Header / Title / Description / Content / Footer 组合而成。
            </CardContent>
            <CardFooter>
              <Button>开始复习</Button>
            </CardFooter>
          </Card>
        </Block>
        <PropsTable
          rows={[
            { name: '子组件', type: 'CardHeader / CardTitle / CardDescription', note: '复合组件' },
            { name: '', type: 'CardContent / CardFooter', note: '按需组合' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-alert',
    label: 'Alert',
    render: () => (
      <Section id="c-alert" title="Alert" description="内联提示条(中性,无 tone 变体)。">
        <Alert className="max-w-md">
          <AlertIcon>
            <Info className="size-4 text-text-accent" />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>系统将在今晚 02:00 维护,届时部分功能不可用。</AlertDescription>
          </AlertContent>
          <AlertAction>
            <Button size="sm" variant="secondary">
              知道了
            </Button>
          </AlertAction>
        </Alert>
        <PropsTable
          rows={[
            { name: '子组件', type: 'AlertIcon / AlertContent', note: '复合组件' },
            { name: '', type: 'AlertDescription / AlertAction', note: '图标 + 文案 + 右侧操作' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-input',
    label: 'Input',
    render: () => (
      <Section id="c-input" title="Input · Label" description="文本输入 + 表单标签。聚焦切浮层底 + 焦点环。">
        <Block label="状态">
          <div className="flex max-w-sm flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="g-email">邮箱</Label>
              <Input id="g-email" type="email" placeholder="you@example.com" />
            </div>
            <Input placeholder="禁用态" disabled />
            <Input placeholder="校验失败态" invalid defaultValue="不合法的值" />
          </div>
        </Block>
        <PropsTable
          rows={[
            { name: 'invalid', type: 'boolean', def: 'false', note: '校验失败态(aria-invalid)' },
            { name: '...rest', type: 'HTMLInputProps', note: '透传原生 input 属性' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-switch',
    label: 'Switch',
    render: () => (
      <Section id="c-switch" title="Switch" description="开关 · 选中 fill-accent,滑块回弹缓动。">
        <SwitchDemo />
        <PropsTable
          rows={[
            { name: 'checked', type: 'boolean', note: '受控选中' },
            { name: 'onCheckedChange', type: '(b: boolean) => void' },
            { name: 'disabled', type: 'boolean', def: 'false' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-toggle',
    label: 'ToggleGroup',
    render: () => (
      <Section id="c-toggle" title="ToggleGroup" description="分段控件 · 滑动 thumb 单选。">
        <ToggleDemo />
        <PropsTable
          rows={[
            { name: 'value / defaultValue', type: 'string', note: '当前选中项' },
            { name: 'onValueChange', type: '(v: string) => void' },
            { name: '子组件', type: 'ToggleGroupItem', note: 'value 唯一标识' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-select',
    label: 'Select',
    render: () => (
      <Section id="c-select" title="Select" description="下拉选择 · Radix 浮层。">
        <Select defaultValue="apple">
          <SelectTrigger className="w-48">
            <SelectValue placeholder="选择水果" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>水果</SelectLabel>
              <SelectItem value="apple">苹果</SelectItem>
              <SelectItem value="banana">香蕉</SelectItem>
              <SelectItem value="orange">橙子</SelectItem>
              <SelectItem value="grape">葡萄</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <PropsTable
          rows={[
            { name: 'value / defaultValue', type: 'string' },
            { name: 'onValueChange', type: '(v: string) => void' },
            { name: '子组件', type: 'SelectTrigger / SelectContent / SelectItem', note: 'Radix 组合' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-dropdown',
    label: 'DropdownMenu',
    render: () => (
      <Section id="c-dropdown" title="DropdownMenu" description="下拉菜单 · 含分组/分隔/快捷键/勾选项。">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">打开菜单</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-44">
            <DropdownMenuLabel>操作</DropdownMenuLabel>
            <DropdownMenuItem>
              <Pencil className="size-4" /> 编辑
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Copy className="size-4" /> 复制
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>显示预览</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Trash2 className="size-4" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PropsTable
          rows={[
            { name: '子组件', type: 'DropdownMenuTrigger / Content / Item', note: 'Radix 组合' },
            { name: '', type: 'CheckboxItem / RadioItem / Label / Separator / Shortcut' },
            { name: 'inset', type: 'boolean', note: 'Item 左缩进对齐' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-popover',
    label: 'Popover',
    render: () => (
      <Section id="c-popover" title="Popover" description="浮层面板 · surface-3 + shadow-panel。">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">打开 Popover</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="flex flex-col gap-1.5">
              <p className="text-caption font-semibold text-text-100">面板标题</p>
              <p className="text-footnote text-text-400">浮层用于承载轻量的临时内容,如筛选、设置片段。</p>
            </div>
          </PopoverContent>
        </Popover>
        <PropsTable
          rows={[
            { name: 'align', type: 'start|center|end', def: 'center', note: 'PopoverContent' },
            { name: 'sideOffset', type: 'number', note: '与触发器间距' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-tooltip',
    label: 'Tooltip',
    render: () => (
      <Section id="c-tooltip" title="Tooltip" description="提示气泡 · 深底浅字。">
        <TooltipProvider>
          <Row>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary">悬停我</Button>
              </TooltipTrigger>
              <TooltipContent>这是一条提示</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="设置">
                  <Settings className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>设置</TooltipContent>
            </Tooltip>
          </Row>
        </TooltipProvider>
        <PropsTable
          rows={[
            { name: 'sideOffset', type: 'number', note: 'TooltipContent 与触发器间距' },
            { name: '包裹', type: '<TooltipProvider>', note: '需在 Provider 内使用' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-dialog',
    label: 'Dialog',
    render: () => (
      <Section id="c-dialog" title="Dialog" description="居中弹窗 · surface-2 + 背景模糊。">
        <Dialog>
          <DialogTrigger asChild>
            <Button>打开对话框</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>修改昵称</DialogTitle>
              <DialogDescription>这个名字会显示在你的个人主页上。</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="g-name">昵称</Label>
              <Input id="g-name" defaultValue="启言同学" />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">取消</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>保存</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <PropsTable
          rows={[
            { name: 'showClose', type: 'boolean', def: 'true', note: 'DialogContent 右上关闭键' },
            { name: '子组件', type: 'DialogHeader / Title / Description / Footer' },
          ]}
        />
      </Section>
    )
  },
  {
    id: 'c-alertdialog',
    label: 'AlertDialog',
    render: () => (
      <Section id="c-alertdialog" title="AlertDialog" description="确认弹窗 · Action/Cancel 复用按钮样式。">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="danger">删除账户</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除?</AlertDialogTitle>
              <AlertDialogDescription>此操作不可撤销,你的所有数据将被永久清除。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction>确认删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <PropsTable
          rows={[
            { name: 'AlertDialogAction', type: 'button', note: '主操作,默认 primary' },
            { name: 'AlertDialogCancel', type: 'button', note: '取消,默认 secondary' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-collapsible',
    label: 'Collapsible',
    render: () => (
      <Section id="c-collapsible" title="Collapsible" description="折叠展开容器。">
        <Collapsible className="max-w-sm">
          <CollapsibleTrigger asChild>
            <Button variant="secondary">展开 / 收起详情</Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-card border border-border-300 bg-surface-1 p-3 text-body text-text-300">
            这里是可折叠的内容区,适合放次要信息、设置项的展开说明等。
          </CollapsibleContent>
        </Collapsible>
        <PropsTable
          rows={[
            { name: 'open / defaultOpen', type: 'boolean' },
            { name: '子组件', type: 'CollapsibleTrigger / CollapsibleContent' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-scrollarea',
    label: 'ScrollArea',
    render: () => (
      <Section id="c-scrollarea" title="ScrollArea" description="细滚动条容器。">
        <ScrollArea className="h-40 w-64 rounded-card border border-border-300 p-3">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} className="text-body text-text-300">
                第 {i + 1} 行 · 滚动以查看更多内容
              </div>
            ))}
          </div>
        </ScrollArea>
        <PropsTable rows={[{ name: 'className', type: 'string', note: '约束高度即出现滚动条' }]} />
      </Section>
    ),
  },
  {
    id: 'c-separator',
    label: 'Separator',
    render: () => (
      <Section id="c-separator" title="Separator" description="横/纵分割线。">
        <div className="max-w-sm">
          <div className="text-body text-text-300">上方内容</div>
          <Separator className="my-3" />
          <div className="text-body text-text-300">下方内容</div>
          <div className="mt-4 flex h-6 items-center gap-3 text-footnote text-text-400">
            <span>主页</span>
            <Separator orientation="vertical" />
            <span>设置</span>
            <Separator orientation="vertical" />
            <span>退出</span>
          </div>
        </div>
        <PropsTable
          rows={[
            { name: 'orientation', type: 'horizontal|vertical', def: 'horizontal' },
            { name: 'decorative', type: 'boolean', def: 'true' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-skeleton',
    label: 'Skeleton',
    render: () => (
      <Section id="c-skeleton" title="Skeleton" description="加载占位骨架(pulse)。">
        <div className="flex max-w-sm items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <PropsTable rows={[{ name: 'className', type: 'string', note: '用尺寸类塑形' }]} />
      </Section>
    ),
  },
  {
    id: 'c-toast',
    label: 'Toast',
    render: () => (
      <Section id="c-toast" title="Toast" description="右上角通知 · 点击按钮弹出(三态)。">
        <ToastDemo />
        <PropsTable
          rows={[
            { name: 'variant', type: 'info|warning|danger', def: 'info' },
            { name: 'title', type: 'ReactNode', note: '可选标题' },
            { name: 'duration', type: 'number', def: '6500', note: '毫秒,自动消失' },
            { name: 'debugDetails', type: 'ReactNode', note: '等宽脚注' },
          ]}
        />
      </Section>
    ),
  },
  {
    id: 'c-sidebar',
    label: 'Sidebar',
    render: () => (
      <Section id="c-sidebar" title="Sidebar" description="左侧导航骨架 · 可折叠(点顶部图标)。布局壳见 AppShell。">
        <div className="h-[440px] w-fit overflow-hidden rounded-card border border-border-300">
          <Sidebar className="h-full">
            <SidebarHeader />
            <SidebarBody>
              <SidebarAction>新建</SidebarAction>
              <SidebarGroup>
                <SidebarItem icon={<MessageSquare className="size-[18px]" />} active>
                  选项一
                </SidebarItem>
                <SidebarItem icon={<Layers className="size-[18px]" />} badge={<Badge variant="accent">3</Badge>}>
                  选项二
                </SidebarItem>
                <SidebarItem icon={<Briefcase className="size-[18px]" />}>选项三</SidebarItem>
              </SidebarGroup>
              <SidebarGroup label="分组">
                <SidebarItem icon={<Palette className="size-[18px]" />} action={<Check className="size-4" />}>
                  子项一
                </SidebarItem>
              </SidebarGroup>
            </SidebarBody>
            <SidebarFooter name="预览用户" caption="免费版" initials="预" />
          </Sidebar>
        </div>
        <PropsTable
          rows={[
            { name: 'Sidebar.defaultCollapsed', type: 'boolean', def: 'false' },
            { name: 'SidebarItem', type: 'icon / active / disabled / badge / action' },
            { name: '子组件', type: 'Header / Body / Action / Group / Item / Footer' },
          ]}
        />
      </Section>
    ),
  },
]
