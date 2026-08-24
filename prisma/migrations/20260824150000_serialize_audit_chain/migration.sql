-- 旧记录保持 NULL 以兼容既有链；新记录写入显式作用域及 prevHash / GENESIS。
-- 复合唯一索引保证每条链的一个父哈希只能产生一个后继节点，也覆盖无 familyId 的系统审计。
ALTER TABLE "AuditLog" ADD COLUMN "chainScope" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "chainKey" TEXT;

CREATE UNIQUE INDEX "AuditLog_chainScope_chainKey_key" ON "AuditLog"("chainScope", "chainKey");
