"use client";

/**
 * The hitter's spray chart: every ball in play from behind home plate — third-base side left, first-base
 * side right. Statcast hit coordinates are centred in the bake (x - 125.42, 198.27 - y) and are in
 * sensor units of ~2.5 ft (checked: median home run = 399 ft), so the field is drawn to scale in feet:
 * 90-ft diamond, mound at 60.5 ft, infield dirt = the 95-ft arc around the mound, a generic smooth fence
 * (330 ft at the lines, ~383 in the gaps, 400 to centre) with a 15-ft warning track. Dots are tinted by exit velocity;
 * home runs are ringed. Direction splits use thirds of fair territory (|angle| < 15° = centre). The
 * league line is his hand's average spray angle that season. Each ball carries the side he batted from (`s`),
 * so a switch hitter's pull / oppo is counted per ball and he can be filtered to one side. Colour modes
 * (D-27 spray explorer): exit velocity, result, hit chance and pitch type. Hit chance is Savant's own
 * per-ball estimated BA off exit velo + launch angle — the one value overlay the parity matrix sanctions
 * here; per-ball xwOBA of ours stays out (§68/§77: spray makes it more descriptive, less predictive).
 * Balls also carry the pitch type (`pt`), the pitcher's hand (`ph`) and Savant's per-ball estimates
 * (`ba`/`w`, x1000), so the view filters by what was thrown and recomputes over the filter.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PITCH_CONFIG } from "@/lib/constants";

interface Ball { x: number; y: number; ev: number | null; la: number | null; e: string | null; t: string | null; s?: "L" | "R" | null; d?: string | null; pt?: string | null; ph?: string | null; ba?: number | null; w?: number | null }

const FT = 2.5;           // feet per Statcast hit-coordinate unit
const MAX_FT = 470;       // chart radius: room for home runs past the fence
const W = 440, H = 334, CX = W / 2, CY = H - 16, R = 310;
const HITS = new Set(["single", "double", "triple", "home_run"]);
const TYPES: [string, string][] = [["all", "All"], ["ground_ball", "GB"], ["line_drive", "LD"], ["fly_ball", "FB"], ["popup", "PU"]];
const RESULTS: [string, string][] = [["all", "All"], ["hits", "Hits"], ["outs", "Outs"]];
const EV_BANDS: [number, string, string][] = [[105, "#f5b83d", "105+"], [95, "#e87722", "95–105"], [85, "#7aa5d8", "85–95"], [-1, "#5b6472", "<85"]];
/** Hit chance (Savant's per-ball estimated BA, x1000 in the file). */
const HC_BANDS: [number, string, string][] = [[350, "#f5b83d", ".35+"], [250, "#4fd1c5", ".25–.35"], [150, "#7aa5d8", ".15–.25"], [-1, "#5b6472", "<.15"]];
const GREY = "#8b93a3";
type By = "ev" | "result" | "hc" | "pitch";
const BY_LABEL: Record<By, string> = { ev: "Exit velo", result: "Result", hc: "Hit chance", pitch: "Pitch type" };
const pitchColor = (pt: string | null) => (pt ? PITCH_CONFIG[pt as keyof typeof PITCH_CONFIG]?.color ?? GREY : GREY);

/** feet + spray angle (deg, + = first-base side) -> svg point */
function pt(ft: number, deg: number): [number, number] {
  const r = (Math.min(ft, MAX_FT) / MAX_FT) * R, a = (deg * Math.PI) / 180;
  // rounded: Node and the browser differ in the last digits of sin/cos, which breaks hydration
  return [Math.round((CX + Math.sin(a) * r) * 10) / 10, Math.round((CY - Math.cos(a) * r) * 10) / 10];
}
const fence = (deg: number) => 400 - 70 * (deg / 45) ** 2;
/** a field point given in feet (x toward first base, y toward centre field) */
const at = (x: number, y: number) => pt(Math.hypot(x, y), (Math.atan2(x, y) * 180) / Math.PI);
/** the infield dirt edge: where a ray from home at `deg` meets the 95-ft circle around the mound */
const dirt = (deg: number) => { const c = Math.cos((deg * Math.PI) / 180); return 60.5 * c + Math.sqrt(95 ** 2 - (60.5 * Math.sin((deg * Math.PI) / 180)) ** 2); };
const GRASS = "rgba(74,140,84,0.16)", SKIN = "rgba(176,128,82,0.20)", LINE = "rgba(255,255,255,0.32)";
const evColor = (ev: number | null) => (ev == null ? "#8b93a3" : EV_BANDS.find(([lo]) => ev >= lo)![1]);
const RESULT_COLORS: [string, string, string][] = [["single", "#7aa5d8", "1B"], ["double", "#4fd1c5", "2B"], ["triple", "#f5b83d", "3B"], ["home_run", "#e87722", "HR"], ["out", "#5b6472", "Out"]];
const resultColor = (e: string | null) => (RESULT_COLORS.find(([k]) => k === e) ?? RESULT_COLORS[4])[1];
const TILT = 46, PERSPECTIVE = 760; // the field's CSS tilt; the flight canvas projects with the same numbers
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (d?: string) => (d ? `${MONTHS[Number(d.slice(0, 2)) - 1]} ${Number(d.slice(3))}` : "");

type Flight = { sx: number; sy: number; ft: number; la: number | null; e: string | null; ev: number | null; d?: string | null; pt?: string | null; ba?: number | null };

/**
 * Season replay: each ball in play flies from home plate to where it was fielded, in game order.
 * Canvas in screen space (the field SVG is CSS-tilted; points are projected with the same rotateX +
 * perspective so the arcs rise vertically above the tilted field). Finished flights are painted once
 * onto an offscreen trail canvas, so a frame costs one blit plus the few balls in the air.
 * Apex height is a parabola at ~2x the drag-free d * tan(LA) / 4 (shape only, not a measured trajectory).
 */
function FlightCanvas({ balls, by, playing, speed, onDate, onDone }: {
  balls: Flight[]; by: By; playing: boolean; speed: number;
  onDate: (d: string) => void; onDone: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ t: 0, last: 0, painted: 0, trail: null as HTMLCanvasElement | null, date: "", dirty: true });
  const live = useRef({ playing, speed, onDate, onDone, by });
  live.current = { playing, speed, onDate, onDone, by };
  // colour switch: repaint the finished flights in the new colours, keep the replay where it is
  useEffect(() => {
    const s = st.current;
    if (!s.trail) return;
    s.trail.getContext("2d")!.clearRect(0, 0, s.trail.width, s.trail.height);
    s.painted = 0; s.dirty = true;
  }, [by]);

  useEffect(() => {
    const cv = ref.current!;
    const host = cv.parentElement!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const GAP = 140, FLY = 900; // ms between launches, ms in the air (at 1x)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = st.current;
    s.t = reduce ? Infinity : 0; s.last = 0; s.painted = 0; s.date = "";
    let raf = 0, w = 0, h = 0, ext = 0;
    const th = (TILT * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    // svg point + height (ft) -> canvas px, matching `perspective(760px) rotateX(46deg)`, origin 50% 100%
    const proj = (x: number, y: number, zFt: number): [number, number] => {
      const k = w / W, X = x * k - w / 2, Y = y * k - h, Z = zFt * (R / MAX_FT) * k;
      const y1 = Y * cos - Z * sin, z1 = Y * sin + Z * cos, sc = PERSPECTIVE / (PERSPECTIVE - z1);
      return [w / 2 + X * sc, ext + h / 2 + (h / 2 + y1) * sc];
    };
    // apex ~ 2 x the drag-free d*tan(LA)/4: drag makes real flies peak higher for their carry (a 400-ft,
    // 28-degree home run tops out near 110 ft); ground balls (LA <= 8) stay on the grass
    const apex = (b: Flight) => (b.la == null || b.la <= 8 ? 0 : Math.min(190, (b.ft * Math.tan((Math.min(b.la, 70) * Math.PI) / 180)) / 2));
    const color = (b: Flight & { pt?: string | null; ba?: number | null }) =>
      live.current.by === "result" ? resultColor(b.e)
      : live.current.by === "hc" ? (b.ba == null ? GREY : HC_BANDS.find(([lo]) => b.ba! >= lo)![1])
      : live.current.by === "pitch" ? pitchColor(b.pt ?? null)
      : evColor(b.ev);
    const path = (c: CanvasRenderingContext2D, b: Flight, upto: number) => {
      const a = apex(b), n = Math.max(2, Math.round(24 * upto));
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * upto, [px, py] = proj(CX + (b.sx - CX) * u, CY + (b.sy - CY) * u, 4 * a * u * (1 - u));
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      return proj(CX + (b.sx - CX) * upto, CY + (b.sy - CY) * upto, 4 * a * upto * (1 - upto));
    };
    const paintDone = (b: Flight) => {
      const c = s.trail!.getContext("2d")!;
      c.globalAlpha = 0.34; c.lineWidth = 1; c.strokeStyle = color(b); c.lineWidth = 1;
      path(c, b, 1); c.stroke();
      const [lx, ly] = proj(b.sx, b.sy, 0);
      c.globalAlpha = 0.9; c.fillStyle = color(b); c.beginPath(); c.arc(lx, ly, b.e === "home_run" ? 2.6 : 1.9, 0, 6.283); c.fill();
    };
    const size = () => {
      w = host.clientWidth; h = (w * H) / W; ext = h * 0.55;
      cv.width = Math.round(w * dpr); cv.height = Math.round((h + ext) * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h + ext}px`; cv.style.top = `${-ext}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.trail = document.createElement("canvas");
      s.trail.width = cv.width; s.trail.height = cv.height;
      s.trail.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.painted = 0; s.dirty = true; // repaint finished flights at the new size
    };
    const frame = (now: number) => {
      const L = live.current;
      if (s.last && L.playing) s.t += (now - s.last) * L.speed;
      s.last = now;
      const done = Math.min(balls.length, Math.max(0, Math.floor((s.t - FLY) / GAP) + 1));
      // idle (paused or finished, nothing to repaint): keep the loop alive but draw nothing
      if (!(L.playing || s.painted < done || s.dirty)) { raf = requestAnimationFrame(frame); return; }
      s.dirty = false;
      while (s.painted < done) paintDone(balls[s.painted++]);
      ctx.clearRect(0, 0, w, h + ext);
      ctx.drawImage(s.trail!, 0, 0, w, h + ext);
      const first = Math.max(0, Math.floor((s.t - FLY) / GAP) + 1), lastIdx = Math.min(balls.length - 1, Math.floor(s.t / GAP));
      for (let i = first; i <= lastIdx; i++) {
        const b = balls[i], u = Math.min(1, (s.t - i * GAP) / FLY);
        ctx.globalAlpha = 0.95; ctx.strokeStyle = color(b); ctx.lineWidth = 1.6;
        const [hx, hy] = path(ctx, b, u); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(hx, hy, 2.2, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const d = balls[Math.min(Math.max(lastIdx, 0), balls.length - 1)]?.d ?? "";
      if (d !== s.date) { s.date = d; L.onDate(d); } // React re-renders on a new date only, not per frame
      if (done >= balls.length && L.playing) L.onDone();
      raf = requestAnimationFrame(frame);
    };
    size();
    const ro = new ResizeObserver(() => { size(); });
    ro.observe(host);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [balls]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute left-0" />;
}
const chip = (on: boolean) =>
  `rounded-md border px-2 py-0.5 ${on ? "border-usf-green/30 bg-usf-green/20 text-usf-gold" : "border-border-subtle text-text-secondary"}`;
const poly = (p: [number, number][]) => p.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");

export function SprayPanel({ data, refs, season, bats }: {
  data: any | null;
  refs: any | null;
  season?: number;
  bats?: string | null;
}) {
  const [type, setType] = useState("all");
  const [res, setRes] = useState("all");
  const [side, setSide] = useState("all");
  const [fpt, setFpt] = useState("all");
  const [lhp, setLhp] = useState("all");
  const [by, setBy] = useState<By>("ev");
  const [bigEv, setBigEv] = useState(false);
  const [view, setView] = useState<"dots" | "flight">("dots");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [run, setRun] = useState(0); // bump to restart the replay
  const [date, setDate] = useState("");
  const [finished, setFinished] = useState(false);
  const balls: Ball[] = data?.balls ?? [];
  const ptTypes = useMemo(() => {
    const s = new Set(balls.map((b) => b.pt ?? (b.pt === null ? "other" : null)).filter((t): t is string => !!t));
    return s.size ? s : null;
  }, [balls]);
  const handsPresent = useMemo(() => new Set(balls.map((b) => b.ph).filter(Boolean)), [balls]);
  const ptOf = (b: Ball) => b.pt ?? (b.pt === null ? "other" : null);

  const all = useMemo(() => balls
    .filter((b) => typeof b.x === "number" && typeof b.y === "number" && (b.x !== 0 || b.y !== 0))
    .map((b) => {
      const ft = Math.hypot(b.x, b.y) * FT, ang = (Math.atan2(b.x, b.y) * 180) / Math.PI;
      const [sx, sy] = pt(ft, ang);
      const s = b.s ?? (bats === "L" || bats === "R" ? bats : null);
      return { ...b, ft, ang, sx, sy, s, hit: HITS.has(b.e ?? "") };
    }), [balls, bats]);
  const switcher = all.some((b) => b.s === "L") && all.some((b) => b.s === "R");
  const shown = all.filter((b) => (type === "all" || b.t === type) && (res === "all" || (res === "hits") === b.hit)
    && (side === "all" || b.s === side)
    && (fpt === "all" || ptOf(b) === fpt)
    && (lhp === "all" || b.ph === lhp));
  const dotColor = (b: (typeof all)[number]) =>
    by === "result" ? resultColor(b.e)
    : by === "hc" ? (b.ba == null ? GREY : HC_BANDS.find(([lo]) => b.ba! >= lo)![1])
    : by === "pitch" ? pitchColor(ptOf(b))
    : evColor(b.ev);
  const dotR = (b: (typeof all)[number]) =>
    bigEv && b.ev != null ? 2 + Math.max(0, Math.min(1, (b.ev - 60) / 50)) * 4.5
    : b.e === "home_run" ? 3.6 : 2.8;
  // The filter recomputes (old explorer's side panel): rates over the shown balls only.
  const rd = useMemo(() => {
    const n = shown.length;
    const hits = shown.filter((b) => b.hit).length;
    const ev = shown.filter((b) => b.ev != null);
    const la = shown.filter((b) => b.la != null);
    const ba = shown.filter((b) => b.ba != null);
    const w = shown.filter((b) => b.w != null);
    const avg = (arr: (typeof shown)[number][], k: "ev" | "la" | "ba" | "w") =>
      arr.length ? arr.reduce((s, b) => s + (b[k] as number), 0) / arr.length : null;
    return { n, hits, babip: n ? hits / n : null,
      ev: avg(ev, "ev"), la: avg(la, "la"), xba: avg(ba, "ba"), xw: avg(w, "w"), nba: ba.length, nw: w.length };
  }, [shown]);
  // chronological, opening day to the last game (stable sort keeps the bake's in-game order on a date)
  const flights = useMemo<Flight[]>(() => shown.map(({ sx, sy, ft, la, e, ev, d, pt, ba }) => ({ sx, sy, ft, la, e, ev, d, pt, ba }))
    .sort((a, b) => (a.d ?? "").localeCompare(b.d ?? "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, type, res, side, fpt, lhp, run]);
  const dated = all.some((b) => b.d);

  // Pull / centre / oppo by thirds of fair territory, from the side he batted on each ball. The
  // direction lines need one side: a switch hitter gets them once filtered to LHB or RHB.
  const fair = shown.filter((b) => Math.abs(b.ang) <= 45 && b.s);
  const pullAng = (b: { ang: number; s: string | null }) => (b.s === "L" ? b.ang : -b.ang);
  const share = (f: (a: number) => boolean) => (fair.length ? Math.round((100 * fair.filter((b) => f(pullAng(b))).length) / fair.length) : null);
  const dirs: [string, number | null][] = [["Pull", share((a) => a > 15)], ["Centre", share((a) => Math.abs(a) <= 15)], ["Oppo", share((a) => a < -15)]];
  const hand = !switcher ? (all.find((b) => b.s)?.s ?? null) : side === "L" || side === "R" ? side : null;
  const his = hand && fair.length ? fair.reduce((s, b) => s + b.ang, 0) / fair.length : null;
  const ref = hand ? refs?.refs?.[`${season}|${hand}`] : null;

  const arc = (f: (d: number) => number) => Array.from({ length: 91 }, (_, i) => pt(f(i - 45), i - 45));
  const fenceP = arc(fence), trackP = arc((d) => fence(d) - 15), dirtP = arc(dirt);
  const diamond = poly([at(0, 0), at(63.6, 63.6), at(0, 127.3), at(-63.6, 63.6)]) + " Z";
  const ray = (deg: number, ft = fence(deg)) => poly([[CX, CY], pt(ft, deg)]);
  const px = R / MAX_FT; // svg units per foot
  const bag = (x: number, y: number) => { const [bx, by] = at(x, y), h = 1.6 * px * 2.5; return <rect key={`${x}`} x={bx - h / 2} y={by - h / 2} width={h} height={h} transform={`rotate(45 ${bx} ${by})`} fill="rgba(255,255,255,0.75)" />; };
  const [mx, my] = at(0, 60.5);

  return (
    <div className="glass-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Spray chart</h2>
          <p className="text-[10px] text-text-dim">{shown.length} of {all.length} balls in play · colour = {BY_LABEL[by]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-dim">
          {by === "result"
            ? RESULT_COLORS.map(([, c, l]) => (
              <span key={l} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
            ))
            : by === "hc"
            ? HC_BANDS.map(([, c, l]) => (
              <span key={l} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
            ))
            : by === "pitch" && ptTypes
            ? [...ptTypes].sort().map((t) => (
              <span key={t} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: pitchColor(t) }} />{PITCH_CONFIG[t as keyof typeof PITCH_CONFIG]?.shortLabel ?? "oth"}</span>
            ))
            : EV_BANDS.map(([, c, l]) => (
              <span key={l} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
            ))}
          {(by === "ev" || by === "result") && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-white" />HR</span>}
        </div>
      </div>

      <div className="relative z-10 mb-2 flex flex-wrap gap-2 text-[10px]">
        <div className="flex gap-1" role="group" aria-label="Batted-ball type">
          {TYPES.map(([k, l]) => <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)} className={chip(type === k)}>{l}</button>)}
        </div>
        {switcher && (
          <div className="flex gap-1" role="group" aria-label="Batting side">
            {[["all", "Both"], ["L", "as LHB"], ["R", "as RHB"]].map(([k, l]) => <button key={k} type="button" aria-pressed={side === k} onClick={() => setSide(k)} className={chip(side === k)}>{l}</button>)}
          </div>
        )}
        <div className="flex gap-1" role="group" aria-label="Result">
          {RESULTS.map(([k, l]) => <button key={k} type="button" aria-pressed={res === k} onClick={() => setRes(k)} className={chip(res === k)}>{l}</button>)}
        </div>
        {ptTypes && (
          <div className="flex gap-1" role="group" aria-label="Pitch type">
            <button type="button" aria-pressed={fpt === "all"} onClick={() => setFpt("all")} className={chip(fpt === "all")}>Any pitch</button>
            {[...ptTypes].sort().map((t) => (
              <button key={t} type="button" aria-pressed={fpt === t} onClick={() => setFpt(t)} className={chip(fpt === t)}>
                {PITCH_CONFIG[t as keyof typeof PITCH_CONFIG]?.shortLabel ?? "oth"}
              </button>
            ))}
          </div>
        )}
        {handsPresent.size > 1 && (
          <div className="flex gap-1" role="group" aria-label="Pitcher hand">
            {[["all", "Any hand"], ["R", "vs RHP"], ["L", "vs LHP"]].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={lhp === k} onClick={() => setLhp(k)} className={chip(lhp === k)}>{l}</button>
            ))}
          </div>
        )}
      </div>
      <div className="relative z-10 mb-2 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="uppercase tracking-wider text-text-dim">Colour</span>
        <div className="flex gap-1" role="group" aria-label="Colour by">
          {(Object.keys(BY_LABEL) as By[]).map((k) => (
            <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)} className={chip(by === k)}>{BY_LABEL[k]}</button>
          ))}
        </div>
        <button type="button" aria-pressed={bigEv} onClick={() => setBigEv((v) => !v)} className={chip(bigEv)}>Size by EV</button>
        <span className="mx-1 h-3 w-px bg-border-subtle" aria-hidden />
        <div className="flex gap-1" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "dots"} onClick={() => { setView("dots"); setPlaying(false); }} className={chip(view === "dots")}>Dots</button>
          <button type="button" aria-pressed={view === "flight"} onClick={() => { setView("flight"); setFinished(false); setRun((r) => r + 1); setPlaying(true); }} className={chip(view === "flight")}>
            {dated ? "Season replay" : "Flight paths"}
          </button>
        </div>
        {view === "flight" && (
          <>
            <button type="button" className={chip(false)} aria-label={playing ? "Pause" : "Play"}
              onClick={() => { if (finished) { setFinished(false); setRun((r) => r + 1); setPlaying(true); } else setPlaying((p) => !p); }}>
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <button type="button" onClick={() => { setFinished(false); setRun((r) => r + 1); setPlaying(true); }} className={chip(false)}>↺ Restart</button>
            <div className="flex gap-1" role="group" aria-label="Speed">
              {[1, 4, 16].map((v) => <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)} className={chip(speed === v)}>{v}×</button>)}
            </div>
            {dated && date && <span className="font-data text-text-secondary">{dateLabel(date)}</span>}
          </>
        )}
      </div>

      {/* owner 2026-10-27: a slight broadcast-angle tilt (home plate nearest the viewer); hover hit-testing follows the transform */}
      {/* the -22% pull-up overlaps the controls' box: the wrapper lets clicks through, the field keeps hover */}
      <div className="pointer-events-none relative" style={{ perspective: `${PERSPECTIVE}px`, marginTop: "-22%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-auto w-full" role="img" aria-label="Spray chart of balls in play"
        style={{ transform: `rotateX(${TILT}deg)`, transformOrigin: "50% 100%", filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.45))" }}>
        {/* outfield grass, warning track, infield skin + grass, lines */}
        <path d={poly([[CX, CY], ...fenceP]) + " Z"} fill={GRASS} />
        <path d={poly([...fenceP, ...trackP.slice().reverse()]) + " Z"} fill={SKIN} />
        <path d={poly([[CX, CY], ...dirtP]) + " Z"} fill={SKIN} />
        <path d={diamond} fill={GRASS} stroke={LINE} strokeWidth="0.8" />
        <circle cx={mx} cy={my} r={9 * px} fill={SKIN} />
        <circle cx={CX} cy={CY - 2} r={13 * px} fill={SKIN} />
        <path d={poly(fenceP)} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" />
        <path d={ray(-45)} stroke={LINE} />
        <path d={ray(45)} stroke={LINE} />
        {bag(63.6, 63.6)}{bag(0, 127.3)}{bag(-63.6, 63.6)}
        <path d={`M ${CX - 3} ${CY - 3} H ${CX + 3} V ${CY} L ${CX} ${CY + 3} L ${CX - 3} ${CY} Z`} fill="rgba(255,255,255,0.85)" />
        {[-15, 15].map((d) => <path key={d} d={ray(d)} stroke="rgba(255,255,255,0.10)" strokeDasharray="2 4" />)}
        {[-40, 0, 40].map((d) => {
          const [x, y] = pt(fence(d) - 28, d);
          return <text key={d} x={x} y={y} fontSize="9" textAnchor="middle" fill="rgba(255,255,255,0.4)">{Math.round(fence(d))}</text>;
        })}
        {ref && typeof ref.mean === "number" && <path d={ray(ref.mean)} stroke="rgba(122,165,216,0.6)" strokeDasharray="4 4" />}
        {his != null && <path d={ray(his)} stroke="rgba(232,119,34,0.75)" strokeDasharray="4 3" />}
        {view === "dots" && shown.map((b, i) => (
          <circle key={i} cx={b.sx} cy={b.sy} r={dotR(b)}
            fill={dotColor(b)} fillOpacity={b.e === "home_run" ? 0.95 : 0.65}
            stroke={b.e === "home_run" ? "#fff" : "none"} strokeWidth="0.9">
            <title>{`${(b.e ?? "in play").replace(/_/g, " ")} · ${b.ev ?? "?"} mph · ${b.la ?? "?"}° · ${Math.round(b.ft)} ft`
              + `${ptOf(b) ? ` · vs ${b.ph === "L" ? "LHP" : "RHP"} ${PITCH_CONFIG[ptOf(b) as keyof typeof PITCH_CONFIG]?.label ?? "other"}` : ""}`
              + `${b.ba != null ? ` · hit chance ${(b.ba / 1000).toFixed(3)}` : ""}`}</title>
          </circle>
        ))}
        <text x={8} y={H - 6} fontSize="10" fill="rgba(255,255,255,0.4)">3B side</text>
        <text x={W - 8} y={H - 6} fontSize="10" textAnchor="end" fill="rgba(255,255,255,0.4)">1B side</text>
      </svg>
      {view === "flight" && (
        <FlightCanvas key={run} balls={flights} by={by} playing={playing} speed={speed}
          onDate={setDate} onDone={() => { setPlaying(false); setFinished(true); }} />
      )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
        {([
          ["Balls", rd.n != null ? String(rd.n) : "—"],
          ["BIP hits", rd.n ? `${rd.hits} (${Math.round(100 * (rd.babip ?? 0))}%)` : "—"],
          ["Avg EV", rd.ev != null ? `${rd.ev.toFixed(1)}` : "—"],
          ["Avg LA", rd.la != null ? `${rd.la.toFixed(1)}°` : "—"],
          ["Hit chance", rd.xba != null ? (rd.xba / 1000).toFixed(3).replace(/^0/, "") : "—"],
          ["xwOBACON", rd.xw != null ? (rd.xw / 1000).toFixed(3).replace(/^0/, "") : "—"],
        ] as [string, string][]).map(([l, v]) => (
          <div key={l} className="rounded-md border border-border-subtle py-1">
            <div className="text-[10px] text-text-dim">{l}</div>
            <div className="text-sm font-semibold font-data text-text-secondary">{v}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-text-dim">
        Thirds of fair territory (centre = within 15° of straightaway).
        {his != null ? ` Orange line: his average direction (${his > 0 ? "+" : ""}${his.toFixed(1)}°)` : ""}
        {his != null && ref ? <>; blue: the league average for {hand === "L" ? "left" : "right"}-handed batters{season ? ` in ${season}` : ""} ({ref.mean}°)</> : null}
        {his != null ? "." : ""}
        {switcher && !hand ? " Switch hitter: pull and oppo are counted from the side he batted on each ball; pick a side for the direction lines." : ""}
        {by === "hc" || by === "pitch" ? " Hit chance and pitch colour need the ball's pitch recorded; balls without it stay grey." : ""}
        {rd.xba != null ? ` Hit chance and xwOBACON are means of Savant's per-ball estimates (exit velo + launch angle) over the ${rd.nba} shown balls that carry one — their model, attributed; ours stays out (§68/§77).` : ""}
        {all.length < 50 ? " Thin sample — read the shape, not the percentages." : ""}
      </p>
    </div>
  );
}
