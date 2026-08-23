/**
 * 还款拆分纯函数（前后端共享，禁止引入任何服务端依赖）。
 * 规则：单个目标先息后本；超还按给定目标顺序自动溢出分配。
 */

export interface SplitTarget {
  /** 目标标识：bill:<id> 或 personal:<id> */
  key: string;
  kind: "bill" | "personal";
  id: number;
  /** 展示用标题，如「招行e招贷 · 第3期」「垫付款」 */
  label: string;
  /** 剩余应付利息（分） */
  interestRemaining: number;
  /** 剩余应付本金（分），按计划还的本金 */
  principalRemaining: number;
  /**
   * 额外可充本金的上限（分）。
   * 用于 interestOnly 类计划中早期账单：本账单计划本金=0，但同一账户仍有未还本金时，
   * 用户多还的金额能充作本金（落到本账单的 paid_principal），从而驱动后续账单利息按已减本金重算。
   * 默认 0。
   */
  extraPrincipalCapacity?: number;
}

export interface SplitResult {
  key: string;
  kind: "bill" | "personal";
  id: number;
  label: string;
  interestPart: number;
  principalPart: number;
  applied: number;
}

export interface Allocation {
  results: SplitResult[];
  /** 分完后仍剩余的金额（该人债务已全部结清才会有） */
  remainder: number;
  totalApplied: number;
}

/** 单目标先息后本拆分 */
export function splitSingle(
  target: SplitTarget,
  amountCents: number,
): SplitResult {
  const interestPart = Math.min(amountCents, Math.max(target.interestRemaining, 0));
  // 本金 = 剩余金额，但上限 = 计划本金 + 额外可充本金（让"超额还款"能落为本金）
  const principalCap = Math.max(target.principalRemaining, 0) + Math.max(target.extraPrincipalCapacity ?? 0, 0);
  const principalPart = Math.min(amountCents - interestPart, principalCap);
  return {
    key: target.key,
    kind: target.kind,
    id: target.id,
    label: target.label,
    interestPart,
    principalPart,
    applied: interestPart + principalPart,
  };
}

/**
 * 按目标顺序依次分配金额（先息后本），直到金额分完或目标耗尽。
 * targets 的顺序即分配优先级（调用方保证首选目标在首位）。
 */
export function allocateRepayment(targets: SplitTarget[], amountCents: number): Allocation {
  const results: SplitResult[] = [];
  let remaining = amountCents;
  for (const t of targets) {
    if (remaining <= 0) break;
    const r = splitSingle(t, remaining);
    if (r.applied > 0) {
      results.push(r);
      remaining -= r.applied;
    }
  }
  return {
    results,
    remainder: remaining,
    totalApplied: amountCents - remaining,
  };
}
