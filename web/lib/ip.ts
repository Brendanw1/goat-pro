/** Innings stored as decimal thirds (130.333) shown in box-score notation (130.1). MiLB lines already use it; don't pass those. */
export function fmtIp(v: number): string {
  const whole = Math.floor(v + 1e-6);
  const outs = Math.round((v - whole) * 3);
  return outs === 3 ? `${whole + 1}.0` : `${whole}.${outs}`;
}
