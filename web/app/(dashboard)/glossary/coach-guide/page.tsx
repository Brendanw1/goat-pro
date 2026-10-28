import Link from "next/link";

export const metadata = { title: "Coach guide" };

/**
 * The coach guide (D-23): how to read this site the way a coach reads a
 * player — what to look at first, what each number can and cannot say, and
 * where the site's own limits are. Every claim here is the same one the
 * glossary carries; this page orders them by use, not alphabetically.
 */

const Anchor = ({ t }: { t: string }) => (
  <Link href={`/glossary#${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    className="text-usf-gold/90 hover:underline">{t}</Link>
);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel p-5 space-y-2.5">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <div className="space-y-2 text-[13px] leading-[1.65] text-text-secondary">{children}</div>
    </div>
  );
}

export default function CoachGuidePage() {
  return (
    <div className="max-w-[820px] mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Coach guide</h1>
        <p className="text-xs text-text-dim mt-1">
          How to read this site the way you read a player. Everything links to its glossary entry.
        </p>
      </div>

      <Card title="Start here: what kind of site this is">
        <p>
          Every number is <strong>measured from tracked pitches</strong> or carries the{" "}
          <span className="text-usf-gold">descriptive label</span>. Nothing on the site forecasts next season — models
          describe what a pitch or a player did and how unusual it was, and say so everywhere they appear. When a card
          shows a grade, the hover names its population; the <Anchor t="Glossary" /> carries each model&apos;s gate
          status.
        </p>
        <p>
          Grades read <strong>100 = average, 10 points = one standard deviation</strong>. Skill estimates read on the{" "}
          <strong>20–80 scout scale</strong>, 50 = average. Percentile chips show where a number sits in its
          population — the toggle at the top of every page switches chips between the grade&apos;s own season and all
          seasons pooled.
        </p>
      </Card>

      <Card title="Reading a pitcher">
        <p>
          <strong>First stop: the arsenal table</strong> on his profile. Each pitch has its own usage, velocity,
          break, whiff rate, chase and run value. The shape-twin note under the table names the league pitch his shape
          is nearest — a faster read than any number for &quot;what does this pitch look like.&quot; The Visuals tab
          shows the same information as pictures: the radar gun (each curve&apos;s area is how often he throws it),
          where each pitch crosses the zone, the spin clock, how far apart his types leave the hand, and what he goes
          to next in each count.
        </p>
        <p>
          <strong>Whiff+</strong> grades bat-missing shape — how hard a pitch is to swing past, not how good it is. A
          sinker that lives at the bottom of the zone can grade low and still be excellent; that quality lives in{" "}
          <strong>Pitching+</strong> (all-in value per pitch, weak contact counts) and <strong>Prevention+</strong>
          {" "}(the season-level run-prevention stack). <strong>K+</strong> is a next-season strikeout projection —
          the one place the site looks forward, labelled as such. <strong>Control+</strong> is descriptive only: it
          credits strike-throwing and can underrate a guy whose strikes get hit (the glossary names its blind spot).
        </p>
        <p>
          <strong>Results are separate from grades.</strong> RV/100 is what actually happened, charged run by run; a
          good pitcher on a bad week shows it. Discipline rates (zone, chase, whiff by zone) carry{" "}
          <strong>sample-adjusted rankings</strong>: the sort order uses a shrunk rate so a two-pitch sample cannot
          lead the league, while the raw rate still prints. The run-value-in-context panel shows his leverage —
          situations are handed to a pitcher, never graded.
        </p>
      </Card>

      <Card title="Reading a hitter">
        <p>
          The <strong>skill card</strong> gives three 20–80 estimates — power, contact, eye — and a type (&quot;slugger,
          &quot;damage-first,&quot; &quot;contact&quot;). They are percentile bands, not scout grades; treat a first
          season as provisional. The <strong>scouting tab</strong> shows where he swings, where he whiffs, and what he
          does in each count, each cell against the league&apos;s same cell — a red +6 in a zone means he misses there
          six points more than everyone.
        </p>
        <p>
          <strong>wOBA</strong> on this site uses weights derived from our own run data (league average reads .310).
          Contact quality is EV90, max EV, hard-hit and barrel rates — batted-ball samples need about 25 balls before
          they mean anything, and the hollow-rank treatment marks anything thinner. The{" "}
          <strong>pitches-faced table</strong> on the Splits tab is the hitter&apos;s arsenal read: what he saw, and
          what he did to it, per pitch type, against the league&apos;s same matchup.
        </p>
      </Card>

      <Card title="Samples, floors, and honesty marks">
        <p>
          Every rank has a floor. Below it, the rank prints <strong>hollow</strong> — dashed ring, sample under the
          label — so a small sample shows its rank without pretending to be a rate you can trust. Discipline sorts use
          shrunk twins. Grade chips disappear under their pitch floors rather than guess. Where a model is
          descriptive (failed its gate, or never ran one), the card says so and the glossary explains what was tried.
        </p>
        <p>
          The one forecast on the site is K+ (and its Prevention+ sibling): those are next-season projections and say
          &quot;proj. next season&quot; where they appear. Everything else — Whiff+, Control+, Pitching+, the skill
          card, all of it — describes this season.
        </p>
      </Card>

      <Card title="Minors">
        <p>
          The <Anchor t="Minors" /> section has two layers: season lines for every level from the MLB Stats API, and
          the AAA Statcast board — the same advanced read the MLB side carries, from tracked AAA pitches. AAA
          pitchers carry <strong>Whiff+ labelled &quot;MLB model on AAA data&quot;</strong>: the MLB-trained model
          scored on their AAA pitches, display only. The rest of the model family is not validated below MLB and is
          not shown.
        </p>
      </Card>

      <Card title="Where to look things up">
        <p>
          The <Anchor t="Glossary" /> defines every metric with its scale, population and provenance. Board columns
          carry their definitions on hover; every panel has a one-line read under it, and panels that can be
          misread — chase rates for hitters, shape scatter on the mix board, park factors — say the direction in
          plain words on the spot.
        </p>
      </Card>
    </div>
  );
}
