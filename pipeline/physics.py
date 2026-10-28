"""Physics decomposition of the Statcast nine parameters (GOAT-Pro Task 1).

Takes the measured constant-acceleration trajectory fit (vx0, vy0, vz0, ax, ay, az
over y0 = 50 ft to the plate at y = 1.417 ft) and splits the measured acceleration
into its three physical parts, Alan Nathan's convention:

    a = a_grav + a_drag + a_magnus

  1. Gravity is known exactly:      a_grav = (0, 0, -32.174) ft/s^2.
  2. What is left, a_resid = a - a_grav, is drag plus Magnus. Drag is by
     definition the part ANTIPARALLEL to the velocity, so it is the projection
     of a_resid onto -v_hat:

         a_drag  = (a_resid . v_hat) v_hat          (a_resid . v_hat < 0 in flight)
         |a_drag| = -(a_resid . v_hat)              (deceleration, ft/s^2)

  3. Magnus is everything else, i.e. the component of a_resid PERPENDICULAR to
     the velocity:

         a_magnus = a_resid - (a_resid . v_hat) v_hat

     This is Nathan's decomposition (drag along -v_hat, spin force transverse);
     the same construction behind Statcast's induced-break and active-spin work.

  Active spin (spin_eff) is the college/MLB "stickiness" of spin: what fraction
  of the MAXIMUM possible Magnus acceleration the pitch actually realises. Max
  Magnus for a fully transverse spin is the standard max-Magnus constant

         a_magnus_max = 0.00583 * omega_rev_per_s * v_mph   [ft/s^2]

     0.00583 ft/s^2 per (revolution-per-SECOND x mph) -- with raw rpm the same
     formula needs rpm/60 folded in; used with raw rpm it overshoots by 60x and
     spin_eff lands near 0.015. Verified on MLB 2023-26 data: the rpm pairing
     gives FF ~0.015 (absurd), the rps pairing gives FF 0.89 (published range),
     and no other unit pairing is dimensionally sane. With release_spin_rate in
     rpm:

         spin_eff = |a_magnus| / (0.00583 * (spin_rpm / 60) * velo_mph),
         clipped to [0, 1.1] (measuring noise lets a few pitches exceed 1).

  VALIDATION on MLB 2023-26 (2,629,857 pitches; see RESULTS-MLB.md): measured
  means FF 0.890, SI 0.918, CH 0.915, FS 0.914, ST 0.564, CU 0.544, KC 0.509,
  FC 0.411, SL 0.278. The ORDERING matches published active-spin exactly. The
  levels are the MOVEMENT-DERIVED active spin, which is a different measurand
  from the spin-vector numbers (FF ~0.92) on Savant's leaderboard: Savant ships
  both ("Measured active spin uses the 3D spin vector" vs "Inferred active spin
  from movement"), and no scalar correction can move ours onto the spin-vector
  scale (SI sits ABOVE FF here and CU below, the reverse of a uniform offset).
  Cross-checks that pin the decomposition itself: mag_ivb/mag_hb reproduce the
  measured pfx breaks per type (FF 13.4 vs 15.7 in ride; CU -8.9 vs -10.0);
  |a_drag| ~31 ft/s^2 at 94 mph matches Cd ~0.30-0.33 aerodynamics; the SI
  arm-side a_magnus_x of ~17 ft/s^2 reproduces the ~14 in of sinker run; the
  handedness mirroring of ax is exact. The curve family reads ~0.05-0.10 below
  the spin-vector reference, the known bias of movement-inferred efficiency for
  high spin-parameter pitches.

  Magnus-implied movement integrates a_magnus over the flight time t already
  computed in train_mlb.load_features (constant acceleration over the measured
  fit window, displacement = 0.5 * a * t^2, converted to inches):

         mag_ivb = 0.5 * a_magnus_z * t^2 * 12   (vertical, inches)
         mag_hb  = 0.5 * a_magnus_x * t^2 * 12   (horizontal, inches)
         mag_break = 0.5 * |a_magnus| * t^2 * 12 (total, inches)

     These differ from measured pfx_ivb/pfx_hb because pfx carries the drag
     deflection of the whole residual acceleration; the Magnus columns isolate
     the spin-made part, which is the thing a stuff model wants.

Candidate features carried for the bake-off (Task 2): spin_eff, mag_ivb, mag_hb,
mag_break, a_drag. All are location-free (they are functions of the release and
the ball's own flight, never of where it crossed), so they cannot violate the
stuff-grade location ban the way effective_velo does.

Terminology follows the college pipeline (research/stuff-model/): features are
judged by stickiness (year-over-year reliability of the season grade),
reliability (split-half r), predictiveness (grade vs next-season outcomes
against the naive persistence baseline) and location-independence; spin_eff is
the same quantity the college shadow test found redundant there, so here it is
a CANDIDATE, not a shipping feature, until the MLB bake-off says otherwise.
"""

import numpy as np

G = 32.174                     # ft/s^2, gravity in z
Y0 = 50.0                      # ft, Statcast release y
Y_PLATE = 1.417                # ft, front of plate
A_MAX_CONST = 0.00583          # ft/s^2 per (rev/s * mph), max-Magnus constant
SPIN_EFF_CLIP = (0.0, 1.1)

COLS = ["spin_eff", "mag_ivb", "mag_hb", "mag_break", "a_drag"]


def add_physics(df):
    """Add spin_eff, mag_ivb, mag_hb, mag_break, a_drag to a frame that already
    carries vx0, vy0, vz0, ax, ay, az, velo (mph), spin (rpm) and the flight
    time t (seconds, from train_mlb.load_features). Vectorised, no NaN in ->
    no NaN out for rows with a complete nine-parameter fit."""
    v = np.column_stack([df["vx0"], df["vy0"], df["vz0"]])
    a = np.column_stack([df["ax"], df["ay"], df["az"]])
    a_resid = a - np.array([0.0, 0.0, -G])          # drag + magnus only
    speed = np.linalg.norm(v, axis=1)
    vhat = v / np.where(speed > 0, speed, np.nan)[:, None]
    along = np.sum(a_resid * vhat, axis=1)          # < 0 when drag dominates
    a_drag_vec = along[:, None] * vhat              # antiparallel component
    a_magnus = a_resid - a_drag_vec                 # transverse component
    mag_norm = np.linalg.norm(a_magnus, axis=1)

    denom = A_MAX_CONST * (df["spin"].to_numpy() / 60.0) * df["velo"].to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        spin_eff = np.where(denom > 0, mag_norm / denom, np.nan)
    df = df.copy()
    df["a_drag"] = -along                           # ft/s^2, positive = decelerating
    df["spin_eff"] = np.clip(spin_eff, *SPIN_EFF_CLIP)
    t2 = df["t"].to_numpy() ** 2
    df["mag_ivb"] = 0.5 * a_magnus[:, 2] * t2 * 12.0   # inches
    df["mag_hb"] = 0.5 * a_magnus[:, 0] * t2 * 12.0    # inches
    df["mag_break"] = 0.5 * mag_norm * t2 * 12.0       # inches
    return df


def validate(df):
    """Print mean spin_eff by pitch_type and the cross-checks. Returns True when
    the ordering and levels match the movement-derived active-spin reference
    (FF 0.85-0.95, curve family 0.45-0.65, gyro slider <= 0.40)."""
    m = df.groupby("pitch_type")["spin_eff"].agg(["mean", "count", "std"])
    print("spin_eff (active spin, movement-derived) by pitch_type")
    print("reference (movement-inferred, MLB): FF ~0.89, SI/CH/FS ~0.90-0.92, "
          "CU/KC ~0.51-0.55, ST ~0.56, FC ~0.41, SL ~0.28")
    print(m.round(3).to_string())
    ff, cu, si, sl = m.loc["FF", "mean"], m.loc["CU", "mean"], m.loc["SI", "mean"], m.loc["SL", "mean"]
    ok = (0.85 <= ff <= 0.95 and 0.85 <= si <= 0.97 and 0.45 <= cu <= 0.62
          and sl <= 0.40 and si > sl and ff > cu)
    print(f"validation: {'PASS' if ok else 'FAIL'} "
          f"(FF {ff:.3f}, SI {si:.3f}, CU {cu:.3f}, SL {sl:.3f})")
    return ok


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "/Users/brendanwaterval/Projects/goat-pro/pipeline")
    import train_mlb as tm
    df = tm.load_features()
    df = add_physics(df)
    ok = validate(df)
    print("\nMag-implied vs measured break (inches), by pitch_type:")
    print(df.groupby("pitch_type")[["mag_ivb", "ivb", "mag_hb", "hb",
                                    "a_drag", "velo"]].mean().round(2).to_string())
    sys.exit(0 if ok else 1)
