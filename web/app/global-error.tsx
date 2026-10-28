"use client";

/**
 * Last-resort error page. Next's default prod screen says nothing; this says
 * the one true thing (something broke, retry) and nothing else — no stacks on
 * a public site.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", gap: 12,
          alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif",
          background: "#0a0e0d", color: "#f0f2f4", textAlign: "center", padding: 24,
        }}>
          <div style={{ fontSize: 28 }}>⚠︎</div>
          <p style={{ margin: 0, fontSize: 15 }}>This page couldn&apos;t load.</p>
          <p style={{ margin: 0, fontSize: 12, color: "#8B93A3" }}>
            The rest of the site is probably fine — the data lives elsewhere.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={reset} style={{
              padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)",
              background: "#f0f2f4", color: "#0a0e0d", fontSize: 13, cursor: "pointer",
            }}>Retry</button>
            <a href="/pitchers" style={{
              padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)",
              color: "#f0f2f4", fontSize: 13, textDecoration: "none",
            }}>Leaderboard</a>
          </div>
        </div>
      </body>
    </html>
  );
}
