import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from 'desktop'

/** FAQ / 可折叠分组。 */
export function Basic() {
  return (
    <Accordion type="single" collapsible defaultValue="a" className="w-full max-w-md">
      <AccordionItem value="a">
        <AccordionTrigger>什么是间隔重复？</AccordionTrigger>
        <AccordionContent>按记忆曲线安排复习间隔，让长期记忆更牢固。</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>如何更换在学词书？</AccordionTrigger>
        <AccordionContent>在单词本首页点「更换词书」，选择新书即可，进度会保留。</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
