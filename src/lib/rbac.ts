/**
 * RBAC 权限常量、角色默认定义与通用辅助函数（前后端共享，无 Node-only 依赖）。
 */

export type DataScope = "all" | "self";

export const PERMISSION_GROUPS = [
  {
    key: "overview",
    label: "总览统计",
    permissions: [
      { code: "overview:read", label: "查看总览", desc: "查看总览指标与月度应收预测" },
      { code: "overview:all_customers", label: "按客户总览", desc: "查看各客户的独立账单统计总览" },
    ],
  },
  {
    key: "person",
    label: "欠款人管理",
    permissions: [
      { code: "person:read", label: "查看欠款人", desc: "浏览欠款人列表与详情" },
      { code: "person:create", label: "新增欠款人", desc: "创建欠款人档案" },
      { code: "person:update", label: "编辑欠款人", desc: "编辑或归档欠款人信息" },
      { code: "person:delete", label: "删除欠款人", desc: "级联删除欠款人及全部账单" },
      { code: "person:assign_owner", label: "分配归属客户", desc: "新增/编辑欠款人时指定归属客户" },
    ],
  },
  {
    key: "debt",
    label: "借贷款账单",
    permissions: [
      { code: "debt:read", label: "查看借贷款", desc: "浏览分期、个人欠款及逐期账单" },
      { code: "debt:create", label: "新增借贷款", desc: "创建银行分期或个人欠款" },
      { code: "debt:update", label: "编辑借贷款", desc: "修改分期账户、账单或关闭个欠" },
      { code: "debt:delete", label: "删除借贷款", desc: "删除分期或个人欠款记录" },
    ],
  },
  {
    key: "repayment",
    label: "还款与垫付",
    permissions: [
      { code: "repayment:create", label: "记还款", desc: "登记还款流水并自动拆分抵扣" },
      { code: "repayment:delete", label: "删除还款", desc: "删除还款流水并回滚账单余额" },
      { code: "advance:create", label: "标记垫付", desc: "将分期账单标记为本人垫付" },
    ],
  },
  {
    key: "backup",
    label: "备份与数据",
    permissions: [
      { code: "backup:export", label: "导出 JSON", desc: "导出权限范围内的 JSON 快照" },
      { code: "backup:import", label: "导入 JSON", desc: "导入 JSON 快照恢复数据" },
      { code: "backup:export_sql", label: "导出整库 SQL", desc: "导出含账号表的整库 SQL 备份" },
      { code: "backup:clear_all", label: "清空全库", desc: "清空全部业务数据（危险操作）" },
    ],
  },
  {
    key: "admin",
    label: "后台管理",
    permissions: [
      { code: "user:read", label: "查看用户", desc: "查看客户账号列表与名下统计" },
      { code: "user:create", label: "新增用户", desc: "创建客户或管理员账号" },
      { code: "user:update", label: "编辑用户", desc: "修改用户信息、角色与启停状态" },
      { code: "user:reset_password", label: "重置密码", desc: "重置指定账号登录密码" },
      { code: "role:manage", label: "角色权限管理", desc: "配置 RBAC 角色与权限矩阵" },
    ],
  },
] as const;

export type PermissionCode = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["code"];

export const ALL_PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.code),
);

/** 内置 admin 角色不可移除的核心权限，避免管理员自锁 */
export const ADMIN_LOCKED_PERMISSIONS: readonly PermissionCode[] = [
  "user:read",
  "user:create",
  "user:update",
  "role:manage",
];

export interface BuiltinRoleDef {
  code: string;
  name: string;
  description: string;
  dataScope: DataScope;
  permissions: readonly PermissionCode[];
}

export const BUILTIN_ROLES: readonly BuiltinRoleDef[] = [
  {
    code: "admin",
    name: "超级管理员",
    description: "拥有全部功能权限，可查看并管理全部客户及自身账单",
    dataScope: "all",
    permissions: ALL_PERMISSION_CODES,
  },
  {
    code: "user",
    name: "普通客户",
    description: "可录入与管理自己名下的欠款人、借贷款、还款与个人备份",
    dataScope: "self",
    permissions: [
      "overview:read",
      "person:read",
      "person:create",
      "person:update",
      "person:delete",
      "debt:read",
      "debt:create",
      "debt:update",
      "debt:delete",
      "repayment:create",
      "repayment:delete",
      "advance:create",
      "backup:export",
      "backup:import",
    ],
  },
  {
    code: "viewer",
    name: "只读客户",
    description: "仅可查看自己名下的总览、欠款人与账单明细，不可修改数据",
    dataScope: "self",
    permissions: ["overview:read", "person:read", "debt:read"],
  },
];

export function isValidPermissionCode(code: string): code is PermissionCode {
  return (ALL_PERMISSION_CODES as readonly string[]).includes(code);
}

export function hasPermission(permissions: readonly string[] | undefined | null, code: PermissionCode): boolean {
  return !!permissions?.includes(code);
}

export function hasAnyPermission(
  permissions: readonly string[] | undefined | null,
  codes: readonly PermissionCode[],
): boolean {
  if (!permissions || permissions.length === 0) return false;
  return codes.some((c) => permissions.includes(c));
}

/** 格式化用户展示名：有姓名时显示「姓名 (账号)」，否则只显示账号 */
export function formatUserDisplayName(user: { displayName?: string | null; username: string }): string {
  const name = user.displayName?.trim();
  return name ? `${name} (${user.username})` : user.username;
}

/** 简短展示名：优先姓名，无则账号 */
export function shortUserDisplayName(user: { displayName?: string | null; username: string }): string {
  const name = user.displayName?.trim();
  return name || user.username;
}
