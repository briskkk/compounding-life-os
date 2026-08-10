/**
 * 一次性投资风格分类：按代码为行情类资产写入 Asset.style
 *
 * - 幂等：style 已与目标一致则跳过；只更新列出的 26 个行情类资产，
 *   CASH / GOLD / HUAWEI_STOCK / REAL_ESTATE 与 ARCHIVE-* 保持 null（未分类）。
 * - 审计：有变更时追加一条 UPDATE 审计（recordAudit 哈希链），并校验链完整性。
 *
 * 运行：npx tsx scripts/set-asset-styles.ts
 */
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { recordAudit, verifyChain } from '../src/lib/audit'
import { ASSET_STYLE_LABEL } from '../src/lib/labels'
import type { AssetStyle } from '../src/lib/engine/types'

const DB_PATH = path.resolve('prisma/dev.db')
const prisma = new PrismaClient({ datasourceUrl: `file:${DB_PATH}` })

const STYLE_BY_SYMBOL: Record<string, AssetStyle> = {
  // 成长
  '010372': 'GROWTH',
  '010826': 'GROWTH',
  '023633': 'GROWTH',
  // 价值
  '008269': 'VALUE',
  // 行业主题
  '001513': 'SECTOR_THEME',
  '015790': 'SECTOR_THEME',
  // 均衡
  '005094': 'BALANCED',
  '019432': 'BALANCED',
  '022368': 'BALANCED',
  // 宽基指数
  '018921': 'BROAD_INDEX',
  '040046': 'BROAD_INDEX',
  '014978': 'BROAD_INDEX',
  '021000': 'BROAD_INDEX',
  '021778': 'BROAD_INDEX',
  '513110': 'BROAD_INDEX',
  USQQQM: 'BROAD_INDEX',
  USQNDX: 'BROAD_INDEX',
  USVOO: 'BROAD_INDEX',
  '588090': 'BROAD_INDEX',
  // 行业指数
  '012348': 'SECTOR_INDEX',
  '019671': 'SECTOR_INDEX',
  '020501': 'SECTOR_INDEX',
  USVGT: 'SECTOR_INDEX',
  USSMH: 'SECTOR_INDEX',
  '159560': 'SECTOR_INDEX',
  '515880': 'SECTOR_INDEX',
}

async function main() {
  const family = await prisma.familySpace.findFirst({ include: { members: true } })
  if (!family) throw new Error('未找到家庭空间')
  const owner = family.members.find((m) => m.role === 'OWNER') ?? family.members[0]
  console.log(`· 家庭空间「${family.name}」，审计身份「${owner.name}」`)

  const assets = await prisma.asset.findMany({ where: { familyId: family.id } })
  const bySymbol = new Map(assets.map((a) => [a.symbol, a]))

  const changes: string[] = []
  for (const [symbol, style] of Object.entries(STYLE_BY_SYMBOL)) {
    const asset = bySymbol.get(symbol)
    if (!asset) {
      console.log(`  ✗ ${symbol} → ${ASSET_STYLE_LABEL[style]}：资产不存在，跳过`)
      continue
    }
    if (asset.style === style) {
      console.log(`  = ${symbol} ${asset.name}：已是${ASSET_STYLE_LABEL[style]}，跳过`)
      continue
    }
    await prisma.asset.update({ where: { id: asset.id }, data: { style } })
    const from = asset.style ? ASSET_STYLE_LABEL[asset.style as AssetStyle] : '未分类'
    console.log(`  ✓ ${symbol} ${asset.name}：${from} → ${ASSET_STYLE_LABEL[style]}`)
    changes.push(`${symbol} ${asset.name}：${from} → ${ASSET_STYLE_LABEL[style]}`)
  }

  if (changes.length > 0) {
    await recordAudit(prisma, {
      familyId: family.id,
      actorId: owner.id,
      actorName: owner.name,
      action: 'UPDATE',
      entity: 'Asset',
      detail: `投资风格分类：更新 ${changes.length} 项资产 —— ${changes.join('；')}`,
    })
    const chain = await verifyChain(prisma, family.id)
    console.log(`· 审计链校验：${chain.ok ? `完整（${chain.count} 条）` : `断裂于 ${chain.brokenAt}`}`)
    if (!chain.ok) throw new Error('审计哈希链断裂')
  } else {
    console.log('· 无变更，未写审计')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
