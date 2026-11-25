import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/server/db/client";
import { insertAndGetId } from "@/server/db/helpers";
import { rolePermissions, roles, userRoles, users } from "@/server/db/schema";
import {
  ADMIN_LOCKED_PERMISSIONS,
  ALL_PERMISSION_CODES,
  BUILTIN_ROLES,
  isValidPermissionCode,
  type DataScope,
  type PermissionCode,
} from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/server/lib/errors";

export interface UserRbacInfo {
  roleIds: number[];
  roles: string[];
  roleNames: string[];
  permissions: PermissionCode[];
  dataScope: DataScope;
}

export interface RoleDetail {
  id: number;
  code: string;
  name: string;
  description: string | null;
  dataScope: DataScope;
  isSystem: number;
  permissions: PermissionCode[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export const roleInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,32}$/, "角色编码需为 2-32 位小写字母、数字或下划线"),
  name: z.string().trim().min(1, "角色名称不能为空").max(64),
  description: z.string().trim().max(255).optional().or(z.literal("")),
  dataScope: z.enum(["all", "self"]),
  permissions: z.array(z.string()).default([]),
});

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(1, "角色名称不能为空").max(64),
  description: z.string().trim().max(255).optional().or(z.literal("")),
  dataScope: z.enum(["all", "self"]),
  permissions: z.array(z.string()).default([]),
});

function sanitizePermissions(raw: string[]): PermissionCode[] {
  const unique = new Set<PermissionCode>();
  for (const code of raw) {
    if (!isValidPermissionCode(code)) {
      throw new ValidationError(`无效的权限标识：${code}`);
    }
    unique.add(code);
  }
  return [...unique];
}

/**
 * 幂等初始化内置 RBAC 角色与权限，并为存量未分配角色的用户补齐 user_roles。
 */
export async function seedDefaultRbac(overrideDb?: Db): Promise<void> {
  const db = overrideDb ?? getDb();
  const existingRoles = await db.select().from(roles);
  const roleByCode = new Map(existingRoles.map((r) => [r.code, r]));

  for (const def of BUILTIN_ROLES) {
    let roleId = roleByCode.get(def.code)?.id;
    if (!roleId) {
      roleId = await insertAndGetId(db, roles, {
        code: def.code,
        name: def.name,
        description: def.description,
        dataScope: def.dataScope,
        isSystem: 1,
      });
      if (def.permissions.length > 0) {
        await db.insert(rolePermissions).values(
          def.permissions.map((permissionCode) => ({ roleId: roleId!, permissionCode })),
        );
      }
      roleByCode.set(def.code, {
        id: roleId,
        code: def.code,
        name: def.name,
        description: def.description,
        dataScope: def.dataScope,
        isSystem: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else if (def.code === "admin") {
      // 确保内置 admin 始终包含全量默认权限（兼容版本升级新增的权限码）
      const curPerms = await db
        .select({ permissionCode: rolePermissions.permissionCode })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      const hasSet = new Set(curPerms.map((p) => p.permissionCode));
      const missing = ALL_PERMISSION_CODES.filter((p) => !hasSet.has(p));
      if (missing.length > 0) {
        await db.insert(rolePermissions).values(
          missing.map((permissionCode) => ({ roleId: roleId!, permissionCode })),
        );
      }
    }
  }

  // 为尚未绑定角色的存量用户补齐默认绑定
  const [allUsers, allBindings] = await Promise.all([
    db.select({ id: users.id, role: users.role }).from(users),
    db.select({ userId: userRoles.userId }).from(userRoles),
  ]);
  const boundUserIds = new Set(allBindings.map((b) => b.userId));
  const fallbackUserRoleId = roleByCode.get("user")?.id;

  const inserts: { userId: string; roleId: number }[] = [];
  for (const u of allUsers) {
    if (boundUserIds.has(u.id)) continue;
    const targetRoleId = roleByCode.get(u.role)?.id ?? fallbackUserRoleId;
    if (targetRoleId) {
      inserts.push({ userId: u.id, roleId: targetRoleId });
    }
  }
  if (inserts.length > 0) {
    await db.insert(userRoles).values(inserts);
  }
}

/** 查询单个用户的 RBAC 角色、权限与数据范围 */
export async function getUserRbac(userId: string, fallbackRoleCode = "user"): Promise<UserRbacInfo> {
  const db = getDb();
  const bound = await db
    .select({
      roleId: roles.id,
      code: roles.code,
      name: roles.name,
      dataScope: roles.dataScope,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))
    .orderBy(asc(roles.id));

  if (bound.length === 0) {
    // 兜底：当尚无 user_roles 记录时按 users.role 映射内置定义
    const def = BUILTIN_ROLES.find((r) => r.code === fallbackRoleCode) ?? BUILTIN_ROLES[1];
    return {
      roleIds: [],
      roles: [def.code],
      roleNames: [def.name],
      permissions: [...def.permissions],
      dataScope: def.dataScope,
    };
  }

  const roleIds = bound.map((b) => b.roleId);
  const permRows = await db
    .select({ permissionCode: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));

  const perms = new Set<PermissionCode>();
  for (const row of permRows) {
    if (isValidPermissionCode(row.permissionCode)) {
      perms.add(row.permissionCode);
    }
  }

  const dataScope: DataScope = bound.some((b) => b.dataScope === "all") ? "all" : "self";
  return {
    roleIds,
    roles: bound.map((b) => b.code),
    roleNames: bound.map((b) => b.name),
    permissions: [...perms],
    dataScope,
  };
}

/** 列出全部角色及其权限、绑定用户数 */
export async function listRolesWithDetails(): Promise<RoleDetail[]> {
  const db = getDb();
  const [roleRows, permRows, userRoleRows] = await Promise.all([
    db.select().from(roles).orderBy(desc(roles.isSystem), asc(roles.id)),
    db.select().from(rolePermissions),
    db.select().from(userRoles),
  ]);

  const permsByRole = new Map<number, PermissionCode[]>();
  for (const p of permRows) {
    if (!isValidPermissionCode(p.permissionCode)) continue;
    const list = permsByRole.get(p.roleId) ?? [];
    list.push(p.permissionCode);
    permsByRole.set(p.roleId, list);
  }

  const countByRole = new Map<number, number>();
  for (const ur of userRoleRows) {
    countByRole.set(ur.roleId, (countByRole.get(ur.roleId) ?? 0) + 1);
  }

  return roleRows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    dataScope: r.dataScope === "all" ? "all" : "self",
    isSystem: r.isSystem,
    permissions: permsByRole.get(r.id) ?? [],
    userCount: countByRole.get(r.id) ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/** 新增自定义角色 */
export async function createRole(rawInput: unknown): Promise<number> {
  const parsed = roleInputSchema.parse(rawInput);
  const perms = sanitizePermissions(parsed.permissions);
  const db = getDb();

  const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, parsed.code)).limit(1);
  if (existing) {
    throw new BusinessRuleError(`角色编码「${parsed.code}」已存在`);
  }

  return db.transaction(async (tx) => {
    const roleId = await insertAndGetId(tx, roles, {
      code: parsed.code,
      name: parsed.name,
      description: parsed.description || null,
      dataScope: parsed.dataScope,
      isSystem: 0,
    });
    if (perms.length > 0) {
      await tx.insert(rolePermissions).values(perms.map((permissionCode) => ({ roleId, permissionCode })));
    }
    return roleId;
  });
}

/** 更新角色信息与权限 */
export async function updateRole(roleId: number, rawInput: unknown): Promise<void> {
  const parsed = roleUpdateSchema.parse(rawInput);
  const perms = sanitizePermissions(parsed.permissions);
  const db = getDb();

  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw new NotFoundError("角色不存在");

  if (role.code === "admin") {
    if (parsed.dataScope !== "all") {
      throw new BusinessRuleError("超级管理员角色必须保留「全部客户」数据范围");
    }
    for (const required of ADMIN_LOCKED_PERMISSIONS) {
      if (!perms.includes(required)) {
        throw new BusinessRuleError("超级管理员角色不能移除核心管理权限");
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(roles)
      .set({
        name: parsed.name,
        description: parsed.description || null,
        dataScope: parsed.dataScope,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, roleId));

    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (perms.length > 0) {
      await tx.insert(rolePermissions).values(perms.map((permissionCode) => ({ roleId, permissionCode })));
    }
  });
}

/** 删除自定义角色 */
export async function deleteRole(roleId: number): Promise<void> {
  const db = getDb();
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw new NotFoundError("角色不存在");
  if (role.isSystem === 1) {
    throw new BusinessRuleError("系统内置角色不可删除");
  }

  const [bound] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.roleId, roleId))
    .limit(1);
  if (bound) {
    throw new BusinessRuleError("该角色仍绑定了用户，请先在客户管理中调整用户角色");
  }

  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    await tx.delete(roles).where(eq(roles.id, roleId));
  });
}

/** 在事务内设置用户角色列表，并返回主角色编码与所有角色编码 */
export async function setUserRoles(
  tx: Db,
  userId: string,
  roleIds: number[],
): Promise<{ primaryRole: string; roleCodes: string[] }> {
  const uniqueIds = [...new Set(roleIds)].filter((n) => Number.isInteger(n) && n > 0);
  if (uniqueIds.length === 0) {
    throw new ValidationError("请至少为用户分配一个角色");
  }

  const roleRows = await tx.select().from(roles).where(inArray(roles.id, uniqueIds));
  if (roleRows.length !== uniqueIds.length) {
    throw new ValidationError("所选角色不存在或已被删除");
  }

  await tx.delete(userRoles).where(eq(userRoles.userId, userId));
  await tx.insert(userRoles).values(uniqueIds.map((roleId) => ({ userId, roleId })));

  const roleCodes = roleRows.map((r) => r.code);
  const primaryRole = roleCodes.includes("admin") ? "admin" : roleCodes[0];
  return { primaryRole, roleCodes };
}

/** 统计拥有 admin 角色且处于 active 状态的用户 ID 集合 */
export async function listActiveAdminUserIds(tx?: Db): Promise<string[]> {
  const db = tx ?? getDb();
  const rows = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(roles.code, "admin"));

  if (rows.length === 0) {
    const legacy = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.role, "admin"));
    return legacy.filter((u) => u.status === "active").map((u) => u.id);
  }

  const ids = [...new Set(rows.map((r) => r.userId))];
  const activeUsers = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(inArray(users.id, ids));
  return activeUsers.filter((u) => u.status === "active").map((u) => u.id);
}

export async function getUserRoleBindingsMap(): Promise<Map<string, { id: number; code: string; name: string; dataScope: DataScope }[]>> {
  const db = getDb();
  const rows = await db
    .select({
      userId: userRoles.userId,
      id: roles.id,
      code: roles.code,
      name: roles.name,
      dataScope: roles.dataScope,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .orderBy(asc(roles.id));

  const map = new Map<string, { id: number; code: string; name: string; dataScope: DataScope }[]>();
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push({
      id: r.id,
      code: r.code,
      name: r.name,
      dataScope: r.dataScope === "all" ? "all" : "self",
    });
    map.set(r.userId, list);
  }
  return map;
}

export async function bumpUsersTokenVersionByRole(roleId: number): Promise<void> {
  const db = getDb();
  const bindings = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, roleId));
  if (bindings.length === 0) return;
  const userIds = bindings.map((b) => b.userId);
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
    .where(inArray(users.id, userIds));
}
