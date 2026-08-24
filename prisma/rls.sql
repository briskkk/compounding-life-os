-- Family Wealth OS · PostgreSQL 原生行级安全策略
--
-- 模型：每个请求在事务内设置会话 GUC：
--   SET LOCAL app.family_id = '<当前家庭空间 id>';
-- 之后所有查询只能看到并只能写入该家庭的行（与应用层 scoped.ts 同一策略清单）。
-- current_setting(..., true)：未设置时返回 NULL → 比较结果为 NULL → 行不可见（默认拒绝）。

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Member', 'Account', 'Asset', 'Transaction',
    'Liability', 'LiabilityEntry', 'Goal', 'SavingsEntry',
    'Snapshot', 'PortfolioReview', 'ImportBatch', 'AuditLog'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t); -- 表 owner 同样受约束
    EXECUTE format('DROP POLICY IF EXISTS family_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY family_isolation ON %I
         USING ("familyId" = current_setting(''app.family_id'', true))
         WITH CHECK ("familyId" = current_setting(''app.family_id'', true));',
      t
    );
  END LOOP;
END $$;

-- 说明：
-- 1. AuditLog.familyId 可空；FORCE 之后 familyId 为 NULL 的行对普通角色不可见（系统行）。
--    若希望家庭成员可见，可把 Policy 的 USING 改为：
--    "familyId" = current_setting('app.family_id', true) OR "familyId" IS NULL
-- 2. PriceBar / RateBar / FundEstimate / FundCalibration 为全局行情数据，不启用 RLS。
-- 3. User / Session / Invite 为全局认证与邀请数据，不启用 RLS（应用层会话校验后取 Member 角色）。
-- 4. 推荐为应用建独立角色（不使用超级用户），RLS 才会生效：
--    CREATE ROLE fwos_app LOGIN PASSWORD '...';
--    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fwos_app;
-- 5. 应用侧事务封装示例（Prisma $transaction 内第一条语句执行 SET LOCAL），
--    与应用层 scoped.ts 双保险共存，互不冲突。
