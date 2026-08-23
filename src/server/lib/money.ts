/**
 * 金额工具：内部一律「分」(number, 整数)，界面输入输出为「元」。
 * 禁止在 UI 层自行乘除 100，统一走这里。
 */

/** 元（字符串/数字输入）→ 分，half-up 舍入。非法输入返回 null */
export function yuanToCents(input: string | number): number | null {
  const s = String(input).trim().replace(/[¥,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [intPart, decPart = ""] = s.replace("-", "").split(".");
  const cents = Number(intPart) * 100 + Number((decPart + "00").slice(0, 2));
  return neg ? -cents : cents;
}

/** 分 → 元字符串（保留两位） */
export function centsToYuan(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${yuan}.${dec}`;
}

/** 分 → 带千分位显示，如 12,345.67 */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  const grouped = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}.${dec}`;
}

/** 年化利率基点 ⇄ 百分比。12% ⇄ 1200 bps */
export function percentToBps(percent: string | number): number | null {
  const s = String(percent).trim().replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

/**
 * 月利息（整数运算，half-up）：
 * 当月利息 = 剩余本金(分) × 年化bps / 10000 / 12
 * 即 round(principal * bps / 120000)。
 * 安全性：principal 1e11 分（10 亿元）× bps 1e4 = 1e15 < 2^53，个人场景足够安全。
 */
export function monthlyInterestCents(principalCents: number, annualRateBps: number): number {
  if (principalCents <= 0 || annualRateBps <= 0) return 0;
  return Math.round((principalCents * annualRateBps) / 120000);
}
