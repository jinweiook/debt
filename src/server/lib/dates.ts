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

/** 两个日期 'YYYY-MM-DD' 相差天数：toDate - fromDate（UTC 计算，不受夏令时与本地时区影响） */
export function diffDays(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/** 计息周期天数：若前置日期有效且周期天数 > 0 则取实际天数，否则兜底按 30 天 */
export function billingPeriodDays(prevDate: string | null | undefined, dueDate: string): number {
  if (!prevDate) return 30;
  const d = diffDays(prevDate, dueDate);
  return d > 0 ? d : 30;
}
