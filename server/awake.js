// When the server keeps itself awake on a free host (see the end of index.js).

/** KEEP_AWAKE value -> null (never), [0, 24] (all day) or [from, to] in UTC hours; unset means 10-4 */
export function keepAwakeWindow(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(0|off|false|no|never)$/.test(s)) return null;
  if (/^(on|all|always|yes|true|24)$/.test(s)) return [0, 24];
  const m = (s || '10-4').match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return [10, 4];
  return [Math.min(23, Number(m[1])), Math.min(24, Number(m[2]))];
}
/** is this UTC hour inside the window? (windows can wrap past midnight) */
export const inWindow = (w, hour) => !!w && (w[0] === 0 && w[1] === 24 ? true : w[0] <= w[1] ? hour >= w[0] && hour < w[1] : hour >= w[0] || hour < w[1]);
