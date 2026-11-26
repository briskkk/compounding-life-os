/** 产品品牌名：部署方可通过环境变量覆盖，默认为中性名。 */
export const BRAND_NAME = process.env.BRAND_NAME?.trim() || 'Compound Life'
export const BRAND_NAME_EN = process.env.BRAND_NAME_EN?.trim() || 'Compound Life'
