/**
 * Turns a session title into a coarse work category. Rule based on purpose: it
 * is transparent, free, and can be replaced by a model classifier later without
 * touching anything else. Order matters — the first matching rule wins.
 */
export type WorkCategory = 'coding' | 'writing' | 'spreadsheet' | 'slides' | 'research' | 'files' | 'other'

const RULES: [WorkCategory, RegExp][] = [
  ['coding', /代码|编程|函数|报错|bug|调试|重构|接口|api|接口|测试|编译|部署|脚本|python|javascript|typescript|rust|java|sql|git|docker|shell|code|debug|refactor|compile/i],
  ['spreadsheet', /表格|excel|xlsx|csv|数据|统计|透视|汇总|清洗|spreadsheet|pivot/i],
  ['slides', /ppt|幻灯片|演示|汇报材料|slides|presentation|deck/i],
  ['writing', /文章|文案|报告|周报|日报|月报|方案|文档|写作|总结|邮件|纪要|翻译|润色|write|article|report|document|essay|proposal|translate/i],
  ['research', /调研|检索|搜索|资料|对比|竞品|行情|research|search|compare|market/i],
  ['files', /整理文件|重命名|批量|归档|分类文件|rename|organize files|batch/i],
]

export function classifyTitle(title: string): WorkCategory {
  for (const [category, pattern] of RULES) {
    if (pattern.test(title)) return category
  }
  return 'other'
}

export const CATEGORY_LABELS: Record<WorkCategory, string> = {
  coding: '编码/调试',
  writing: '写作/文档',
  spreadsheet: '表格/数据',
  slides: '演示/PPT',
  research: '调研/检索',
  files: '文件整理',
  other: '其它',
}
