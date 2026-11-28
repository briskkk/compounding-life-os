import { z } from 'zod'

export const creatorDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')

export const creatorPublicFields = [
  'assetTotal', 'pnl', 'netContribution', 'operations',
] as const

const explicitCalendar = z.object({
  kind: z.literal('EXPLICIT'),
  from: creatorDate,
  through: creatorDate,
  sessions: z.array(creatorDate).max(36600),
}).strict().refine((value) => value.from <= value.through
  && Date.parse(`${value.through}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) <= 36525 * 86400000
  && value.sessions.every((date, i) => date >= value.from && date <= value.through
    && (i === 0 || date > value.sessions[i - 1])), 'Calendar must be sorted, unique and within coverage')

export const creatorCalendarSchema = z.union([
  z.object({ kind: z.literal('CN_FUND') }).strict(),
  explicitCalendar,
])
export type CreatorCalendar = z.infer<typeof creatorCalendarSchema>

export const creatorProfileSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  enabled: z.boolean(),
  familyId: z.string().min(1),
  authorizedByUserId: z.string().min(1),
  accountIds: z.array(z.string().min(1)).min(1).max(500).refine((ids) => new Set(ids).size === ids.length),
  scope: z.literal('INVESTABLE'),
  accountScopeLabel: z.string().trim().min(1).max(40),
  startDate: creatorDate,
  cutoffTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/),
  calendar: creatorCalendarSchema,
  // Foreign markets require explicitly covered Beijing attribution calendars.
  valuationCalendars: z.record(creatorCalendarSchema).default({}),
  operationLabels: z.record(z.string().trim().min(1).max(60)),
  publicFields: z.array(z.enum(creatorPublicFields)).length(creatorPublicFields.length)
    .refine((fields) => new Set(fields).size === creatorPublicFields.length),
  tokenHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(10),
}).strict()
export type CreatorProfile = z.infer<typeof creatorProfileSchema>

export const creatorConfigSchema = z.object({
  version: z.literal(1),
  profiles: z.array(creatorProfileSchema).max(100),
}).strict().superRefine((config, ctx) => {
  const slugs = new Set<string>()
  const hashes = new Set<string>()
  for (const profile of config.profiles) {
    if (slugs.has(profile.slug)) ctx.addIssue({ code: 'custom', message: 'Duplicate profile' })
    slugs.add(profile.slug)
    for (const hash of profile.tokenHashes) {
      if (hashes.has(hash)) ctx.addIssue({ code: 'custom', message: 'Credential must belong to one profile' })
      hashes.add(hash)
    }
  }
})

const money = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/)
const common = { profile: z.string(), date: creatorDate }
export const creatorSnapshotSchema = z.discriminatedUnion('status', [
  z.object({ ...common, status: z.literal('pending') }).strict(),
  z.object({ ...common, status: z.literal('no_session') }).strict(),
  z.object({
    ...common,
    status: z.literal('ready'),
    snapshotId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    kind: z.enum(['baseline', 'daily']),
    dayNumber: z.number().int().positive(),
    currency: z.literal('CNY'),
    accountScopeLabel: z.string(),
    assetTotal: money,
    pnl: money.nullable(),
    netContribution: money.nullable(),
    valuation: z.object({
      status: z.literal('SETTLED'), asOfDate: creatorDate,
      cutoffAt: z.string().datetime({ offset: true }),
    }).strict(),
    operations: z.array(z.object({
      side: z.enum(['BUY', 'SELL', 'RECURRING']), label: z.string(), amount: money,
    }).strict()),
  }).strict(),
])
export type CreatorSnapshot = z.infer<typeof creatorSnapshotSchema>
