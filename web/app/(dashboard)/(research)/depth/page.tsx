import Link from "next/link";
import { getContactDepthLate, getContactDepthLeague, getContactDepthPitchers } from "@/lib/data";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { PITCH_CONFIG } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact depth" };

/**
 * League contact depth (RESULTS-MLB §89, pipeline/contact_depth.py). MLB 2024–26 regular season, competitive swings with
 * contact (foul + in play). Depth is centred within hitter × season × side, so every curve is "vs his own normal".
 * Descriptive, not a forecast.
 */
const GOLD = "#e3b341", GREY = "#8b93a7", DIM = "#5d6577";
const FAM_COLOR: Record<string, string> = { FB: PITCH_CONFIG.FF.color, BR: PITCH_CONFIG.SL.color, OS: PITCH_CONFIG.CH.color };
const FAM_NAME: Record<string, string> = { FB: "fastballs", BR: "breaking", OS: "offspeed" };
const BIN_X = [-11, -6, -2, 2, 6, 11];
const SEASONS = ["2026", "2025", "2024"];

function Fig({ title, n, read, children }: { title: string; n: string; read: string; children: React.ReactNode }) {
  return (
    <figure className="glass-panel p-4 flex flex-col">
      <figcaption className="mb-2">
        <h2 className="text-[13px] font-semibold text-text-primary leading-snug">{title}</h2>
        <div className="text-[10px] text-text-dim">{n}</div>
      </figcaption>
      <div className="flex-1">{children}</div>
      <p className="mt-2 text-[11px] text-text-secondary leading-snug">{read}</p>
    </figure>
  );
}

/** End-label y positions pushed apart to a minimum gap, keeping their order. */
function spread(ys: number[], gap = 11): number[] {
  const o = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < o.length; k++) o[k].y = Math.max(o[k].y, o[k - 1].y + gap);
  const out = new Array(ys.length);
  o.forEach((e) => (out[e.i] = e.y));
  return out;
}
const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");

function UShape({ u }: { u: Record<string, any[]> }) {
  const W = 460, H = 240, PL = 42, PR = 70, PT = 12, PB = 30;
  const series = [["all", "#fff"], ["fam:FB", FAM_COLOR.FB], ["fam:BR", FAM_COLOR.BR], ["fam:OS", FAM_COLOR.OS]] as const;
  const vals = series.flatMap(([k]) => u[k].map((b) => b.xw));
  const y0 = Math.min(...vals) - 0.01, y1 = Math.max(...vals) + 0.01;
  const sx = (v: number) => PL + ((v + 13) / 26) * (W - PL - PR), sy = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const uLab = spread(series.map(([k]) => sy(u[k][u[k].length - 1].xw)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="xwOBA on contact by depth">
      <rect x={sx(4)} y={PT} width={sx(8) - sx(4)} height={H - PT - PB} fill="rgba(227,179,65,0.08)" />
      <line x1={sx(0)} x2={sx(0)} y1={PT} y2={H - PB} stroke="rgba(255,255,255,0.15)" />
      <text x={sx(0) + 3} y={H - PB - 4} fontSize={8} fill={DIM}>his normal</text>
      {series.map(([k, c], si) => {
        const pts = u[k].map((b, i) => [sx(BIN_X[i]), sy(b.xw)] as [number, number]);
        const last = [pts[pts.length - 1][0], uLab[si]];
        return (
          <g key={k}>
            <path d={path(pts)} fill="none" stroke={c} strokeWidth={k === "all" ? 2.2 : 1.3} opacity={k === "all" ? 1 : 0.85} />
            {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={k === "all" ? 3 : 2} fill={c} />)}
            <text x={last[0] + 6} y={last[1] + 3} fontSize={9} fill={c}>{k === "all" ? "all" : FAM_NAME[k.slice(4)]}</text>
          </g>
        );
      })}
      {[y0, (y0 + y1) / 2, y1].map((v) => <text key={v} x={PL - 4} y={sy(v) + 3} textAnchor="end" fontSize={8} fill={DIM}>{v.toFixed(3)}</text>)}
      {["−8 or more", "−8 to −4", "−4 to 0", "0 to +4", "+4 to +8", "+8 or more"].map((l, i) => <text key={i} x={sx(BIN_X[i])} y={H - PB + 12} textAnchor="middle" fontSize={8} fill={DIM}>{l}</text>)}
      <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize={8} fill={DIM}>in. vs the hitter&apos;s own mean depth (deep ← → out front)</text>
    </svg>
  );
}

function Velo({ v }: { v: Record<string, any[]> }) {
  const W = 460, H = 240, PL = 30, PR = 70, PT = 12, PB = 30;
  const all = Object.values(v).flat();
  const x0 = Math.min(...all.map((p) => p.v)), x1 = Math.max(...all.map((p) => p.v));
  const ys = all.map((p) => p.dc), y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  const sx = (x: number) => PL + ((x - x0) / (x1 - x0)) * (W - PL - PR), sy = (y: number) => PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB);
  const vLab = spread(Object.values(v).map((rows) => sy(rows[rows.length - 1].dc)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="depth by pitch velocity">
      <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="rgba(255,255,255,0.15)" />
      {Object.entries(v).map(([f, rows], fi) => {
        const pts = rows.map((p) => [sx(p.v), sy(p.dc)] as [number, number]);
        const last = [pts[pts.length - 1][0], vLab[fi]];
        return (
          <g key={f}>
            <path d={path(pts)} fill="none" stroke={FAM_COLOR[f]} strokeWidth={1.8} />
            <text x={last[0] + 6} y={last[1] + 3} fontSize={9} fill={FAM_COLOR[f]}>{FAM_NAME[f]}</text>
          </g>
        );
      })}
      {[Math.ceil(y0), 0, Math.floor(y1)].map((y) => <text key={y} x={PL - 4} y={sy(y) + 3} textAnchor="end" fontSize={8} fill={DIM}>{y > 0 ? `+${y}` : y}</text>)}
      {Array.from({ length: 7 }, (_, i) => Math.round(x0 + (i * (x1 - x0)) / 6)).map((x) => <text key={x} x={sx(x)} y={H - PB + 12} textAnchor="middle" fontSize={8} fill={DIM}>{x}</text>)}
      <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize={8} fill={DIM}>pitch velocity, mph (release) · y = in. vs his own mean depth</text>
    </svg>
  );
}

function Trend({ week }: { week: Record<string, any[]> }) {
  const W = 940, H = 180, PL = 30, PR = 60, PT = 10, PB = 24;
  const colors: Record<string, string> = { "2024": "#5d7fa3", "2025": GREY, "2026": GOLD };
  const all = Object.values(week).flat();
  const d0 = Math.min(...all.map((w) => w.w * 7)), d1 = Math.max(...all.map((w) => w.w * 7 + 6));
  const lim = 1.5;
  const sx = (d: number) => PL + ((d - d0) / (d1 - d0)) * (W - PL - PR), sy = (y: number) => PT + (1 - (y + lim) / (2 * lim)) * (H - PT - PB);
  const wLab = spread(Object.values(week).map((rows) => sy(rows[rows.length - 1].dc)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="league contact depth by week">
      <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="rgba(255,255,255,0.15)" />
      {Object.entries(week).map(([s, rows], wi) => {
        const pts = rows.map((w) => [sx(w.w * 7 + 3), sy(w.dc)] as [number, number]);
        const last = [W - PR + 4, wLab[wi]];
        return (
          <g key={s}>
            <polygon points={rows.map((w) => `${sx(w.w * 7 + 3)},${sy(w.dc + 1.96 * w.se)}`).join(" ") + " " + [...rows].reverse().map((w) => `${sx(w.w * 7 + 3)},${sy(w.dc - 1.96 * w.se)}`).join(" ")} fill={colors[s]} opacity={0.1} />
            <path d={path(pts)} fill="none" stroke={colors[s]} strokeWidth={1.6} />
            <text x={last[0] + 6} y={last[1] + 3} fontSize={9} fill={colors[s]}>{s}</text>
          </g>
        );
      })}
      {[-1, 0, 1].map((y) => <text key={y} x={PL - 4} y={sy(y) + 3} textAnchor="end" fontSize={8} fill={DIM}>{y > 0 ? `+${y}` : y}</text>)}
      {([["Apr", 17], ["May", 47], ["Jun", 78], ["Jul", 108], ["Aug", 139], ["Sep", 170]] as const).map(([m, d]) => <text key={m} x={sx(d)} y={H - 6} textAnchor="middle" fontSize={8} fill={DIM}>{m}</text>)}
      <text x={sx(122)} y={PT + 8} textAnchor="middle" fontSize={8} fill={DIM}>All-Star break</text>
      <line x1={sx(122)} x2={sx(122)} y1={PT + 11} y2={H - PB} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 3" />
    </svg>
  );
}

type Q = { season?: string; lk?: string; ls?: string; la?: string; pk?: string; ps?: string; pa?: string };
type Col = { k: string; label: string; left?: boolean; title?: string };
const LATE_LABEL: Record<string, string> = { FB95: "Fastballs 95+", FB: "All fastballs", FF: "Four-seam", SI: "Sinker", CT: "Cutter", SL: "Slider", SW: "Sweeper", CB: "Curveball", CH: "Changeup", FS: "Splitter" };
const LATE_PLURAL: Record<string, string> = { FB95: "95+ fastballs", FB: "fastballs", FF: "four-seamers", SI: "sinkers", CT: "cutters", SL: "sliders", SW: "sweepers", CB: "curveballs", CH: "changeups", FS: "splitters" };
const TYPE_KEYS = ["FF", "SI", "CT", "SL", "SW", "CB", "CH", "FS"];

/** Rows sorted by any column, both ways (strings A-Z first when ascending; missing values always last). */
function sortRows<T extends Record<string, any>>(rows: T[], k: string, asc: boolean): T[] {
  return [...rows].sort((a, b) => {
    const va = a[k], vb = b[k];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return asc ? c : -c;
  });
}

function SortHead({ cols, sort, asc, href }: { cols: Col[]; sort: string; asc: boolean; href: (k: string, asc: boolean) => string }) {
  return (
    <thead>
      <tr className="text-[9px] uppercase tracking-wider text-text-dim">
        {cols.map((c) => {
          const on = c.k === sort;
          // first click: text columns A-Z, numbers high-to-low; a second click flips
          const next = on ? !asc : c.left === true;
          return (
            <th key={c.k} className={`py-1 font-semibold ${c.left ? "text-left" : "text-right"}`} title={c.title}
              aria-sort={on ? (asc ? "ascending" : "descending") : "none"}>
              <Link href={href(c.k, next)} scroll={false} className={`hover:text-text-primary ${on ? "text-text-primary" : ""}`}>
                {c.label}{on ? (asc ? " ↑" : " ↓") : ""}
              </Link>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

const x3 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(3).replace(/^0/, ""));
const sgn = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);

export default async function DepthPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const season = SEASONS.includes(q.season ?? "") ? q.season! : "2026";
  const [lg, late, pit] = await Promise.all([getContactDepthLeague(), getContactDepthLate(season), getContactDepthPitchers(season)]);
  if (!lg) return <div className="glass-panel p-8 text-center text-sm text-text-dim">Contact depth has not been baked yet (pipeline/contact_depth.py).</div>;
  const state: Required<Q> = {
    season,
    lk: Object.keys(LATE_LABEL).includes(q.lk ?? "") ? q.lk! : "FB95",
    ls: ["name", "n", "late", "nBip", "xw", "ev"].includes(q.ls ?? "") ? q.ls! : "late",
    la: q.la === "0" ? "0" : "1",
    pk: ["all", ...TYPE_KEYS].includes(q.pk ?? "") ? q.pk! : "all",
    ps: ["name", "th", "n", "v", "dc", "rt", "xw", "ev"].includes(q.ps ?? "") ? q.ps! : "dc",
    pa: q.pa === "0" ? "0" : "1",
  };
  const link = (o: Partial<Q>) => `/depth?${new URLSearchParams({ ...state, ...o } as Record<string, string>).toString()}`;
  const lateFloor = ["FB95", "FB", "FF", "SI"].includes(state.lk) ? 40 : 30;
  const lateAll: any[] = (late?.boards?.[state.lk] ?? []).filter((r: any) => r.n >= lateFloor);
  const lateRows = sortRows(lateAll, state.ls, state.la === "1").slice(0, 40);
  const lrel = late?.reliability?.[state.lk];
  const pRows: any[] = (pit?.rows ?? []).map((r: any) => (state.pk === "all" ? r : r.types?.[state.pk] ? { ...r, ...r.types[state.pk] } : null)).filter(Boolean);
  const pitRows = sortRows(pRows, state.ps, state.pa === "1").slice(0, 40);
  const prel = pit?.reliability ?? {};
  const prDc = prel[state.pk === "all" ? "all_dc" : `${state.pk}_dc`], prRt = prel[state.pk === "all" ? "all_rt" : `${state.pk}_rt`];
  const deepest = sortRows(pRows, "dc", true)[0];
  const lateTop = sortRows(lateAll, "late", true)[0];

  const u = lg.ushape;
  const peakBin = u.all.reduce((a: any, b: any) => (b.xw > a.xw ? b : a));
  const fb = lg.velo.FB ?? [];
  const lo = fb.find((p: any) => p.v === 90), hi = fb.find((p: any) => p.v === 98);
  const perMph = lo && hi ? (hi.dc - lo.dc) / 8 : null;
  const monthAll = Object.values<any[]>(lg.month).flat().map((m) => m.dc);
  const monthRange = Math.max(...monthAll.map(Math.abs));
  const gate = lg.gate?.main;
  const chip = (on: boolean) => `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;
  const fact = (label: string, v: string) => (
    <div className="rounded-md border border-white/[0.06] px-3 py-2"><div className="font-data text-sm text-text-primary">{v}</div><div className="text-[10px] text-text-dim">{label}</div></div>
  );
  const sg = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} in.`;
  const lateCols: Col[] = [
    { k: "name", label: "Hitter", left: true }, { k: "n", label: "Contacts" },
    { k: "late", label: "vs league (in.)", title: "his centred depth minus the league's at the same type and velo; − = later" },
    { k: "nBip", label: "In play" }, { k: "xw", label: "xwOBAcon" }, { k: "ev", label: "EV" },
  ];
  const pitCols: Col[] = [
    { k: "name", label: "Pitcher", left: true }, { k: "th", label: "Hand", left: true }, { k: "n", label: "Contacts" }, { k: "v", label: "Velo" },
    { k: "dc", label: "Depth vs norm", title: "mean depth of contact against him vs each hitter's own season mean; − = deeper" },
    { k: "rt", label: "Beyond type + velo", title: "the same, minus the league's depth for that pitch type at that velo" },
    { k: "xw", label: "xwOBAcon" }, { k: "ev", label: "EV" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text-primary">Contact depth</h1>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Where hitters meet the ball, from Statcast bat tracking: the intercept point on {lg.n_contact.toLocaleString()} MLB contacts
        (fouls and balls in play, competitive swings, 2024–26 regular season). Statcast measures depth from the batter, not the plate,
        so stance is in every raw number; the charts below centre each hitter on his own season mean. Whiffs are left out because their
        intercept is a projected crossing point, not contact. Descriptive, not a forecast (RESULTS-MLB §89).
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fact("two strikes vs other counts", sg(lg.two_strike.two - lg.two_strike.other))}
        {fact("inside vs away pitches", sg(lg.loc.inside - lg.loc.away))}
        {fact("low vs high pitches", sg(lg.height.low - lg.height.high))}
        {fact("offspeed vs fastballs", sg(lg.fam.OS - lg.fam.FB))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Fig title={`Damage peaks ${peakBin.bin.replace(" front", "").replace("-", "–")} in. in front of a hitter's normal, then falls off a cliff`}
          n={`${lg.n_bip.toLocaleString()} balls in play · xwOBA on contact by depth bin · all and by pitch family`}
          read={`The inverted U holds for every pitch family and both batter and pitcher hands. A hitter's own peak is not a trait: split halves agree at r ${gate?.r_split} (Spearman-Brown ${gate?.sb}, ${gate?.units} hitters), so the hitter pages show this league shape.`}>
          <UShape u={u} />
        </Fig>
        <Fig title={perMph != null ? `Each mph of fastball velo moves contact ${Math.abs(perMph).toFixed(2)} in. deeper` : "Harder pitches are met deeper"}
          n={`1-mph bins with 300+ contacts · r ${lg.velo_r_bip} between depth and velo on balls in play`}
          read="Fastballs are met deeper than his normal and breaking balls and offspeed further out front, and within every family faster means deeper.">
          <Velo v={lg.velo} />
        </Fig>
      </div>

      <Fig title={`League contact depth holds within ${monthRange.toFixed(1)} in. of normal in every month`}
        n="weekly mean of depth vs each hitter's season mean, 2,000+ contacts per week, 95% bands"
        read="No fatigue drift late in the year and no break effect worth reading: after the All-Star break hitters are about 0.1 in. further out front. Hitter-level drift on the profile pages is his, not the calendar's.">
        <Trend week={lg.week} />
      </Fig>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-dim">Boards season</span>
        {SEASONS.map((y) => <Link key={y} href={link({ season: y })} scroll={false} className={chip(y === season)}>{y}</Link>)}
      </div>

      <section className="glass-panel p-4 overflow-x-auto" id="late">
        <h2 className="text-[13px] font-semibold text-text-primary">
          {lateTop ? `${lateTop.name} meets ${LATE_PLURAL[state.lk]} latest, ${Math.abs(lateTop.late)} in. deeper than the league` : `Who's late on ${LATE_PLURAL[state.lk]}`}
        </h2>
        <div className="my-2 flex flex-wrap items-center gap-1.5">
          {Object.entries(LATE_LABEL).map(([k, l]) => <Link key={k} href={`${link({ lk: k })}#late`} scroll={false} className={chip(k === state.lk)}>{l}</Link>)}
        </div>
        <p className="mb-2 text-[11px] text-text-dim max-w-[90ch]">
          His depth on {LATE_PLURAL[state.lk]} against the league on the same pitch type at the same velocity (1-mph bins),
          after centring on his own normal. Negative = later than hitters usually are. Split halves r {lrel?.split_r} (Spearman-Brown {lrel?.sb},
          {" "}{lrel?.n_split} hitters, 2025), year to year r {lrel?.yoy_r}{lrel?.sb != null && lrel.sb < 0.5 ? ": below .50, so read this type as a description of the season, not a trait" : ""}.
          A style, not a grade: being late can come with damage the other way.
        </p>
        <table className="w-full text-xs font-data">
          <SortHead cols={lateCols} sort={state.ls} asc={state.la === "1"} href={(k, a) => `${link({ ls: k, la: a ? "1" : "0" })}#late`} />
          <tbody>
            {lateRows.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.04]">
                <td className="py-1"><Link prefetch={false} href={`/player/${r.id}`} className="inline-flex items-center gap-1.5 font-sans text-text-secondary hover:underline">{r.tm && <PixelTeamLogo team={r.tm} size={14} />}{r.name}</Link></td>
                <td className="py-1 text-right text-text-dim">{r.n}</td>
                <td className="py-1 text-right text-text-primary">{sgn(r.late)}</td>
                <td className="py-1 text-right text-text-dim">{r.nBip}</td>
                <td className="py-1 text-right">{x3(r.xw)}</td>
                <td className="py-1 text-right">{r.ev ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-text-dim">{lateRows.length} of {lateAll.length} hitters with {lateFloor}+ contacts on {LATE_PLURAL[state.lk]} in {season}, by the current sort.</p>
      </section>

      <section className="glass-panel p-4 overflow-x-auto" id="pitchers">
        <h2 className="text-[13px] font-semibold text-text-primary">
          {deepest ? `${deepest.name} pushes contact deepest${state.pk === "all" ? "" : ` on his ${LATE_PLURAL[state.pk]}`}: ${Math.abs(deepest.dc)} in. behind hitters' normal` : "Pitchers who push contact deepest"}
        </h2>
        <div className="my-2 flex flex-wrap items-center gap-1.5">
          <Link href={`${link({ pk: "all" })}#pitchers`} scroll={false} className={chip(state.pk === "all")}>All pitches</Link>
          {TYPE_KEYS.map((k) => <Link key={k} href={`${link({ pk: k })}#pitchers`} scroll={false} className={chip(k === state.pk)}>{LATE_LABEL[k]}</Link>)}
        </div>
        <p className="mb-2 text-[11px] text-text-dim max-w-[90ch]">
          The pitcher mirror: where hitters (100+ competitive swings) meet the ball against him, against each hitter&apos;s own season
          normal. <strong>Depth vs norm</strong> includes his velocity and mix; <strong>beyond type + velo</strong> subtracts the league&apos;s
          depth for the same pitch type at the same speed, so what remains is the pitch, not the radar gun. Reliability ({season === "2025" ? "this season" : "2025"} split
          halves by alternate games): depth vs norm Spearman-Brown {prDc?.sb ?? "—"} (r {prDc?.split_r ?? "—"}, {prDc?.n_split ?? 0} pitchers),
          beyond type + velo {prRt?.sb ?? "—"}; year to year r {prDc?.yoy_r ?? "—"} / {prRt?.yoy_r ?? "—"}. Stable, but descriptive: deeper contact is
          not by itself weaker contact.
        </p>
        <table className="w-full text-xs font-data">
          <SortHead cols={pitCols} sort={state.ps} asc={state.pa === "1"} href={(k, a) => `${link({ ps: k, pa: a ? "1" : "0" })}#pitchers`} />
          <tbody>
            {pitRows.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.04]">
                <td className="py-1"><Link prefetch={false} href={`/player/${r.id}`} className="inline-flex items-center gap-1.5 font-sans text-text-secondary hover:underline">{r.tm && <PixelTeamLogo team={r.tm} size={14} />}{r.name}</Link></td>
                <td className="py-1 text-text-dim">{r.th}HP</td>
                <td className="py-1 text-right text-text-dim">{r.n}</td>
                <td className="py-1 text-right">{r.v ?? "—"}</td>
                <td className="py-1 text-right text-text-primary">{sgn(r.dc)}</td>
                <td className="py-1 text-right">{sgn(r.rt)}</td>
                <td className="py-1 text-right">{x3(r.xw)}</td>
                <td className="py-1 text-right">{r.ev ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-text-dim">{pitRows.length} of {pRows.length} pitchers with {state.pk === "all" ? "100+ contacts" : `50+ contacts on his ${LATE_PLURAL[state.pk]}`} in {season}, by the current sort.</p>
      </section>
    </div>
  );
}
