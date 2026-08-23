/** 月份粒度工具（YYYY-MM），本地时区 */

export function toMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function currentMonth(): string {
  return toMonth(new Date());
}

/** month 'YYYY-MM' 加 n 个月 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return toMonth(d);
}

/** 两个月份相差月数：a - b（a 晚于 b 为正） */
export function diffMonths(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (ay - by) * 12 + (am - bm);
}

/** 今天 YYYY-MM-DD */
export function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 日期字符串加 n 个月（月底日自动收敛，如 1/31 + 1月 → 2/28） */
export function addMonthsToDate(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${target.getFullYear()}-${mm}-${dd}`;
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}
