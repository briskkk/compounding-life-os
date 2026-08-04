/** 产品品牌名：部署方可通过环境变量覆盖，默认为中性名。 */
export const BRAND_NAME = process.env.BRAND_NAME?.trim() || '家庭财富终端'
export const BRAND_NAME_EN = process.env.BRAND_NAME_EN?.trim() || 'Family Wealth OS'
