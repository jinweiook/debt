/**
 * 方言无关的 schema 入口：service 层统一从这里 import 表对象与类型。
 * 运行时按 DB_DIALECT 选择 pg / mysql 实现；TS 类型一律以 pg 版为准
 * （两版列定义人工保持同步，见 R2 风险点）。
 */
import { isMysql } from "./dialect";
import * as pg from "./schema.pg";
import * as mysql from "./schema.mysql";

const s = isMysql() ? mysql : pg;

export const persons = s.persons as unknown as typeof pg.persons;
export const debtAccounts = s.debtAccounts as unknown as typeof pg.debtAccounts;
export const installmentBills = s.installmentBills as unknown as typeof pg.installmentBills;
export const repayments = s.repayments as unknown as typeof pg.repayments;
export const advances = s.advances as unknown as typeof pg.advances;
export const users = s.users as unknown as typeof pg.users;
export const loginAttempts = s.loginAttempts as unknown as typeof pg.loginAttempts;
export const roles = s.roles as unknown as typeof pg.roles;
export const rolePermissions = s.rolePermissions as unknown as typeof pg.rolePermissions;
export const userRoles = s.userRoles as unknown as typeof pg.userRoles;

/**
 * 归属维度类型：普通客户 = 自己的 users.id（UUID）；管理员 = null（不过滤，看全部）
 */
export type OwnerId = string | null;

export type Person = typeof pg.persons.$inferSelect;
export type DebtAccount = typeof pg.debtAccounts.$inferSelect;
export type InstallmentBill = typeof pg.installmentBills.$inferSelect;
export type Repayment = typeof pg.repayments.$inferSelect;
export type Advance = typeof pg.advances.$inferSelect;
export type User = typeof pg.users.$inferSelect;
export type Role = typeof pg.roles.$inferSelect;
export type RolePermission = typeof pg.rolePermissions.$inferSelect;
export type UserRole = typeof pg.userRoles.$inferSelect;
