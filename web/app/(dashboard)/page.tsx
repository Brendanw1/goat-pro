import Link from "next/link";
import { getPitchers, getHitters, getTicker, getRecentGames, getArsenalPitchType } from "@/lib/data";
import { TickerStrip } from "@/components/ui/ticker-strip";
import { logoUrl } from "@/lib/team-pixel";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";

// Everything here reads R2; the home page renders at request time.
export const dynamic = "force-dynamic";

/**
 * The home page (D-26): the season at a glance. A season selector (default: the newest season baked), the
 * league's pulse vs the season before, the leaders on the validated grades (Whiff+, Prevention+, K+), the
 * biggest Whiff+ risers, Whiff+ by pitch type, a Whiff+ vs Prevention+ map and the hitters' leaders. Leaders
 * respect the gates: only HIGH/MODERATE-confidence grades rank, with the sample floor named on each card.
 */

type Row = Record<string, any>;
const GOOD = "oklch(0.78 0.15 150)", BAD = "oklch(0.68 0.17 25)", LHP = "oklch(0.75 0.12 185)";
const PITCH_TYPES: { code: string; label: string; glow: string }[] = [
  { code: "ff", label: "Four-seam", glow: "fastball" }, { code: "si", label: "Sinker", glow: "sinker" },
  { code: "ct", label: "Cutter", glow: "cutter" }, { code: "sl", label: "Slider", glow: "slider" },
  { code: "cb", label: "Curveball", glow: "curveball" }, { code: "ch", label: "Changeup", glow: "changeup" },
  { code: "fs", label: "Splitter", glow: "changeup" },
];
const dec3 = (v: number) => v.toFixed(3).replace(/^0/, "").replace(/^-0/, "-");
const int = (v: number) => String(Math.round(v));
const top = (rows: Row[], key: string, n = 6, desc = true) =>
  [...rows].filter((r) => typeof r[key] === "number").sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key])).slice(0, n);
const reveal = (i: number) => ({ "--i": i }) as React.CSSProperties;

function Crest({ team }: { team?: string }) {
  const crest = logoUrl(team);
  // eslint-disable-next-line @next/next/no-img-element
  return crest ? <img src={crest} alt="" width={16} height={16} className="rounded shrink-0" /> : <PixelTeamLogo team={team} size={14} />;
}

function SectionTitle({ children, href, note }: { children: React.ReactNode; href?: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-2.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{children}</h2>
      {href ? <Link href={href} className="text-[10px] text-text-dim hover:text-text-secondary">full board →</Link>
        : note ? <span className="text-[10px] text-text-dim">{note}</span> : null}
    </div>
  );
}

/** Ranked list with a bar per row, scaled from the list's last row to its leader. */
function Leaders({ title, rows, metric, fmt, href, note, season, i, sub }: {
  title: string; rows: Row[]; metric: string; fmt: (v: number) => string; href: string; note: string; season: number;
  i: number; sub?: (r: Row) => React.ReactNode;
}) {
  const vals = rows.map((r) => r[metric] as number);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  return (
    <div className="glass-panel p-4 home-reveal" style={reveal(i)}>
      <SectionTitle href={href}>{title}</SectionTitle>
      <ol className="space-y-1.5">
        {rows.map((r, k) => (
          <li key={`${r.id}-${r.season}`} className="grid grid-cols-[14px_16px_1fr_auto] items-center gap-2 text-xs">
            <span className="text-[10px] font-data text-text-dim text-right">{k + 1}</span>
            <Crest team={r.team} />
            <div className="min-w-0">
              <Link prefetch={false} href={`/player/${r.id}?season=${season}`} className="block truncate text-text-primary hover:underline">{r.name ?? r.id}</Link>
              <div className="mt-0.5 h-[3px] rounded-full bg-white/[0.05]">
                <div className="h-full rounded-full bg-usf-gold/70"
                  style={{ width: `${hi > lo ? 25 + (75 * (r[metric] - lo)) / (hi - lo) : 100}%` }} />
              </div>
            </div>
            <span className="text-right">
              <span className="font-data font-medium text-text-primary">{fmt(r[metric])}</span>
              {sub && <span className="block text-[9px] text-text-dim font-data">{sub(r)}</span>}
            </span>
          </li>
        ))}
        {!rows.length && <li className="text-[11px] text-text-dim">Not enough qualified players yet.</li>}
      </ol>
      <p className="text-[9px] text-text-dim mt-2.5 leading-[1.5]">{note}</p>
    </div>
  );
}

/** League pulse: BF/swing/pitch-weighted league rates for the season, pitcher view. */
function pulse(rows: Row[]) {
  const w = (val: string, wt: string) => {
    let s = 0, n = 0;
    for (const r of rows) if (typeof r[val] === "number" && typeof r[wt] === "number") { s += r[val] * r[wt]; n += r[wt]; }
    return n ? s / n : null;
  };
  return { k: w("kPct", "battersFaced"), bb: w("bbPct", "battersFaced"), whiff: w("whiffPct", "nSwings"),
    xwoba: w("xwobaAg", "battersFaced"), velo: w("velo", "pitches"), chase: w("chasePct", "nOozPitches") };
}

function Pulse({ cur, prev, season, who }: { cur: ReturnType<typeof pulse>; prev: ReturnType<typeof pulse> | null; season: number; who: string }) {
  const items: { label: string; v: number | null; p: number | null; fmt: (v: number) => string; d: number }[] = [
    { label: "K%", v: cur.k, p: prev?.k ?? null, fmt: (v) => v.toFixed(1) + "%", d: 1 },
    { label: "BB%", v: cur.bb, p: prev?.bb ?? null, fmt: (v) => v.toFixed(1) + "%", d: 1 },
    { label: "Whiff%", v: cur.whiff, p: prev?.whiff ?? null, fmt: (v) => v.toFixed(1) + "%", d: 1 },
    { label: "Chase%", v: cur.chase, p: prev?.chase ?? null, fmt: (v) => v.toFixed(1) + "%", d: 1 },
    { label: "Fastball velo", v: cur.velo, p: prev?.velo ?? null, fmt: (v) => v.toFixed(1), d: 1 },
    { label: "xwOBA", v: cur.xwoba, p: prev?.xwoba ?? null, fmt: dec3, d: 3 },
  ];
  return (
    <div className="glass-panel p-4 home-reveal" style={reveal(1)}>
      <SectionTitle note={prev ? `change vs ${season - 1}` : `first season on the site`}>League pulse · {season} · {who}</SectionTitle>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {items.map((it) => {
          const delta = it.v != null && it.p != null ? it.v - it.p : null;
          const shown = delta != null && Math.abs(delta) >= Math.pow(10, -it.d) / 2;
          return (
            <div key={it.label}>
              <p className="text-[10px] text-text-dim">{it.label}</p>
              <p className="font-data text-xl font-semibold text-text-primary leading-tight">{it.v != null ? it.fmt(it.v) : "—"}</p>
              {delta != null && (
                <p className="font-data text-[10px] text-text-secondary">
                  {shown ? (delta > 0 ? "▲ " : "▼ ") : "• "}
                  {it.d === 3 ? dec3(Math.abs(delta)) : Math.abs(delta).toFixed(1)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Greedy label placement: right of the dot, else left, else nudged down/up; ~5.3 px per character at 9.5 px. */
function placeLabels(ls: { id: string; x: number; y: number; t: string }[]) {
  const boxes: [number, number, number, number][] = [];
  const hit = (b: [number, number, number, number]) => boxes.some((o) => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3]);
  return [...ls].sort((a, b) => a.y - b.y).map((l) => {
    const w = l.t.length * 5.3;
    for (const [dx, dy, anchor] of [[6, 3, "start"], [-6, 3, "end"], [6, 13, "start"], [6, -7, "start"], [-6, 13, "end"]] as const) {
      const x0 = anchor === "start" ? l.x + dx : l.x + dx - w;
      const b: [number, number, number, number] = [x0, l.y + dy - 9, x0 + w, l.y + dy + 2];
      if (!hit(b)) { boxes.push(b); return { ...l, lx: l.x + dx, ly: l.y + dy, anchor }; }
    }
    return { ...l, lx: l.x + 6, ly: l.y + 3, anchor: "start" as const };
  });
}

/** Whiff+ (shape → bat-missing) vs Prevention+ (next-season run prevention) for qualified pitchers. */
function StuffMap({ rows, season, minIP }: { rows: Row[]; season: number; minIP: number }) {
  const W = 640, H = 340, L = 40, R = 14, T = 14, B = 30;
  const pts = rows.filter((r) => typeof r.stuffPlus === "number" && typeof r.preventionPlus === "number");
  if (pts.length < 20) return null;
  const xs = pts.map((r) => r.stuffPlus), ys = pts.map((r) => r.preventionPlus);
  const pad = (a: number[]) => [Math.min(75, Math.min(...a) - 3), Math.max(125, Math.max(...a) + 3)];
  const [x0, x1] = pad(xs), [y0, y1] = pad(ys);
  const x = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const cov = pts.reduce((s, r) => s + (r.stuffPlus - mx) * (r.preventionPlus - my), 0);
  const rr = cov / Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0) * ys.reduce((s, v) => s + (v - my) ** 2, 0));
  const label = new Set([...top(pts, "preventionPlus", 5), ...top(pts, "stuffPlus", 3)].map((r) => r.id));
  const grid = [70, 80, 90, 100, 110, 120, 130, 140];
  return (
    <div className="glass-panel p-4 home-reveal lg:col-span-2" data-glow="gold" style={reveal(5)}>
      <SectionTitle note={`${pts.length} pitchers, ${minIP}+ IP · r ${rr.toFixed(2)}`}>Stuff vs run prevention</SectionTitle>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Whiff+ against Prevention+ for ${pts.length} qualified pitchers in ${season}`}>
        <defs>
          <radialGradient id="home-elite" cx="100%" cy="0%" r="75%">
            <stop offset="0%" stopColor="var(--color-usf-gold)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--color-usf-gold)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={x(100)} y={T} width={W - R - x(100)} height={y(100) - T} fill="url(#home-elite)" />
        {grid.filter((v) => v > x0 && v < x1).map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} stroke={v === 100 ? "#ffffff30" : "#ffffff0d"} />
            <text x={x(v)} y={H - B + 14} fontSize="10" textAnchor="middle" fill="var(--color-text-dim)">{v}</text>
          </g>
        ))}
        {grid.filter((v) => v > y0 && v < y1).map((v) => (
          <g key={`y${v}`}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 100 ? "#ffffff30" : "#ffffff0d"} />
            <text x={L - 6} y={y(v) + 3} fontSize="10" textAnchor="end" fill="var(--color-text-dim)">{v}</text>
          </g>
        ))}
        <text x={W - R} y={H - 4} fontSize="10" textAnchor="end" fill="var(--color-text-secondary)">Whiff+ →</text>
        <text x={L + 4} y={T + 10} fontSize="10" fill="var(--color-text-secondary)">↑ Prevention+</text>
        <text x={W - R - 6} y={T + 12} fontSize="9" textAnchor="end" fill="var(--color-usf-gold)" opacity="0.85">nasty and effective</text>
        {pts.map((r) => (
          <a key={r.id} href={`/player/${r.id}?season=${season}`}>
            <circle cx={x(r.stuffPlus)} cy={y(r.preventionPlus)} r={label.has(r.id) ? 4.2 : 2.6}
              fill={r.throws === "L" ? LHP : "var(--color-usf-gold)"} fillOpacity={label.has(r.id) ? 0.95 : 0.42}
              stroke={label.has(r.id) ? "#000a" : "none"}>
              <title>{`${r.name} (${r.team ?? ""}) · Whiff+ ${Math.round(r.stuffPlus)} · Prevention+ ${Math.round(r.preventionPlus)}`}</title>
            </circle>
          </a>
        ))}
        {placeLabels(pts.filter((r) => label.has(r.id)).map((r) => ({
          id: r.id, x: x(r.stuffPlus), y: y(r.preventionPlus), t: String(r.name ?? "").split(" ").slice(-1)[0] }))).map((l) => (
          <text key={`l${l.id}`} x={l.lx} y={l.ly} textAnchor={l.anchor} fontSize="9.5" fill="var(--color-text-primary)"
            paintOrder="stroke" stroke="#000a" strokeWidth="3">{l.t}</text>
        ))}
      </svg>
      <p className="text-[10px] text-text-dim mt-1 leading-[1.5]">
        <span style={{ color: "var(--color-usf-gold)" }}>●</span> RHP <span className="ml-2" style={{ color: LHP }}>●</span> LHP.
        Whiff+ grades the pitches&apos; shape for missing bats; Prevention+ projects next season&apos;s run prevention from strikeouts,
        walks, grounders and Whiff+. Hover a dot for the line; click it for the profile.
      </p>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ season?: string; role?: string }> }) {
  const sp = await searchParams;
  const [pitchers, hitters, ticker, recent, ...types] = await Promise.all([
    getPitchers(), getHitters(), getTicker(), getRecentGames(), ...PITCH_TYPES.map((t) => getArsenalPitchType(t.code)),
  ]);
  const seasons = [...new Set((pitchers ?? []).map((r: Row) => r.season as number))].sort((a, b) => b - a);
  const season = seasons.includes(Number(sp.season)) ? Number(sp.season) : seasons[0] ?? new Date().getFullYear();
  const latest = season === seasons[0];
  // Pitcher sections split by season role (SP = GS at least half of G, official lines); the IP floor follows the role.
  const role = sp.role === "RP" ? "RP" : "SP";
  const minIP = role === "SP" ? 40 : 20;
  const roleName = role === "SP" ? "starters" : "relievers";
  const qs = (s: number, r: string) => { const q = [s !== seasons[0] && `season=${s}`, r !== "SP" && `role=${r}`].filter(Boolean).join("&"); return q ? `/?${q}` : "/"; };
  const hname = new Map((hitters ?? []).map((r: Row) => [String(r.id), r.name]));
  if (ticker?.hitting) ticker.hitting = ticker.hitting.map((h: Row) => ({ ...h, n: h.n ?? hname.get(String(h.id)) }));

  const Pall = (pitchers ?? []).filter((r: Row) => r.season === season);
  const P = Pall.filter((r: Row) => r.role === role);
  const Pprev = (pitchers ?? []).filter((r: Row) => r.season === season - 1 && r.role === role);
  const roleIds = new Set(P.map((r: Row) => String(r.id)));
  const H = (hitters ?? []).filter((r: Row) => r.season === season);
  const qual = (r: Row) => r.confidence === "HIGH" || r.confidence === "MODERATE";
  const whiffRows = P.filter(qual);
  const ip40 = P.filter((r: Row) => (r.ip ?? 0) >= minIP);
  const prev = new Map(Pprev.filter(qual).map((r: Row) => [r.id, r]));
  const risers = whiffRows.filter((r: Row) => typeof r.stuffPlus === "number" && typeof prev.get(r.id)?.stuffPlus === "number")
    .map((r: Row) => ({ ...r, dWhiff: r.stuffPlus - prev.get(r.id)!.stuffPlus, wasWhiff: prev.get(r.id)!.stuffPlus }));
  const hq = H.filter((r: Row) => (r.pa ?? 0) >= 200);
  const games = (recent?.games ?? []).slice(0, 8);
  const byType = PITCH_TYPES.map((t, k) => ({
    ...t, rows: top(((types[k] as Row[]) ?? []).filter((r) => r.season === season && qual(r) && roleIds.has(String(r.id))), "stuffPlus", 3),
  })).filter((t) => t.rows.length);

  return (
    <div className="space-y-5">
      <h1 className="sr-only">GOAT-Pro</h1>
      <header className="home-reveal flex flex-wrap items-end justify-between gap-3" style={reveal(0)}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-usf-gold">GOAT-Pro</p>
          <p className="text-2xl font-black tracking-tight text-text-primary">The {season} season, measured.</p>
          <p className="text-[11px] text-text-dim mt-0.5">
            MLB + AAA from public Statcast data. Validated grades say so; everything else is labelled descriptive.
          </p>
        </div>
        <nav aria-label="Season" className="flex flex-wrap gap-1">
          {seasons.map((s) => (
            <Link key={s} href={qs(s, role)} scroll={false} aria-current={s === season ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 font-data text-xs transition-colors ${s === season
                ? "bg-usf-gold/15 text-usf-gold border border-usf-gold/40"
                : "border border-border-subtle text-text-dim hover:text-text-secondary hover:bg-white/[0.04]"}`}>
              {s}
            </Link>
          ))}
        </nav>
      </header>
      <nav aria-label="Pitcher role" className="home-reveal flex items-center gap-1" style={reveal(1)}>
        <span className="mr-1 text-[10px] uppercase tracking-wider text-text-dim">Pitchers</span>
        {(["SP", "RP"] as const).map((r) => (
          <Link key={r} href={qs(season, r)} scroll={false} aria-current={r === role ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${r === role
              ? "bg-usf-green/20 text-text-primary border border-usf-green/50"
              : "border border-border-subtle text-text-dim hover:text-text-secondary hover:bg-white/[0.04]"}`}>
            {r === "SP" ? "Starters" : "Relievers"}
          </Link>
        ))}
      </nav>

      {latest && <div className="home-reveal" style={reveal(1)}><TickerStrip ticker={ticker} /></div>}

      <Pulse cur={pulse(P)} prev={Pprev.length ? pulse(Pprev) : null} season={season} who={roleName} />

      <div className="grid gap-4 md:grid-cols-3">
        <Leaders i={2} season={season} title={`Whiff+ leaders, ${roleName}`} rows={top(whiffRows, "stuffPlus")} metric="stuffPlus" fmt={int}
          href={`/pitchers?season=${season}&role=${role}`} note="Shape → bat-missing. HIGH/MODERATE confidence only. Validated (RESULTS-MLB §45-49, §82)." />
        <Leaders i={3} season={season} title={`Prevention+ leaders, ${roleName}`} rows={top(ip40, "preventionPlus")} metric="preventionPlus" fmt={int}
          href={`/pitchers?season=${season}&role=${role}&sort=preventionPlus`} note={`Next season's run prevention, projected from this one. ${minIP}+ IP. Confirmed (§52).`} />
        <Leaders i={4} season={season} title={`K+ leaders, ${roleName}`} rows={top(ip40, "kPlus")} metric="kPlus" fmt={int}
          href={`/pitchers?season=${season}&role=${role}&sort=kPlus`} sub={(r) => (typeof r.kProj === "number" ? `proj K% ${(100 * r.kProj).toFixed(1)}` : null)}
          note={`Next season's strikeout rate, projected. ${minIP}+ IP. Confirmed (§50).`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StuffMap rows={ip40.filter(qual)} season={season} minIP={minIP} />
        <div className="space-y-4">
          {risers.length ? (<>
            <Leaders i={6} season={season} title={`Whiff+ risers vs ${season - 1}, ${roleName}`} rows={top(risers, "dWhiff", 5)} metric="dWhiff"
              fmt={(v) => `+${Math.round(v)}`} href={`/pitchers?season=${season}&role=${role}`} sub={(r) => `${Math.round(r.wasWhiff)} → ${Math.round(r.stuffPlus)}`}
              note="Biggest Whiff+ gains on last season, both seasons HIGH/MODERATE confidence. New pitches, shape changes and role changes all land here." />
            <Leaders i={7} season={season} title={`Whiff+ fallers vs ${season - 1}, ${roleName}`} rows={top(risers.map((r: Row) => ({ ...r, dDrop: -r.dWhiff })), "dDrop", 5)} metric="dDrop"
              fmt={(v) => `−${Math.round(v)}`} href={`/pitchers?season=${season}&role=${role}`} sub={(r) => `${Math.round(r.wasWhiff)} → ${Math.round(r.stuffPlus)}`}
              note="Biggest Whiff+ drops on last season, same rules. Descriptive model change, not a forecast." />
          </>) : (
            <div className="glass-panel p-4 home-reveal text-[11px] text-text-dim" style={reveal(6)}>
              Season movers need the season before; the site&apos;s grades start in {seasons[seasons.length - 1]}.
            </div>
          )}
        </div>
      </div>

      {byType.length > 0 && (
        <section className="home-reveal" style={reveal(7)}>
          <SectionTitle note="best grade per pitch type, HIGH/MODERATE confidence">Whiff+ by pitch · {season}</SectionTitle>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            {byType.map((t) => (
              <Link key={t.code} href={`/arsenal/${t.code}`} className="glass-panel p-3 hover:bg-white/[0.03] transition-colors" data-glow={t.glow}>
                <p className="text-[10px] uppercase tracking-wider text-text-dim">{t.label}</p>
                <p className="font-data text-2xl font-bold text-text-primary leading-tight">{Math.round(t.rows[0].stuffPlus)}</p>
                <p className="truncate text-[11px] text-text-secondary">{t.rows[0].name}</p>
                <ul className="mt-1.5 space-y-0.5 border-t border-border-subtle pt-1.5">
                  {t.rows.slice(1).map((r: Row) => (
                    <li key={r.id} className="flex justify-between gap-1 text-[10px] text-text-dim">
                      <span className="truncate">{r.name}</span><span className="font-data">{Math.round(r.stuffPlus)}</span>
                    </li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Leaders i={8} season={season} title="Hitters by xwOBA" rows={top(hq, "xwoba")} metric="xwoba" fmt={dec3}
          href={`/hitters?season=${season}&sort=xwoba`} sub={(r) => (typeof r.woba === "number" ? `wOBA ${dec3(r.woba)}` : null)}
          note="200+ PA. Statcast's expected wOBA from contact quality, walks and strikeouts." />
        <Leaders i={9} season={season} title="Decision+ leaders" rows={top(hq, "decisionPlus")} metric="decisionPlus" fmt={int}
          href={`/hitters?season=${season}&sort=decisionPlus`} note="200+ PA. Swing/take run value per pitch vs an average decision; 100 = average." />
        <Leaders i={10} season={season} title="Barrel% leaders" rows={top(hq, "barrelPct")} metric="barrelPct" fmt={(v) => v.toFixed(1) + "%"}
          href={`/hitters?season=${season}&sort=barrelPct`} sub={(r) => (typeof r.ev90 === "number" ? `EV90 ${r.ev90.toFixed(1)}` : null)}
          note="200+ PA. Savant barrels per batted ball." />
      </div>

      {latest && (
        <section className="glass-panel p-4 home-reveal" style={reveal(11)}>
          <SectionTitle note={games[0]?.d ?? ""}>Latest game reports</SectionTitle>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {games.map((g: any) => {
              const [hs, as_] = Array.isArray(g.final) ? g.final : [0, 0];
              return (
                <Link key={g.g} href={`/games/${g.g}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs hover:bg-white/[0.04]">
                  <span className="truncate text-text-secondary">
                    {g.away} <span className={`font-data ${as_ > hs ? "text-text-primary font-medium" : ""}`}>{as_}</span>
                    {" @ "}{g.home} <span className={`font-data ${hs > as_ ? "text-text-primary font-medium" : ""}`}>{hs}</span>
                  </span>
                  <span className="text-[10px] text-text-dim">report →</span>
                </Link>
              );
            })}
            {!games.length && <p className="text-[11px] text-text-dim">No recent games baked.</p>}
          </div>
        </section>
      )}

      <section className="home-reveal" style={reveal(12)}>
        <SectionTitle>Explore</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          {[
            { href: `/pitchers?season=${season}`, label: "Pitcher board", read: "Whiff+, K+, Prevention+, Control+, Tunnel+ and the measured lines for every pitcher-season." },
            { href: `/hitters?season=${season}`, label: "Hitter board", read: "Contact quality, swing decisions, bat tracking and the projections." },
            { href: "/reports/projections", label: "Projections", read: "Next-season skill forecasts with their measured bands: Prevention+, K/PA and RV/100 for arms, Marcel wOBA for bats." },
            { href: "/arsenal", label: "Arsenal", read: "Every pitch type graded, with shape, usage and the mix board." },
            { href: "/tunneling", label: "Tunneling", read: "Tunnel+: which pitch pairs look alike long enough to win swings." },
            { href: "/minors?src=sc", label: "Minors", read: "AAA from 2023 on the same models, labelled MLB model on AAA data." },
            { href: "/prospects", label: "Prospects", read: "MLB Pipeline rankings back to 2011, linked to every profile." },
            { href: "/teams", label: "Teams", read: "Staff and lineup aggregates, rotation vs bullpen, park factors." },
            { href: "/glossary", label: "Glossary", read: "Every number on the site: what it means, how it was built, how far to trust it." },
          ].map((c) => (
            <Link key={c.href} href={c.href} className="glass-panel p-4 hover:bg-white/[0.03] transition-colors">
              <p className="font-medium text-text-primary mb-1">{c.label} <span className="text-text-dim">→</span></p>
              <p className="text-[11px] text-text-dim leading-[1.5]">{c.read}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
