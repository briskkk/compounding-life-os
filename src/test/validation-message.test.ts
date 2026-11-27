// 校验错误转写：用户看到的必须是中文句子与字段级提示，不能是 ZodError 的 JSON 原文
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { describeZodError } from '@/lib/validation-message'

function parseErrorOf<T>(schema: z.ZodType<T>, value: unknown): z.ZodError {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('期望校验失败')
  return result.error
}

describe('校验错误转写', () => {
  it('Zod 内置英文消息被改写成中文并带字段名', () => {
    const schema = z.object({ amount: z.number().nonnegative(), fee: z.number().max(10) })
    const error = parseErrorOf(schema, { amount: -1, fee: 99 })
    const { text, fieldErrors } = describeZodError(error)
    expect(text).toContain('金额不能小于 0')
    expect(text).toContain('费用不能大于 10')
    expect(text).not.toMatch(/[A-Za-z]{4,}/) // 不出现英文长词
    expect(fieldErrors.amount).toBe('不能小于 0')
    expect(fieldErrors.fee).toBe('不能大于 10')
  })

  it('作者手写的中文消息原样透出，且不重复拼字段名', () => {
    const schema = z.object({ navDate: z.coerce.date() }).superRefine((v, ctx) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '成交净值日不能早于下单日', path: ['navDate'] })
    })
    const error = parseErrorOf(schema, { navDate: new Date() })
    const { text, fieldErrors } = describeZodError(error)
    expect(text).toBe('成交净值日不能早于下单日')
    expect(fieldErrors.navDate).toBe('成交净值日不能早于下单日')
  })

  it('缺失必填与字符串长度上限同样转写为中文', () => {
    const schema = z.object({ note: z.string().max(5), accountId: z.string().min(1, '请选择账户') })
    const error = parseErrorOf(schema, { note: '这是一个很长的备注', accountId: '' })
    const { text } = describeZodError(error)
    expect(text).toContain('备注最多 5 个字符')
    expect(text).toContain('请选择账户')
  })

  it('未知字段名不会把英文 key 暴露给用户', () => {
    const schema = z.object({ someInternalField: z.number() })
    const error = parseErrorOf(schema, { someInternalField: 'not-a-number' })
    const { text } = describeZodError(error)
    expect(text).toBe('格式不正确')
    expect(text).not.toContain('someInternalField')
  })

  it('嵌套字段未登记时使用已知父级标签', () => {
    const schema = z.object({ portfolioWeights: z.record(z.string(), z.number().nonnegative()) })
    const { text } = describeZodError(parseErrorOf(schema, { portfolioWeights: { unknown: -1 } }))
    expect(text).toBe('组合权重不能小于 0')
    expect(text).not.toContain('unknown')
  })

  it('超过上限的条目折叠为一项提示', () => {
    const schema = z.object({ a: z.number(), b: z.number(), c: z.number(), d: z.number() })
    const error = parseErrorOf(schema, { a: 'x', b: 'x', c: 'x', d: 'x' })
    const { text } = describeZodError(error)
    expect(text).toContain('另有 1 项需修正')
  })
})
