Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
Comprehensive Multi-Sport Quantitative Analytics
Platform:Serverless DuckLake Architecture, Latent State-Space
Projections, and Cross-Sport Econometric Modeling
Master Architectural Blueprint & Empirical Research Specification (MLB→ NBA→ NHL→
NFL)
October 2026
Contents
1 Phase 1: Major League Baseball — Kinematics, State-Space Projections, Pitch Modeling,
and SABR Research 1
1.1 Statcast 9-Parameter Kinematics and the 2026 ABS Coordinate Shift . . . . . . . . . . . . . . . . 1
1.2 Stuff+, Location+, and Pitching+ Architecture . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 2
1.3 Quantifying Pitcher Intent and Execution via xCTRL Gaussian Mixture Models . . . . . . . . . . 3
1.4 Scalable Player Projection Architecture and Latent State-Space Engineering . . . . . . . . . . . . . 4
1.4.1 Quantitative Mechanics of Industry Forecasting Systems . . . . . . . . . . . . . . . . . . . . 5
1.4.2 Contact Quality Stabilization and Batted-Ball Distributional Modeling . . . . . . . . . . . . 5
1.4.3 Hierarchical Empirical Bayes Estimation of Component Ballpark Factors . . . . . . . . . . 6
1.4.4 Minor League Translation Matrices and Multivariate Dynamic Linear Models (VectorSSM) 7
1.4.5 MLB Surplus Valuation and Implementation Validation Tiers . . . . . . . . . . . . . . . . . 7
1.5 2027 SABR Analytics Conference Research Proposals . . . . . . . . . . . . . . . . . . . . . . . . . 8
2 Phase 2: National Basketball Association — Possessional RAPM, 2026–27 CBA Apron Me-
chanics, and Trade Liquidity (ACRE) 9
2.1 Play-by-Play Lineup Reconstruction and Scorekeeper-Unbiased Possession State Machine . . . . . 9
2.2 Regularized Adjusted Plus-Minus (RAPM), Box-Prior IPM, and Extended E-RAPM . . . . . . . . 9
2.3 2026–27 NBA CBA 1st and 2nd Apron Algorithmic Rules Engine . . . . . . . . . . . . . . . . . . . 10
2.4 Trade Liquidity Index (TLI) and Apron-Constrained Roster Efficiency (ACRE) . . . . . . . . . . . 10
3 Phase 3: National Hockey League — Optical Edge Tracking, Expected Goals (xG/GSAx),
and fastRhockey Integration 11
3.1 Direct Ingestion of api-web.nhle.com/v1 and NHL Edge Optical Telemetry . . . . . . . . . . . . 11
3.2 Expected Goals (xG), Goaltender GSAx, and 4-State Special Teams RAPM . . . . . . . . . . . . . 11
4 Phase 4: National Football League — Spatio-Temporal Tracking, Disguise Entropy, and Draft
Surplus Valuation 12
4.1 Big Data Bowl Coordinate Standardization and Continuous Spatio-Temporal EPA (st-EPA) . . . . 12
4.2 Fitzgerald-Spielberger Draft Surplus Curves vs. Legacy Valuation Models . . . . . . . . . . . . . . 12
5 Phase 5: Serverless DuckLake Architecture, Zero-Local-Download Ingestion, and Traceable
Hybrid RAG 13
5.1 The $0–$10/Month Serverless DuckLake Storage, Catalog, and Compute Topology . . . . . . . . . 13
5.2 Traceable Three-Path Hybrid RAG Architecture . . . . . . . . . . . . . . . . . . . . . . . . . . . . 14
1
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
6 Comprehensive Bibliography & Source Directory 14
1 Phase 1: Major League Baseball — Kinematics, State-Space Pro-
jections, Pitch Modeling, and SABR Research
1.1 Statcast 9-Parameter Kinematics and the 2026 ABS Coordinate Shift
High-precision pitch evaluation requires reconstructing the three-dimensional flight trajectory of a baseball from
optical and radar tracking telemetry operating at 20,000 frames per second (Ref. [A1]). In the Statcast coordinate
system, spatial measurements are oriented from the catcher’s perspective: thex-axis runs horizontally (positive to
the catcher’s right), they-axis extends from the back apex of home plate toward the pitcher’s mound, and thez-axis
measures vertical height above the ground in feet (Ref. [A1, A2, A3]). While pitch velocities from 2008 through
2016 were captured via PITCHf/x and mathematically adjusted to approximate the out-of-hand release point, all
Statcast velocities from 2017 onward (release_speed) are measured directly out-of-hand, placing historical and
modern velocity distributions on a unified scale (Ref. [A2]).
To reconstruct the continuous trajectory of any pitch, the analytics engine evaluates the nine kinematic parameters
initialized at the reference planey0 = 50 ft from the apex of home plate: initial position(x0,y 0,z 0), initial three-
dimensional velocity (vx0,v y0,v z0) in feet per second, and constant three-dimensional acceleration(ax,a y,a z) in
ft/s2 (Ref. [A1, A2, A3]). Under constant acceleration kinematics, the spatial position of the baseball at elapsed
flight timet (relative toy0 = 50 ft) is governed by the system of equations (Ref. [A1]):
x(t) =x0 +vx0t + 1
2axt2 (1)
y(t) =y0 +vy0t + 1
2ayt2 (2)
z(t) =z0 +vz0t + 1
2azt2 (3)
A critical structural break occurs in the 2026 Major League Baseball season that invalidates unadjusted multi-year
spatial models. Through the 2025 season, Statcast recorded plate_x and plate_z at the front plane of home
plate (yfront = 17
12 ft≈ 1.4167 ft forward of the back apex), while the vertical strike-zone boundaries (sz_top and
sz_bot) were manually set by a human video tracking operator when the ball was halfway to the plate, historically
adding four inches above the batter’s belt forsz_top and marking the hollow of the knee forsz_bot (Ref. [A2,
A3]). Beginning in the 2026 season, Statcast redefinedplate_x and plate_z to capture the ball at the middle
of home plate (yABS = 8.5
12 ft≈ 0.7083 ft) to align with the Automated Ball-Strike (ABS) challenge and tracking
system, and transitionedsz_top and sz_bot to the batter’s standardized ABS-defined biomechanical strike zone
(Ref. [A2]).
Because a pitched baseball drops steeply over the final 8.5 inches (∆y =−0.7083 ft) between the front of the plate
and the middle of the plate, combining raw 2020–2025 data with 2026+ data introduces systematic vertical and
horizontal coordinate drift. To normalize all historical pitches (pre-2026) to the 2026 ABS middle-of-plate plane
(ytarget = 0.7083 ft), the ingestion pipeline solves the quadratic trajectory equation for the exact flight timetABS
required to travel fromy0 = 50 ft toytarget (Ref. [A1, A2]):
tABS =
−vy0−
√
v2
y0− 2ay(y0−ytarget)
ay
(4)
SubstitutingtABS intothe x(t)andz(t)equationsyieldstheABS-normalizedcoordinates (plate_xABS,plate_zABS)
for all pre-2026 seasons (Ref. [A1, A2]). Furthermore, spin-induced movement parameters (pfx_x and pfx_z),
which measure the horizontal and vertical deflection in feet aty = 40 ft relative to a theoretical spinless pitch
thrown at the same velocity (including drag), are standardized into pitcher-perspective inches via the transforma-
tion (Ref. [A2, A3, A4, A5, A6]):
hMovin =−12·pfx_x, vMovin = 12·pfx_z (5)
Under this convention, pitches with pure backspin (spin_axis= 180◦) exhibit positive induced vertical break
(vMovin > 0), whereas pure topspin 12-6 curveballs (spin_axis = 0◦) exhibit negative induced vertical break
(Ref. [A1, A2, A4]).
2
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
Parameter Unit & Frame Pre-2026 Legacy 2026+ ABS Stan-
dard
Pipeline Normalization
plate_x Feet (Catcher +x
right)
Front of plate (y =
1.4167 ft) (Ref. [A2])
Middle of plate (y =
0.7083 ft) (Ref. [A2])
Project pre-2026 rows to
y = 0.7083 ft via x(tABS)
(Ref. [A1, A2])
plate_z Feet above ground
(+z up)
Front of plate (y =
1.4167 ft) (Ref. [A2])
Middle of plate (y =
0.7083 ft) (Ref. [A2])
Project pre-2026 rows to
y = 0.7083 ft via z(tABS)
(Ref. [A1, A2])
sz_top /
sz_bot
Feet above ground Manual video opera-
tor line aty≈ 25 ft
(Ref. [A2, A3])
Automated ABS
biomechanical zone
(Ref. [A2])
Normalize height:
znorm = plate_zABS−sz_bot
sz_top−sz_bot
(Ref. [A2])
pfx_x / pfx_z Feet aty = 40 ft Spin-induced break
in feet (Ref. [A2, A4,
A5])
Spin-induced break
in feet (Ref. [A2])
Multiply by −12 (pfx_x)
and +12(pfx_z)forpitcher
inches (Ref. [A4, A6])
arm_angle Degrees (0◦ horiz.) Shoulder-to-ball re-
lease vector angle
(Ref. [A2])
Shoulder-to-ball re-
lease vector angle
(Ref. [A2])
Retain scale; mirror
release_pos_x for LHP
parity (Ref. [A2, A7])
swing_path_tiltDegrees vs. ground 40 ms pre-contact
flat-disc swing plane
(Ref. [A2])
40 ms pre-contact
flat-disc swing plane
(Ref. [A2])
Pair with attack_angle
and attack_direction for
CGD (Ref. [A2, A8])
1.2 Stuff+, Location+, and Pitching+ Architecture
To isolate intrinsic pitch quality (Stuff+) from spatial execution (Location+) and overall pitch value (Pitching+),
theplatformtrainsstratifiedgradient-boosteddecisiontreeensembles( LightGBM, CatBoost, andHistGradientBoosting)
across 700,000+ pitch-level Statcast observations per season (Ref. [A7, A9, A10, B61, B62]). Rather than training
directly on binary strikeout or noisy ERA outcomes, the target variable is constructed from the ground up using
pitch-level linear weight run values (∆RE24), where balls, called strikes, swinging strikes, fouls, and balls in play
(valued via expected weighted on-base average,xwOBA) are assigned context-neutral run values (Ref. [A7, A10,
A11]).
Pitches are partitioned into three primary classification families—Fastballs (Four-Seam, Sinker, Cutter), Break-
ing Balls (Slider, Sweeper, Curveball, Knuckle-Curve), and Offspeed (Changeup, Splitter)—yielding 12 distinct
sub-models when crossed with four algorithmic specifications (Ref. [A7]). To prevent data leakage where the tree
ensemble memorizes individual pitcher identities via release coordinates, hyperparameter tuning via Optuna en-
forces pitcher-groupedK-fold cross-validation, ensuring all pitches thrown by pitcheri reside exclusively in either
the training fold or the validation fold (Ref. [A10]). Left-handed pitcher horizontal features (release_pos_x,
pfx_x, vx0, ax) and spin_axis (θnorm = 360◦−spin_axis) are reflected across the vertical axis prior to training
so physical movement profiles remain handedness-invariant (Ref. [A2, A7]).
For Secondary and Tertiary pitches (Breaking Balls and Offspeed), physical deception depends heavily on tunneling
relative to the pitcher’s primary fastball. Accordingly, the Stuff+ feature matrix incorporates both absolute kine-
matics (release_speed, release_extension, release_pos_x, release_pos_z, arm_angle, release_spin_rate,
spin_axis, pfx_x, pfx_z) and differential features (∆v = vpitch− ¯vFB, ∆pfx_x = pfx_xpitch− pfx_xFB,
∆pfx_z = pfx_zpitch−pfx_zFB) (Ref. [A2, A6, A10]). Conversely, Location+ strips out all velocity, movement,
and spin variables, training exclusively on count state(balls,strikes), platoon handedness, and ABS-normalized
spatial coordinates (plate_xABS,znorm) (Ref. [A2, A7, A12]). Raw model predictionsˆy are standardized onto the
conventional plus-scale where league average equals100 and one standard deviation equals10 (Ref. [A11]):
Stuff+p = 100− 10·
(ˆyp−µˆy
σˆy
)
(6)
Empirical validation demonstrates that while FanGraphs’ proprietary Stuff+ model retains a narrow advantage
in forecasting full-season ERA (r =−0.358 vs. −0.317, a differential of 0.041), an Optuna-tuned LightGBM
Stuff+ pipeline trained on pitch-level xwOBA and run-value frameworks significantly outperforms FanGraphs
Stuff+ on direct bat-missing indicators, achieving a+0.514 correlation with Whiff Rate (compared to+0.355 for
FanGraphs, a +0.159 correlation advantage) and a+0.417 correlation with Strikeout Rate (compared to+0.390
for FanGraphs, a+0.027 advantage) (Ref. [A10]). Furthermore, across 1.76 million pitches in in-house validation,
pitch-level physical metrics correlate with next-season major league strikeout rate within 100 to 200 pitches, even
3
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
while pitch-level raw run values remain noisy (r =.021), and fastball velocity and Stuff+ stabilize within three to
five appearances (Ref. [B4, B61, B63]).
1.3 Quantifying Pitcher Intent and Execution via xCTRL Gaussian Mixture Models
A fundamental limitation of Location+ and traditional walk-based control metrics is that they evaluate where a
pitch crossed the plate relative to a league-wide run-value map, entirely ignoring where the pitcher intended to
throw the ball (Ref. [A11]). A pitcher who aims for the upper-outer corner on an 0-2 count and misses by two inches
off the plate is executing at an elite level, whereas a pitcher who aims down-and-away and misses by 14 inches
into the heart of the zone has suffered a severe mechanical failure, even if Location+ scores the middle-middle
strike favorably (Ref. [A11]). Empirical pitch densities for Zack Wheeler against right-handed batters illustrate
this count-dependent targeting policy: in early and hitter-friendly counts, Wheeler concentrates fastballs around
two primary targets (middle-middle and middle-away) safely inside the zone, whereas in pitcher-friendly counts
he deliberately shifts his strategy and targets up-and-away on the zone edge where a potential ball is less costly
(Ref. [A11]).
To decouple strategic intent from physical execution, the platform implements xCTRL via a contextual Gaussian
Mixture Model (GMM) fitted with the Expectation-Maximization (EM) algorithm (Ref. [A11]). For a given pitcher
i, pitch typem, batter handednessh∈{ L,R}, and count state binc∈{ early,hitter-friendly,pitcher-friendly}, let
Xi,m,h,c ={u1, u2,..., uN}denotethesetoftwo-dimensionalABS-normalizedplatelocations un = (plate_xABS,n,plate_zABS,n)T
converted to inches (Ref. [A2, A11]). The pitcher’s location density is modeled as aK-component bivariate Gaus-
sian mixture (Ref. [A11]):
p(un| Θ) =
K∑
k=1
πkN (un| µk, Σk) (7)
where πk represents the prior probability of targeting intent clusterk (∑K
k=1πk = 1), µk∈ R2 represents the
intended spatial target center of clusterk, andΣk∈ R2×2 is the execution covariance matrix (Ref. [A11]). During
the E-step of the EM algorithm, the posterior responsibilityγnk that pitchn was aimed at targetµk is computed
as (Ref. [A11]):
γnk = πkN (un| µk, Σk)∑K
j=1πjN (un| µj, Σj)
(8)
OncetheEMalgorithmconverges(incorporatingasmoothing-basedextensionacrossadjacentcountbinswhencon-
textual sample sizes are limited), the pitch-level execution error xCTRLn (in inches) is defined as the responsibility-
weightedEuclideandistancebetweentherealizedpitchlocation un andtheinferredtargetcentroids µk (Ref.[A11]):
xCTRLn =
K∑
k=1
γnk∥un− µk∥2 (9)
Across Major League Baseball, pitcher-level xCTRL exhibits a mean of9.14 inches and a standard deviation of
1.10 inches, where lower values signify superior control (Ref. [A11]). Regressing Fielding Independent Pitching
(FIP) simultaneously on Stuff+ and xCTRL proves that both metrics are highly significant and complementary:
a one-standard-deviation improvement in Stuff+ (≈ 10 points) reduces expected FIP by≈ 0.30 runs, which is
identical in magnitude to the FIP reduction achieved by a1.0-inch improvement in xCTRL (Ref. [A11]). At the
granular pitch level, regressing RE24 on fastball velocity and fastball xCTRL demonstrates that control alone
accounts for a difference of roughly0.50 runs per start between the best and worst control pitchers over 20 batters
faced (0.0086× 3× 20 ≈ 0.52 runs), whereas each additional mile per hour of fastball velocity reduces runs
allowed by≈ 0.25 runs over the same 20-batter horizon (Ref. [A11]). For breaking balls, regressing ∆RE on
curveball xCTRL while holding spin rate constant reveals that each1.0-inch improvement in curveball xCTRL
prevents 0.29 expected runs per 100 curveballs by eliminating poorly located middle-zone “hangers” (Ref. [A11]).
Furthermore, kinematic tracking of collegiate pitchers using a TrackMan V3 unit (cohort mean fastball xCTRL=
12.33± 1.04 in) demonstrates via backward multiple linear regression (α = 0.05) that variability in torso angle at
ball release explains11.0% of the variance in fastball xCTRL (F (1, 40) = 4.96,R 2 = 0.110,p = 0.032), with every
0.332◦ increase in torso angle standard deviation increasing (degrading) xCTRL by1.0 inch (β = 0.332,t (40) =
2.23,p = 0.032) (Ref. [A8]).
4
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
Pitch Metric Model Specification Distribution Empirical Validation & Run
Equivalence
Custom Light-
GBM Stuff+
Optuna-tuned LightGBM
on pitch-level xwOBA /
∆RE24 with pitcher-
grouped CV (Ref. [A10])
µ = 100 .0, σ =
10.0 (Ref. [A11])
Out-of-sample r = +0.514 with Whiff
Rate,r = +0.417 with K Rate, andr =
−0.317 with ERA (Ref. [A10]).
FanGraphs Stuff+
Benchmark
Proprietary pitch-
quality baseline via
pybaseball.fg_pitching_data
(Ref. [A10, A13])
µ = 100 .0, σ =
10.0 (Ref. [A11])
Out-of-sample r = +0.355 with Whiff
Rate (−0.159 vs. Custom), r =
+0.390 with K Rate,r =−0.358 with
ERA; 1 SD ( +10) yields −0.30 FIP
(Ref. [A10, A11]).
MLB xCTRL
(Overall & FB)
Bivariate GMM fitted via
EM over count/platoon
bins (Ref. [A11])
µ = 9 .14 in,
σ = 1 .10 in
(Ref. [A11])
−1.0 in in xCTRL yields −0.30 FIP
(matching 1 SD Stuff+); ≈ 0.50 runs
per 20 BF (0.0086· 3· 20) (Ref. [A11]).
MLB Curveball
xCTRL
Bivariate GMM on
breaking-ball intent clus-
ters holding spin constant
(Ref. [A11])
Pitch-level
inches from
µk (Ref. [A11])
−1.0 in in curveball xCTRL reduces ex-
pected runs allowed by 0.29 runs per
100 curveballs (Ref. [A11]).
Torso Angle SD Backward multiple linear
regression on TrackMan
V3 cohort (Ref. [A8])
Cohort xCTRL =
12.33 ± 1.04 in
(Ref. [A8])
Explains 11.0% of FB xCTRL vari-
ance (F (1, 40) = 4.96,R 2 = 0.110,p =
0.032); +0.332◦ SD degrades xCTRL
by +1.0 in (Ref. [A8]).
1.4 Scalable Player Projection Architecture and Latent State-Space Engineering
Quantitative evaluations of contemporary baseball forecasting systems establish that baseline empirical regression
architectures—such as Marcel or univariate state-space estimators—succeed in establishing overall population
calibration but systematically fail to optimize individual player ordering (Ref. [B1, B7]). In controlled out-of-
sample backtests spanning 704 major league hitter-seasons with 200 or more plate appearances across 2024 and
2025, an autoregressive state-space baseline achieved superior aggregate level calibration (a mean offset of+0.00106
wOBA versus+0.00691 for Steamer and+0.00497 for Dan Szymborski’s ZiPS) and matched raw root mean square
error (RMSE) benchmarks (.03121 versus.03086 for Steamer and.03006 for ZiPS) (Ref. [B2, B9, B16]). However,
when level errors were recentered, both external commercial systems outperformed the baseline in player ordering
by a statistically significant margin: ZiPS demonstrated a+4.71% skill advantage (p =.003) and Steamer achieved
a +3.39% advantage (p =.035) (Ref. [B1, B13]).
Diagnostic profiling reveals the mathematical drivers of this ordering deficit: the omission of high-frequency
Statcast contact-quality process metrics from the production filtering layer and the application of blunt, aggregate
park adjustments rather than component-specific environmental shrinkage (Ref. [B1, B2]). Specifically, adjusting
aggregate wOBA through a scalar batting park factor—while leaving underlying component rates unadjusted—
induces a residual correlation of+0.0555 to +0.0616 with home ballparks, generating an unmitigated error slope
of +0.00355 wOBA per 10 park factor points that distorts talent estimates in the tails of the stadium distribution
(Ref. [B1, B2]). Furthermore, unconditioned minor-league transition models suffer from a−0.015 rookie selection
bias when survival truncation is ignored, while traditional forecasting fails to capture the physical constraints
governing pitcher role transitions (Ref. [B4]).
1.4.1 Quantitative Mechanics of Industry Forecasting Systems
Contemporary baseball projection systems operate on distinct statistical paradigms to separate persistent athletic
skill from sample variance, apply aging trajectories, and translate minor league performance to MLB (Ref. [B1,
B10, B11]):
• Marcel the Monkey (Tom Tango):Executes a deterministic multi-year weighted average of past perfor-
mance, assigning weights of 5, 4, and 3 to seasonst, t− 1, andt− 2, respectively, and isolates true talent by
applying a fixed regression constant (1,200 PA / 120 BF) toward the league mean alongside a deterministic
piecewise linear aging factor (+0.6% /−0.3%) (Ref. [B7, B8, B15]).
• Steamer (Cross, Davidson, & Rosenbloom):Uses multilevel Generalized Linear Mixed Models (GLMM)
5
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
and Empirical Bayes shrinkage with parameter-specific maximum likelihood shrinkage across variable samples
and non-parametric aging curves conditioned on athletic profiles (Ref. [B9, B11, B12, B14]).
• ZiPS (Dan Szymborski): Implements a composite architecture centered on comparable player matching
(k-nearest neighbors) and internal “zStats” (such as zBABIP incorporating batted-ball spray distribution,
Statcast sprint speed, and plate discipline) over 4-year weighted histories, replacing fixed cohort aging curves
with dynamically calculated trajectories derived from historical player clusters (Ref. [B16, B17, B18, B19, B20,
B21, B64]).
• PECOTA (Nate Silver / Baseball Prospectus):Employs Mahalanobis distance and historicalk-NN over
multi-year performance, height, weight, position, and minor league data to generate probabilistic percentile
distributions from comparable player forward trajectories (Ref. [B22, B23, B24, B25, B26, B27, B28, B29]).
• THE BAT / THE BAT X (Derek Carty):Uses a machine learning ensemble and kinematic simulation
combining past outcome rates with over 150 Statcast covariates (prioritizing 90th-percentile exit velocity,
barrel percentages, sweet-spot frequencies, and sprint speeds) run through context-neutral physical simulations
accounting for weather, temperature, humidity, wind vectors, and umpire tendencies (Ref. [B30, B31, B32, B33,
B34, B35]).
System Statistical Archi-
tecture
Regression &
Shrinkage
Aging Formulation Primary Inputs
Marcel
(Ref. [B7,
B8])
Heuristic Weighted
Average (5/4/3)
Static population
shrinkage (1,200 PA /
120 BF) toward league
mean (Ref. [B7])
Deterministic piece-
wise linear (+0.6% /
−0.3%) (Ref. [B8])
3-year box-score
history, basic age
(Ref. [B7])
Steamer
(Ref. [B9,
B11])
Multilevel GLMM /
Empirical Bayes
Parameter-specific
ML shrinkage across
variable samples
(Ref. [B12])
Non-parametric
aging conditioned
on athletic profiles
(Ref. [B14])
Pitch tracking, plate
discipline, box scores
(Ref. [B12])
ZiPS
(Ref. [B16,
B17])
Composite Time-
Series & k-NN
Analogs
Multi-year baseline
adjusted via inter-
nal zStats (zBABIP)
(Ref. [B18])
Dynamic aging via
cluster-matched
historical analogs
(Ref. [B16])
4-yr box scores, spray
angles, sprint speed
(Ref. [B18])
PECOTA
(Ref. [B22,
B23])
Mahalanobis Distance
/ Historicalk-NN
Empirical distribution
matching over nearest
cohorts (Ref. [B25])
Probabilistic distri-
bution from com-
parable trajectories
(Ref. [B26])
Multi-yr stats, height,
weight, pos, MiLB
(Ref. [B25])
THE
BAT/X
(Ref. [B30,
B31])
ML Ensemble / Kine-
matic Simulation
Multi-layer regres-
sion with Statcast
process expectations
(Ref. [B31])
Trajectory decay con-
ditioned on physical
traits & EV decline
(Ref. [B33])
Statcast EV/LA,
park geometry, micro-
climate (Ref. [B31])
1.4.2 Contact Quality Stabilization and Batted-Ball Distributional Modeling
The primary empirical vulnerability of a pure box-score state-space model is the treatment of Batting Average on
Balls in Play (BABIP), which requires 820 Balls in Play (BIP) to stabilize and exhibits a negative rank correlation
(−0.07) for rookie forecasts derived purely from minor league box scores (Ref. [B1, B2, B36, B37]). Incorporating
fast-stabilizing Statcast batted-ball process metrics and launch angle tightness directly remedies this vulnerability
(Ref. [B1, B37, B38, B39, B41, B42, B43, B44, B45]):
Metric Category Statistical Metric Stabilization
Threshold
Mechanistic Significance in Projec-
tion Layer
Batted-Ball Pro-
cess
Exit Velocity (Mean
EV) (Ref. [B37])
50 Balls in Play
(BIP)
Direct measure of kinetic energy transfer;
highly stable indicator of raw power ceiling
(Ref. [B37, B38, B39]).
6
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
Metric Category Statistical Metric Stabilization
Threshold
Mechanistic Significance in Projec-
tion Layer
Batted-Ball Pro-
cess
90th Percentile Exit
Velo (EV90) (Ref. [B1])
60 Balls in Play
(BIP)
Eliminates drag of mis-hit balls
(topped/flared); isolateshigh-endauthority
independent of pitch type (Ref. [B1]).
Contact Author-
ity
Barrel Rate (BRL%)
(Ref. [B37])
50 Balls in Play
(BIP)
Captures optimal launch angle and velocity
window; drives isolated power (Ref. [B37,
B38]).
Contact Author-
ity
Hard-Hit Rate (Hard-
Hit%) (Ref. [B37])
50 Balls in Play
(BIP)
Percentage of batted balls≥ 95 mph; ro-
bust proxy for baseline contact authority
(Ref. [B37, B41]).
Plate Discipline Whiff Rate (Whiff%)
(Ref. [B1])
60 Swings Swings missing ball; fast-stabilizing lead-
ing indicator for true strikeout trajectory
(Ref. [B1]).
Plate Discipline Chase Rate (O-
Swing%) (Ref. [B1])
100 Pitches Out-
of-Zone
Propensity to expand strike zone; directly
conditions forward walk-rate expectations
(Ref. [B1]).
Outcome Chan-
nel
Raw BABIP
(Ref. [B37])
820 Balls in Play
(BIP)
Dominated by defensive positioning, park
area, and binomial luck; requires 3+ years
of data (Ref. [B37]).
1.4.3 Hierarchical Empirical Bayes Estimation of Component Ballpark Factors
To eliminate the+0.00355 wOBA per 10 BPF points error slope (95% clustered CI) across extreme environments
like Coors Field (129 BPF) or T-Mobile Park (88 BPF) (Ref. [B1, B2]), the model formulates component park
effects through a Bayesian hierarchical linear mixed model with partial pooling (Ref. [B2, B8, B46, B47, B48, B49,
B50, B51, B52, B65, B66, B67, B68]):
yc,t,j,k =µc +αc,j +βc,k +γc,j,h +ϵc,t,j,k, α c,j∼N (Xjγc,τ 2
c ) (10)
whereyc,t,j,k represents the log-rate of componentc in seasont at venuej against opponentk,αc,j is the persistent
stadium effect shrunken toward physical venue covariatesXjγc (elevation, temperature-adjusted air density, foul
pole distances, wall height, and foul territory square footage),βc,k is the opponent quality adjustment, andγc,j,h
is the venue-by-batter-handedness interaction (Ref. [B2, B46]).
Component Physical Stadium
Drivers
1-Yr Rel.
(r)
EB Shrinkage Target
(Xjγ)
MLB Factor
Range
Home Runs
(HR) (Ref. [B2,
B45])
Fence distance, wall
height, elevation, air den-
sity, humidor (Ref. [B2])
High Aerodynamic trajec-
tory simulation over 3D
stadium scan
70 (Oracle Park) to
135 (Great Ameri-
can) (Ref. [B46])
BABIP
(Ref. [B2, B45])
Outfield acreage, turf re-
sistance, foul territory size
(Ref. [B2])
Moderate Playable fair surface area
minus defensive coverage
92 (Fenway Park)
to 118 (Coors Field)
(Ref. [B2])
Extra-Base
Hits (2B/3B)
(Ref. [B2])
Corner angles, alley
depth, carom reflectivity,
wall height (Ref. [B2])
Moderate Square footage of outfield
gaps and wall height
80 (Yankee Stadium)
to 130 (Fenway
Park) (Ref. [B2])
Strikeouts (K)
(Ref. [B2, B47])
Batter-eye contrast, sta-
dium light lux, shadows
(Ref. [B2])
Very Low League mean prior ( 100),
zero dimensional loading
96 to 104 (Tight
convergence around
100) (Ref. [B2])
Walks (BB)
(Ref. [B2, B47])
Umpire visual perspec-
tive, background noise be-
hind plate (Ref. [B2])
Very Low League mean prior ( 100),
zero dimensional loading
97 to 103 (Tight
convergence around
100) (Ref. [B2])
7
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
1.4.4 Minor League Translation Matrices and Multivariate Dynamic Linear Models (VectorSSM)
Forecasting rookie performance builds on Clay Davenport’s Translations (DTs), Bill James’ Major League Equiv-
alencies (MLEs), and Chris Mitchell’s KATOH probit regressions conditioned on age relative to level, plate dis-
cipline, isolated power, and position, while correcting for the−0.015 rookie selection bias via survival-truncation
risk-set weighting across MiLB sportIds 11 (AAA), 12 (AA), 13 (High-A), and 14 (Single-A) linked via the
Chadwick Bureau Register (Ref. [B3, B4, B6, B40, B53, B54, B55, B56, B57, B58]).
Atthemathematicalcoreoftheprojectionengineisanautoregressivemultivariatestate-spacemodel( VectorSSM),
replacing independent scalar filters (Ref. [B5, B59]). For each player and seasont, observation variance is modeled
via heteroskedastic binomial variance evaluated at the player’s own predicted rateπj,t (Ref. [B1, B5]):
Ht,jj = πj,t(1−πj,t)
Nj,t
(11)
The Kalman filter equations execute recursive Bayesian updates sequentially across each player’s career history
(Ref. [B5, B59]):
One-Step State & Covariance Prediction:at|t−1 = Ttat−1 + ct, Pt|t−1 = TtPt−1TT
t + Qt (12)
Innovation & Residual Covariance: vt = yt− (Ztat|t−1 + dt), Ft = ZtPt|t−1ZT
t + Ht (13)
Kalman Gain & State Update: Kt = Pt|t−1ZT
t F−1
t , at = at|t−1 + Ktvt, Pt = (I− KtZt)Pt|t−1
(14)
Formulti-horizonforecasting( h≥ 1), thestatevectorandstateerrorcovariancearepropagatedforwardrecursively
(Ref. [B5]):
at+h|t =
( h∏
k=1
Tt+k
)
at +
h∑
k=1


h∏
j=k+1
Tt+j

 ct+k, Pt+h|t = Tt+hPt+h−1|tTT
t+h + Qt+h (15)
Given linear wOBA weightsw∈ Rm, the projected mean and exact predictive variance are propagated directly
without scalar delta-method approximations (Ref. [B5]):
E[wOBAt+h] = wTat+h|t +µwOBA, Var(wOBAt+h) = wTPt+h|tw +σ2
rebuild (16)
Internal backtesting of VectorSSM demonstrated univariate rebuild parity (RMSE.0314) and verified nominal
coverage across forward horizons (h = 1 to h = 3 coverage bounded between.779 and .793 for nominal 80%
intervals) while eliminating 15 free parameters across the joint estimation space, capturing the strong positive
drift correlation (r = +0.615) between latent home run power (HR%) and non-HR extra-base hit power (XBH %)
while confirming that BABIP drift remains orthogonal to power components (Ref. [B5]).
For comparable player matching, the Mahalanobis distance functionDM(x, yi) is scaled using a localized adaptive
Gaussian kernel whereσlocal is the distance to thek-th nearest neighbor (k = 30), maintaining effective sample
sizes within the optimal calibration band of 20 to 45 players (Ref. [B7, B60]):
wi = exp
(
−DM(x, yi)2
2σ2
local
)
(17)
1.4.5 MLB Surplus Valuation and Implementation Validation Tiers
When translating Stuff+, xCTRL, and VectorSSM projections into front-office contract valuations (allocating a
fixed pool of 570 replacement runs for position players and role-split replacement levels for pitchers) (Ref. [B4,
B6, B60]), the platform anchors its surplus value converter to the 2025–2026 MLB free-agent market equilib-
rium (Ref. [A14]). While position players and starting pitchers projected for2 + WAR command an average of
$7.7M/WAR (ranging from $7.28M/WAR for Tier-1 All-Stars like Framber Valdez, Dylan Cease, Bo Bichette,
and Alex Bregman and$7.62M/WAR for Tier-2 All-Stars to$7.95M/WAR for Kyle Tucker and$10.3M/WAR
for Pete Alonso), high-leverage relievers (Edwin Diaz, Devin Williams, Robert Suarez) command$17.5M/WAR
(Ref. [A14]). Thus, bullpen arms are valued on a Dollar-per-Win-Probability-Added ($/WPA) and convex tier
pricing curve (Ref. [A14, B4]).
8
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
Tier & Precondi-
tions
Technical Implementa-
tion Tasks
Validation Gate &
Threshold
Failure Modes & Mitiga-
tions
Tier 0: Ingestion
Spine (Ref. [B40])
Ingest MiLB box scores
(2005–2020) via MLB Stats
API (sportIds 11–14); Fan-
Graphs Guts & Savant FRV;
join Chadwick ID register
(Ref. [B3, B40]).
Match rate ≥ 99.5% on
Chadwick keys; wOBA
identity closure; zero
missing season weights
(Ref. [B7]).
Failure: Polars OOM on
pitch logs; API throttling.
Mitigation: Lazy parquet
scans; 2 req/sec backoff
(Ref. [B7, B40]).
Tier 1: Core
Statistical Re-
mediation (P0)
(Ref. [B1, B2])
Implement hierarchical EB
park factors (HR, BABIP,
XBH, K, BB); wire EV90,
BRL% into hitter matrix; de-
ploy age-relative MiLB prior
(Ref. [B1, B2, B6]).
Park residual≈ 0; wOBA
error slope eliminated;
hitter ordering skill
gain +3.4% to +4.7%
(Ref. [B1, B2, B5]).
Failure: Collinear track-
ing singularity. Mitigation:
Ridge penalty on observa-
tion matrix; 50 BIP floor
(Ref. [B7]).
Tier 2: Vec-
torSSM & Kine-
matics (Ref. [B4,
B5])
Deploy VectorSSM with joint
drift covariance Q; wire in-
house Stuff+ & velocity into
pitcher states; enforce SP
→ RP constraints (Ref. [B4,
B5]).
Multi-horizon coverage
bounded at .779–.793
(80% CI); pitcher K%
correlation stabilized
(Ref. [B4, B5]).
Failure: Q losing PSD dur-
ing optimization. Mitigation:
Parameterize Q = LLT via
Cholesky factor (Ref. [B7]).
Tier 3: Latent
Comps & As-
set Valuation
(Ref. [B4, B60])
Rescale Mahalanobis comps
via adaptive Gaussian kernel
(k = 30); role-split pitcher re-
placement levels; convex tier
contract pricing (Ref. [B4,
B7, B60]).
Effective sample size
20–45; pitcher RAR closes
within 0.1; valuation
LOYO slope calibrated
(Ref. [B4, B60]).
Failure: Kernel collapsing to
uniform weights. Mitigation:
Scale penalty by empirical
distance SD; binned PAVA
(Ref. [B4]).
1.5 2027 SABR Analytics Conference Research Proposals
In accordance with the Society for American Baseball Research (SABR) guidelines for the 2027 SABR Analytics
Conference (abstract submission deadline: November 25, 2026; Sarah Langs Women in Baseball Scholarship and
Research Awards deadline: December 18, 2026) (Ref. [A15]) and the blind-review standards established for SABR
54 (Ref. [A16]), the platform anchors its baseball vertical around two complementary research specifications:
1. Abstract 1 — Decomposing Pitch-to-Swing Geometric Collisions Under the 2026 ABS Regime:
Integrating Arm-Slot Release Kinematics, xCTRL Intent Clusters, and 3D Bat-Path Colli-
sion Geometry Deviation:Utilizing 2.8 million Statcast pitches from 2024–2026 ingested viapybaseball
and python-mlb-statsapi (Ref. [A18, A19]), all pre-2026 pitch trajectories are forward-projected fromy =
1.4167 ft to the 2026 ABS middle-of-plate plane (y = 0.7083 ft) using 9-parameter kinematics (Ref. [A1,
A2]). An EM Gaussian Mixture Model computes pitch-level intent centroids µk and signed miss vectors
en = un− µk across count and platoon states (Ref. [A11]), while a continuous 3D Collision Geometry De-
viation (CGD) tensor across 25 normalized ABS strike-zone cells models the angular discrepancy between
the incoming pitch approach vector aty = 0.7083 ft (conditioned on pitcherarm_angle and induced break)
and the batter’s 40-ms pre-impact swing plane (swing_path_tilt, attack_angle, attack_direction, and
intercept_ball_minus_batter_pos_x/y_inches), building on two-strike swing adjustment research (0 to
+0.020 xwOBA, up to+0.038 for Yordan Alvarez) (Ref. [A2, A8, A17]). Preliminary modeling indicates that
unintended miss vectors (∥en∥2 > 11 in) crossing opposing seam/tunnel planes inflate batter contact depth
error by 2.4 inches, whereas misses drifting toward the batter’s naturalswing_path_tilt plane suffer a42%
surge in barrel rate (Ref. [A2, A8, A11]).
2. Abstract 2 — Dynamic Arsenal Sequencing under Command Decay: An xLSTM and Causal
Collision Geometry Framework for Live Bullpen Optimization:Combines within-gamePitch Decay
andBlend+ / ArsenalFXrepertoire interaction modeling withxCTRL cluster widening after pitch 60 and an
xLSTM neural network (pitchpredict) ingesting live MLB/feed/live/diffPatch streams to output optimal
next-pitch sequences and automated bullpen reliever alerts backed by SHAP feature attributions and Traceable
Hybrid RAG provenance (Ref. [A8, A10, A11, A84]).
9
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
2 Phase 2: National Basketball Association — Possessional RAPM,
2026–27 CBA Apron Mechanics, and Trade Liquidity (ACRE)
2.1 Play-by-PlayLineupReconstructionandScorekeeper-UnbiasedPossessionState
Machine
Because the NBA does not expose an error-free public lineup stint feed for recent seasons, the basketball ingestion
pipeline reconstructs every 10-man floor unit from raw play-by-play event streams (playbyplayv3 via nba_api and
hoopR-nba-data via SportsDataverse) cross-referenced against game box scores, validating player stint intervals
to within< 0.5 seconds per game (Ref. [A18, A20, A21]).
Legacy basketball pipelines estimate possessions from aggregate box scores via the standard Dean Oliver estimator
(Ref. [A22]):
\POSShome = FGAhome−OREBhome + (TOhome +εTO) + 0.44·FTAhome (18)
Data audits demonstrate that scorekeeper bias—specifically the inflation of home steals, which forces a correspond-
ing phantom turnover (εTO > 0) onto the visiting team’s ledger—propagates upward bias into box-score possession
estimates for both teams (Ref. [A22]). To eliminate scorekeeper bias and stint-boundary apportionment distortion,
the platform implements a direct play-by-play possession state machine where a possession terminates only upon
a made field goal, defensive rebound, turnover, or final made free throw, collapsing multi-FTA foul sequences
into a single possession, excluding technical foul free throws from possession counts, and apportioning fractional
possession weights across mid-possession substitution stint boundaries (Ref. [A22, A23]).
2.2 Regularized Adjusted Plus-Minus (RAPM), Box-Prior IPM, and Extended E-
RAPM
Let P denote the total number of active NBA players andN denote the total number of unique 10-man stints
(≈ 30, 000–60, 000 stints over a multi-season window) (Ref. [A22, A24]). The sparse design matrixX∈ RN×(2P +1)
sets column 0 to 1.0 (baseline efficiency), columns1,...,P to +1 for offensive players on court (O-RAPM), and
columnsP + 1,..., 2P to−1 for defensive players on court (D-RAPM, so positiveβP +k signifies points prevented
per 100 possessions) (Ref. [A21, A23, A25]). Because rank(X TWX )≤ 2P− 1< 2P + 1, Ordinary Least Squares
is strictly singular; applying Tikhonov (ℓ2) regularization with possession weightsW = diag(w1,...,w N) and
penalty λ≈ 2900 yields the weighted RAPM estimator (Ref. [A22, A23, A24, A25, A26]):
ˆβRAPM = (X TWX +λI)−1X TWy (19)
To resolve four documented flaws in public RAPM implementations, the platform incorporates:
1. Dummy RAPM: Collapses all players below 250 possessions into a composite replacement-level offensive
and defensive dummy column rather than deleting low-minute columns, preserving exact 5-on-5 row sums
(Ref. [A25, A27]).
2. Box-Prior Impact Plus-Minus (IPM): Constructs an independent prior vectorβ0∈ R2P +1 using Ben
Taylor’s Box Creation (incorporating a volume-gated 3-point proficiency sigmoid in 3PA× 3P% floored at
zero), Offensive Load, and Shot-Zone-Adjusted eFG% Residual, solving ridge regression on the prior-adjusted
residuals y∗ = y−Xβ0 (Ref. [A21, A28]):
ˆβIPM = β0 + (X TWX +λI)−1X TW (y−Xβ0) (20)
3. Full Posterior Covariance:Reports player evaluations as posterior probability distributionsN ( ˆβi, Σpost,ii)
using Σpost = ˆσ2(X TWX +λI)−1 and possession-weighted offensive/defensive totals (Ref. [A22, A25]).
4. Extended RAPM (E-RAPM):Augments X with combinatorial synergy indicator columnsZ generated
viaC5,x =
(5
x
)
= 5!
x!(5−x)! forx∈{ 2, 3, 4, 5} (10 pairs, 10 trios, 5 quartets, 1 five-man unit per stint) with ridge
penalty λsyn >λ to isolate non-additive lineup synergy (Ref. [A21, A27]).
2.3 2026–27 NBA CBA 1st and 2nd Apron Algorithmic Rules Engine
Under the 2023 NBA–NBPA Collective Bargaining Agreement (CBA, Article VII) for the 2026–27 season (October
19, 2026 through June 19, 2027; trade deadline February 11, 2027), the Salary Cap is$164, 961, 000 ($165.0M),
10
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
Minimum Team Salary Floor (90%) is $148.5M, Luxury Tax Threshold (121.5%) is $200.4M, First Apron is
$209, 015, 000 ($209.0M), Second Apron is$221, 686, 000 ($221.7M), and the cap-indexed middle-tier trade match-
ing constant (“$7.5M” in 2023–24) scales under Art. VII §6(j)(1)(iv) to exactly$9, 095, 709 ($9.1M) (Ref. [A29,
A30, A31, A32]). The deterministic constraint solver enforces maximum incoming salarySin, max given outgoing
salary Sout =∑
j∈Osj and post-transaction payrollPpost (Ref. [A29, A32, A33]):
Sin, max(Sout,Ppost) =



(164, 961, 000−Ppre) +Sout + 100, 000 if Ppost < 164, 961, 000 (Under Cap Room)
2.00·Sout + 250, 000 if Ppost < 209, 015, 000 and Sout≤ 9, 095, 709
Sout + 9, 095, 709 if Ppost < 209, 015, 000 and 9, 095, 709<S out≤ 35, 200, 000
1.25·Sout + 250, 000 if Ppost < 209, 015, 000 and Sout > 35, 200, 000
1.00·Sout if 209, 015, 000≤Ppost < 221, 686, 000 (First Apron)
1.00·Sout subject to|O| = 1 if Ppost≥ 221, 686, 000 (Second Apron: No Aggregation)
(21)
2026–27 Payroll
Tier
Statutory
Level
Max Incoming
(Sin, max)
Exception & S&T
Access
Draft, Cash & Hard-
Cap Triggers
Under Salary
Cap (Floor:
$148.5M)
< $164, 961, 000
(Ref. [A29, A32])
Cap Room + $100 K
cushion (Ref. [A32])
Room MLE ( $9.4M,
3 yrs); forfeits Non-
Tax MLE & BAE
(Ref. [A31, A32])
No hard cap un-
less S&T acquired
(Ref. [A32])
Over Cap / Be-
low 1st Apron
(Tax: $200.4M)
$164.961M
to $209.015M
(Ref. [A29, A30,
A32])
Tier 1 ( ≤ $9.1M):
200% + $250 K; Tier
2 ( $9.1M–$35.2M):
+$9, 095, 709; Tier
3 ( > $35.2M):
125% + $250 K
(Ref. [A29, A32])
Non-Taxpayer MLE
($15.0M, 4 yrs), BAE
($5.5M, 2 yrs), TPE
+$250K (Ref. [A32])
Expanded matching
(Sin > Sout), Non-Tax
MLE, BAE, or S&T
hard-caps at 1st
Apron ( $209.015M)
(Ref. [A29, A32])
First Apron
Team
$209, 015, 000
to $221, 686, 000
(Ref. [A30, A32])
100% of outgoing
(dollar-for-dollar)
(Ref. [A29, A32])
Taxpayer MLE
($6.1M); no prior-yr
TPEs; no incoming
S&T; buyout ban
>MLE (Ref. [A31,
A32, A34])
Taxpayer MLE, ag-
gregating salaries,
or sending cash
hard-caps at 2nd
Apron ( $221.686M)
(Ref. [A32, A34])
Second Apron
Team
≥ $221, 686, 000
(Ref. [A30, A32])
100% of single outgo-
ing contract (zero ag-
gregation) (Ref. [A29,
A32])
Zero MLE access;
zero TPE access
(current or prior
year) (Ref. [A31, A32,
A34])
Zero cash out; 1st-rd
pick 7 yrs out (2034)
frozen; drops to end of
1st rd if ≥2nd Apron
in ≥ 2 of next 4 yrs
(Ref. [A31, A32, A34])
2.4 Trade Liquidity Index (TLI) and Apron-Constrained Roster Efficiency (ACRE)
Modeling the 30 NBA rosters as a directed hypergraphGtrade = (V,E) where hyperedgese∈E represent all valid
2-team and 3-team exchanges satisfying Art. VII §6 (including multi-player sub-transaction decomposability for
Second Apron teams and Art. VII §8 2-month re-aggregation locks) (Ref. [A29, A32, A33]), the Player Trade
Liquidity Index (TLIi∈ [0, 1]) and Apron-Constrained Roster Efficiency (ACREi) are formulated as (Ref. [A21,
A27, A31, A32, A35]):
TLIi(T ) = 1∑
T ′̸=T
∑
j∈T ′Vj
∑
T ′̸=T
∑
j∈T ′
∃e∈E:i∈OT ,j∈IT
Vj (22)
ACREi = ∆Winsi( ˆβIPM,i, ˆγsyn)
ci + ∆Tax(ci,P T ) +λliq(1−TLIi(T ))·ci + I(PT≥ 221.686M)· E[∆Vpick,t+7] (23)
3 Phase 3: National Hockey League — Optical Edge Tracking, Ex-
pected Goals (xG/GSAx), and fastRhockey Integration
11
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
3.1 Direct Ingestion of api-web.nhle.com/v1 and NHL Edge Optical Telemetry
Followingthedeprecationof statsapi.web.nhl.com, thehockeypipelineintegrates https://api-web.nhle.com/v1
and https://api.nhle.com/stats/restvia fastRhockeyv1.0.0(releasedAugust25, 2026)and sportsdataverse-py
(fastRhockey-nhl-data), providing 22 PWHL women’s hockey functions and 33 NHL Edge optical tracking
wrappers (Ref. [A20, A36, A37, A38, A39, A40, A41, A42, A43, A44, A45, A46]). Because seasonal roster stubs
(/v1/roster/{team}/{season}) occasionally omit active players (e.g., Oliver Ekman-Larsson on FLA 2023–24 or
KyleBurroughsonSJS2023–24), masterrostersareconstructedfromtheunionof /v1/gamecenter/{gameId}/boxscore
and shift-chart player IDs hydrated via/v1/player/{playerId}/landing (Ref. [A36, A38, A44, A47]).
Data Domain Direct api-web.nhle.com/v1
Path
fastRhockey v1.0.0 Extracted Telemetry
Game PBP &
Shifts
/v1/gamecenter/{gameId}/play-by-play,
/boxscore (Ref. [A36, A38])
nhl_game_feed(),
load_nhl_pbp()
(Ref. [A39, A43])
Coordinates (x,y ),
shooter/goalie IDs, shot
types, on-ice shift intervals
(Ref. [A38, A43]).
Skater Optical
(Edge)
/v1/edge/skater-shot-speed-detail/{id}/{s}/{t},
skater-shot-location-detail
(Ref. [A44])
nhl_edge_skater_detail()
(33 Edge funcs)
(Ref. [A39, A42,
A43])
Top shot speed, 90th-
% shot speed, bursts
> 20/22 mph, skating
distance (Ref. [A43, A44,
A45]).
Goalie Optical
(Edge)
/v1/edge/goalie-shot-location-detail/{id}/{s}/{t},
goalie-comparison/{id}/now
(Ref. [A44])
nhl_edge_goalie_save_percentage_detail()
(Ref. [A43])
High/mid/low-danger spa-
tial save %, crease depth &
recoverymetrics(Ref.[A43,
A44]).
Team Optical
(Edge)
/v1/edge/team-skating-speed-detail/{id}/{s}/{t},
team-shot-speed-detail
(Ref. [A44, A45])
nhl_edge_team_detail(),
..._shot_speed_detail()
(Ref. [A45, A46])
Team skating distance, OZ
possession time percentiles,
velocity distributions
(Ref. [A39, A44, A45]).
PWHL Women’s
Pro
HockeyTech / PWHL API feeds
(Ref. [A20, A39])
pwhl_pbp(),
load_pwhl_pbp()
(Ref. [A39])
Full PBP, skater/goalie
boxscores, transactions,
and xG parity (Ref. [A39,
A43]).
3.2 Expected Goals (xG), Goaltender GSAx, and 4-State Special Teams RAPM
Validated across 117, 179 clean shot attempts per season (after pruning3, 119 incomplete records from 120, 298
rows and removing behind-the-net shots|x| > 89 ft), the feature pipeline transposesarenaAdjustedXCord and
arenaAdjustedYCord onto +x (xstd =|xadj|, ystd = sign(xadj)·yadj), computes timeSinceLastEvent (∆t) and
speedFromLastEvent (vprior =∥pt− pt−1∥2/∆t), applies one-hot encoding to shotType, and joins NHL Edge
optical shot velocity with a hierarchical Bayesian shooter finishing random effectαshooter∼N (0,σ 2
fin) (Ref. [A39,
A44, A50, A51, A52, A53, A54, A55, A56]). Gradient-boosted trees (XGBoost, tree depth3–6, η = 0.1) achieve
validation ROC-AUC scores of0.78 to 0.82, and shot probabilities are aggregated into Goaltender Goals Saved
Above Expected (Ref. [A48, A49, A50, A51]):
GSAxg =
∑
i∈Sg
ˆxGi−
∑
i∈Sg
Goali (24)
Skater on-ice impact is decomposed via weighted ridge regression (RAPM_CF and RAPM_xG) into Even-Strength and
four Special Teams predictor states: Powerplay Offense, Powerplay Defense, Shorthanded Offense, and Short-
handed Defense (Ref. [A53]).
4 Phase 4: National Football League — Spatio-Temporal Tracking,
Disguise Entropy, and Draft Surplus Valuation
12
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
4.1 Big Data Bowl Coordinate Standardization and Continuous Spatio-Temporal
EPA (st-EPA)
Ingesting play-by-play and Next Gen Stats vianfl_data_py v0.3.3 (downcast=True reducing memory by∼ 30%)
and 10-Hz NFL Big Data Bowl tracking data (Ref. [A20, A57, A58, A59, A60, A61]), all left-moving plays
(playDirection == ’left’) across the120×53.333 yd surface are reflected to advance left-to-right (+x) (Ref. [A58]):
xstd = 120−x, y std = 160
3 −y, θ dir, std = (θdir + 180◦) mod 360◦, θ o, std = (θo + 180◦) mod 360◦ (25)
vx =s· sin
( π
180θdir, std
)
, v y =s· cos
( π
180θdir, std
)
(26)
Using a frame-level graph attention network over the 22-player state tensorSt∈ R22×10 at every 100 ms frame
t, Continuous Spatio-Temporal Expected Points (st-EPt) integrates target probability pt(r | St), completion
probability ˆCPt,r(St), and expected YAC densityft,r(y| St) (Ref. [A57, A59, A61]):
st-EPt =
5∑
r=1
pt(r| St)
[
ˆCPt,r(St)
∫
Y
E0(next_state(y))ft,r(y| St)dy + (1− ˆCPt,r(St))E0(inc)
]
, st-EPAt = st-EPt−EPtsnap
(27)
This partitions every passing play into Route/Protection Creation (∆st-EPAscheme = st-EPtthrow−EPtsnap), Ball-
in-Air Value (∆st-EPAair = st-EPtarrival− st-EPtthrow), and YAC/Tackling Execution (∆st-EPAYAC = EPfinal−
st-EPtarrival).
To quantify defensive disguise across theK = 7 canonical coverage shellsC ={C0,C1,C2,C2-Man,C3,C4,C6},
the pipeline computes Pre-Snap Shannon Disguise Entropy (Hsnap) attsnap and Pre-to-Post-Snap Kullback-Leibler
Deception Shock (DKL) betweent0 =tsnap− 0.5 s andt1 =tsnap + 1.5 s:
Hsnap(C| Stsnap) =−
7∑
k=1
p(ck| Stsnap) log2p(ck| Stsnap), D KL (P (C| St1)∥P (C| St0)) =
7∑
k=1
p(ck| St1) log2
(p(ck| St1)
p(ck| St0)
)
(28)
4.2 Fitzgerald-Spielberger Draft Surplus Curves vs. Legacy Valuation Models
In the NFL draft trade simulator, the expected surplus valueS(p) of draft slotp∈{ 1,..., 262} is the discounted
difference between expected on-field APY cap percentage and the 2011 CBA rookie wage scale cap hitCrookie(p,t )
(with future picks discounted byδ = 0.90k per year) (Ref. [A35, A62, A63, A64]):
S(p) =
4∑
t=1
γt−1 (E[APY%p,t]−Crookie(p,t )) (29)
Slot / Trade Case Jimmy
Johnson
Rich Hill
(Market)
Harvard
HSAC
Fitzgerald-
Spielberger
Surplus Interpreta-
tion
Pick #1(R1, P1) 3, 000 (100%) 1, 000 (100%) 494.6 (100%) 3, 000 (100%) High ceiling offset by
highest rookie cap hit
(Ref. [A62, A64]).
Pick #33(R2, P1) 580 (19.3%) 180 (18.0%) 175.2 (35.4%) 1, 228 (40.9%) Peak arbitrage: >
2× value vs. JJ/RH
(Ref. [A63, A64]).
Pick #65(R3, P1) 265 (8.8%) 78 (7.8%) 128.0 (25.9%) 885 (29.5%) Day 2 retains ∼ 30%
of Pick #1 surplus
(Ref. [A64]).
Pick #100(R3/R4) 104 (3.5%) 36 (3.6%) 95.5 (19.3%) 671 (22.4%) 6.4× higher relative
weight on FS than JJ
(Ref. [A64]).
13
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
Slot / Trade Case Jimmy
Johnson
Rich Hill
(Market)
Harvard
HSAC
Fitzgerald-
Spielberger
Surplus Interpreta-
tion
Pick #150(R5) 31 (1.0%) 12 (1.2%) 63.7 (12.9%) 461 (15.4%) Cheap depth con-
tracts yield pos-
itive tail surplus
(Ref. [A64]).
Pick #200(R6) 11 (0.4%) 5 (0.5%) 40.6 (8.2%) 315 (10.5%) Near-minimum wage
preserves 10.5% value
(Ref. [A64]).
Texans Trade-Up
(#3)
— +37% Tax
(547 base)
— +58% Tax
(4, 884 vs 3, 089)
Texans paid 58%
surplus tax for
Will Anderson Jr.
(Ref. [A64]).
Jets–Vikings Swap
(#14+#143 for
#23+#66+#86)
— — — Jets: 119 /
MIN: 184
Vikings gained +65
surplus units
(≡ Pick #53)
(Ref. [A62]).
Jamal Adams
Trade
— — — 7.0% Cap/Yr
Surrendered
3.34% + 1 .50% +
(3.53%·0.9)−(1.11%·
0.9) (Ref. [A62]).
5 Phase 5: Serverless DuckLake Architecture, Zero-Local-Download
Ingestion, and Traceable Hybrid RAG
5.1 The $0–$10/Month Serverless DuckLake Storage, Catalog, and Compute Topol-
ogy
To host659M+ play-by-play rows and optical tracking datasets at$0 to $10/month, the platform implements the
**DuckLake** architecture (ducklake.select) across three tiers (Ref. [A61, A65, A66, A67, A68]):
1. Columnar Storage Layer (Cloudflare R2):Stores immutable ZSTD-compressed Apache Parquet files on
R2 (10 GB free storage, 1M Class A writes/mo, 10M Class B reads/mo,$0/GB egress bandwidth), sorted
hierarchically by(season, game_id, team_id, player_id) with small row groups (ROW_GROUP_SIZE 32768
or 65536) and FLOAT32 downcasting so browser clients fetch kilobyte byte ranges via HTTPRange requests
and predicate pushdown (Ref. [A57, A60, A65, A66, A69, A70, A71, A76, A77]).
2. Transactional Metadata Catalog Layer (Neon Serverless Postgres / Cloudflare D1):Replaces slow
S3 Iceberg/Delta JSON manifest chains with a fast relational catalog on Neon Postgres or Cloudflare D1 (5
GB free SQLite storage, 100k writes/day free or 50M writes/mo on the$5 Workers Paid plan), completely
bypassing DuckDB’s single-writer file lock (Ref. [A65, A66, A67, A71, A78]).
3. Client-SideOLAP&EdgeComputeLayer(DuckDB-Wasm+CloudflarePages/Workers): Spawns
DuckDB-Wasm inside a browser Web Worker to query R2 Parquet files 10x faster than JS, feeding zero-copy
Apache Arrow tables to SvelteKit + WebGL/Canvas visualizations (Ref. [A65, A72, A73, A74, A75]). Zero-
local-download cloud-to-cloud ingestion runs inside GitHub Actions or Cloudflare Containers ($5/mo Workers
Paid plan: 375 vCPU-min, 25 GiB-hrs RAM, 30s–5min CPU execution, 10M pooled monthly requests) using
DuckDB httpfs to stream directly from SportsDataverse releases into R2, backed by a 3-tier anti-bot scraping
stack (python-mlb-statsapi / ESPN JSON→ curl_cffi TLS impersonation→ Camoufox / CF Browser
Rendering) (Ref. [A13, A19, A71, A79, A80, A81, A82, A83, A84, A85]).
4. Real-Time WebSocket Quota Mitigation: Production telemetry from October 10, 2026 demonstrates
that SQLite-backed Durable Objects on the Workers Free tier can triggerError 1101: Exceeded allowed
volume of requests in Durable Objects free tier after 1, 283, 610 raw incoming WebSocket events +
44 HTTP invocations (64, 224.5 billed requests under the 20:1 ratio, below the published 100k/day limit)
(Ref. [A86]). The platform mitigates this on the$0 tier by coalescing livediffPatch updates into 5-second
broadcasts over Supabase Realtime Broadcast (200 concurrent connections, 100 msgs/sec free) or by upgrading
to the $5/mo Workers Paid plan (Ref. [A71, A86, A87, A88, A89, A90, A91]).
14
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
5.2 Traceable Three-Path Hybrid RAG Architecture
To guarantee zero-hallucination legal and statistical synthesis at$0.00/month, the platform combines Dense Se-
mantic Retrieval via **Cloudflare Vectorize** (@cf/baai/bge-base-en-v1.5, 768-d, 5M dimensions free), Sparse
Lexical Retrieval via **Cloudflare D1 SQLite FTS5 BM25** (tokenize=’porter unicode61’ ), and Deterministic
**DuckLake Text-to-SQL** tool execution, merging dense (rvec) and sparse (rbm25) ranks via Reciprocal Rank
Fusion (k = 60) (Ref. [A13, A65, A66, A71, A90]):
RRF_Score(d) = 1
60 +rvec(d)+ 1
60 +rbm25(d), Provenance(d) =⟨doc_id,section_ref,r2_parquet_uri,snapshot_sha256,byte_range⟩
(30)
6 Comprehensive Bibliography & Source Directory
Series A: Multi-Sport Quantitative Analytics Platform & DuckLake Sources
[A1] Baumer, B., et al. Analyzing Baseball Data with R
(3e): Statcast. https://beanumber.github.io/abdwr3e/C_
statcast.html
[A2] MLB Advanced Media.Baseball Savant Statcast CSV Doc-
umentation (2026 ABS Update). https://baseballsavant.
mlb.com/csv-docs
[A3] Fast, M. (2007). Glossary of the Gameday Pitch
Fields. https://fastballs.wordpress.com/2007/08/02/
glossary-of-the-gameday-pitch-fields/
[A4] Sabermetrics Community. Statcast Vertical Break Mea-
surement. https://www.reddit.com/r/Sabermetrics/
comments/ih69ue/statcast_vertical_break_measurement/
[A5] Sabermetrics Community. Understanding pfx_z in Stat-
cast. https://www.reddit.com/r/Sabermetrics/comments/
nentrm/can_someone_explain_what_pfx_z_is_from/
[A6] Nestico, T. J. Creating the Perfect Pitching Sum-
mary. https://medium.com/@thomasjamesnestico/
creating-the-perfect-pitching-summary-7b8a981ef0c5
[A7] Kelly, J.Stuff-Model: 12-Model Stratified Pitching Architec-
ture. https://github.com/jack-kelly-12/Stuff-Model
[A8] SABR. 2026 SABR Analytics Conference Research Ab-
stracts (CGD & TrackMan xCTRL) . https://sabr.org/
analytics/2026-photos-2
[A9] GitHub Topics. pybaseball Open-Source Ecosystem. https:
//github.com/topics/pybaseball
[A10] Felton, T. D.Optuna LightGBM Stuff+ Modeling & Valida-
tion. https://tdfelton.github.io/
[A11] xCTRL: Quantifying Pitcher Intent and Execution via Gaus-
sian Mixture Models (2025). https://arxiv.org/html/
2508.19184v1
[A12] Prospects Live. Application of Stuff Models on
Triple-A Data . https://www.prospectslive.com/
an-introduction-to-the-application-of-stuff-models-on-triple-a-data/
[A13] Morishima, Y. Park Factors, OAA, and Stuff+ in
savant-extras v0.4.1 . https://dev.to/yasumorishima/
park-factors-oaa-and-stuff-in-one-line-of-python-savant-extras-v032-v041-2hnd
[A14] Paraball Notes (2026). Dollar Per WAR in 2025–2026
Free Agency . https://www.paraballnotes.com/blog/
dollar-per-war-2025-2026
[A15] SABR. 2027 SABR Analytics Conference Submission Guide-
lines. https://sabr.org/analytics
[A16] SABR. SABR 54 Call for Presentations. https://sabr.org/
latest/sabr-54-call-for-presentations/
[A17] SABR. 2025 SABR Analytics Conference Presentations .
https://sabr.org/analytics/presentations/2025
[A18] EdgeLab (2025). The Best Free Sports Data APIs:
A Developer’s Review . https://dev.to/edgelab/
the-best-free-sports-data-apis-in-2025-a-developers-practical-review-14j9
[A19] PyPI. python-mlb-statsapi v1.1.2 Documentation. https:
//pypi.org/project/python-mlb-statsapi/
[A20] Gilani, S., et al.The SportsDataverse GitHub Organization.
https://github.com/sportsdataverse
[A21] ClosingFive. Box-Prior Impact Plus-Minus (IPM) Method-
ology. https://closingfive.com/methodology
[A22] Auditing Scorekeeper Bias and Stint Apportionment in NBA
RAPM (2026). https://arxiv.org/html/2605.24056v1
[A23] Basketball Analytics.Open Source Data and RAPM Formu-
lation in the NBA. https://basketball-analytics.gitlab.
io/rapm-data/open-source-data-nba.pdf
[A24] Squared2020 (2017). Deep Dive on Regularized Adjusted
Plus-Minus I . https://squared2020.com/2017/09/18/
deep-dive-on-regularized-adjusted-plus-minus-i-introductory-example/
[A25] Squared2020 (2018). Regularized Adjusted Plus-
Minus Part III . https://squared2020.com/2018/12/24/
regularized-adjusted-plus-minus-part-iii-what-had-really-happened-was/
[A26] Annual Reviews of Statistics. Statistical Modeling
in Sports. https://www.annualreviews.org/doi/pdf/10.
1146/annurev-statistics-040720-015536
[A27] ResearchGate (2020). An Extended Regularized Adjusted
Plus-Minus (E-RAPM) Analysis for Lineup Management.
https://www.researchgate.net/publication/345490672
[A28] APBRmetrics Forum. Prior-Informed RAPM and Ridge
Shrinkage. https://apbr.org/metrics/viewtopic.php?t=
9844
[A29] OverTheApron. NBA CBA Salary Matching
Rules (2026–27) . https://overtheapron.com/terms/
salary-matching
[A30] ArmchairGM. NBA First and Second Tax Aprons Guide.
https://armchairgm.io/guides/nba-first-second-tax-aprons
[A31] Seton Hall University Law Scholarship. 2023 NBA
CBA Apron Analysis . https://scholarship.shu.edu/
cgi/viewcontent.cgi?article=2683&context=student_
scholarship
[A32] Fanspo. 2026–27 NBA Trade Machine Rules & Thresholds.
https://fanspo.com/nba/trade-machine/rules
[A33] NBA CBA Analysis. Specific Rules Around 2nd
Apron Aggregation . https://www.reddit.com/r/nba/
comments/1g0mdwh/what_are_the_specific_rules_around_
2nd_apron/
[A34] NBA CBA Analysis. How the NBA Apron Sys-
tem Works. https://www.reddit.com/r/nba/comments/
1jjnjhl/eli5_how_does_the_apron_system_work/
[A35] Wharton Sports Analytics. NBA & NFL Draft Value
Curves. https://wsb.wharton.upenn.edu/wp-content/
uploads/2024/12/NBA_draft_curves-6.pdf
[A36] Svoboda, J. NHL API Client Documentation. https://
github.com/jakubsvobodacz/nhl-api-client/blob/main/
README.md
[A37] Zmalski. NHL-API-Reference (api-web.nhle.com/v1) .
https://github.com/Zmalski/NHL-API-Reference
15
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
[A38] Tashlikovich, V. NHL API: What Data Is Exposed and
How to Analyse It. https://medium.com/@vtashlikovich/
nhl-api-what-data-is-exposed-and-how-to-analyse-it-with-python-745fcd6838c2
[A39] Gilani, S., et al. fastRhockey v1.0.0 CRAN Release
Notes. https://fastrhockey.sportsdataverse.org/news/
index.html
[A40] R-Universe. fastRhockey Package Repository. https://
sportsdataverse.r-universe.dev/fastRhockey
[A41] SportsDataverse. sportsdataverse-py Python Package .
https://github.com/sportsdataverse/sportsdataverse-py
[A42] CRAN. fastRhockey v1.0.0 Reference Manual. https://
cran.r-project.org/web/packages/fastRhockey/readme/
README.html
[A43] GitHub. sportsdataverse/fastRhockey Source Repository.
https://github.com/sportsdataverse/fastRhockey
[A44] Zmalski. NHL Edge Endpoints in api-web.nhle.com/v1
(Issue #69) . https://github.com/Zmalski/
NHL-API-Reference/issues/69
[A45] fastRhockey. nhl_edge_team_shot_speed_detail.R Im-
plementation. https://github.com/sportsdataverse/
fastRhockey/blob/main/R/nhl_edge_team_shot_speed_
detail.R
[A46] rdrr.io. nhl_edge_team_detail Documentation. https:
//rdrr.io/cran/fastRhockey/man/nhl_edge_team_detail.
html
[A47] Hockey Analytics Community. NHL API Roster Endpoint
Caveats. https://www.reddit.com/r/hockey/comments/
1njsyxs/nhl_api/
[A48] Reign Creative. Expected Goals (xG) and GSAx
in Hockey . https://reigncreativellc.com/blog/
what-is-expected-goals-in-hockey/
[A49] NHL Hockey Betting Tips.Goalie GSAx Evaluation. https:
//nhlhockeybettingtips.com/goalies/
[A50] MetricGate. Expected Goals (xG) with XGBoost. https:
//metricgate.com/docs/expected-goals-xg-xgboost/
[A51] Sofianakos, N. NHL Expected Goals (xG) Model
Engineering. https://medium.com/@nsofianakos/
nhl-expected-goals-xg-model-39bd2edba932
[A52] PMC. Spatio-Temporal Features in Ice Hockey Shot
Modeling. https://pmc.ncbi.nlm.nih.gov/articles/
PMC11524524/
[A53] Evolving-Hockey. Reviving Regularized Adjusted Plus-
Minus for Hockey. https://evolving-hockey.com/blog/
reviving-regularized-adjusted-plus-minus-for-hockey/
[A54] Spatial Shot Quality in Ice Hockey(2025). https://arxiv.
org/html/2512.00203v2
[A55] Hierarchical Bayesian Shooter Finishing Effects in Hockey
xG (2025). https://arxiv.org/html/2511.23072v1
[A56] Aalto University. Machine Learning Models for Ice
Hockey xG . https://aaltodoc.aalto.fi/bitstreams/
ea245658-fc00-4f84-97ca-1959b5da154a/download
[A57] PyPI. nfl-data-py v0.3.3 Documentation. https://pypi.
org/project/nfl-data-py/
[A58] SMU Data Science Review. NFL Big Data
Bowl Coordinate Standardization . https://scholar.
smu.edu/cgi/viewcontent.cgi?article=1249&context=
datasciencereview
[A59] UC eScholarship. Spatio-Temporal Tracking
Analysis in Professional Football . https://
escholarship.org/content/qt5qw5382d/qt5qw5382d_
noSplash_983c1629d166d6b046b4a2d65e75e816.pdf
[A60] DuckDB Documentation. Cloudflare R2 Import & S3 Com-
patibility. https://duckdb.org/docs/2.0/guides/network_
cloud_storage/cloudflare_r2_import
[A61] SportsDataverse. Open-Source Sports Data Portal. https:
//www.sportsdataverse.org/
[A62] OpenSourceFootball(2023). NFL Draft Value Chart & Sur-
plus Analysis. https://opensourcefootball.com/posts/
2023-02-23-nfl-draft-value-chart/
[A63] PickSwap. NFL Draft Value Charts (JJ, Rich Hill, HSAC,
FS). https://pickswapapp.com/draft-value-charts.html
[A64] A to Z Sports. Assessing NFL Draft Pick
Exchanges with Fitzgerald-Spielberger and Rich
Hill Charts . https://atozsports.com/nfl-draft/
two-best-most-accurate-nfl-draft-trade-value-charts-assessing-pick-exchanges/
[A65] Blankenship, G. Cloudflare Free & Paid Developer Tier
Architecture. https://gist.github.com/garyblankenship/
27a4c57eca4aa5d659ee3c509668b66d
[A66] DuckLake. DuckLake Specification and FAQ. https://
ducklake.select/faq
[A67] Tobilg. The Age of $10-a-Month Lakehouses
(DuckLake + R2) . https://tobilg.com/posts/
the-age-of-10-dollar-a-month-lakehouses/
[A68] Hacker News. DuckLake Architecture Discussion. https:
//news.ycombinator.com/item?id=47761997
[A69] DuckDB v1.5 Docs. Cloudflare R2 Storage Inte-
gration. https://duckdb.org/docs/1.5/guides/network_
cloud_storage/cloudflare_r2_import
[A70] BlazingCDN. Cloudflare Pricing for Developers: Work-
ers, Pages & R2. https://blog.blazingcdn.com/en-us/
cloudflares-pricing-for-developers-a-closer-look-at-workers-pages
[A71] NateCue. Cloudflare Workers Paid $5 Plan Limits
& Containers. https://www.natecue.com/en/learn/tech/
cloudflare-workers-paid-5-dollar-plan/
[A72] Casper, M. duckdb-query-r2 Reference Implementation .
https://github.com/casperm/duckdb-query-r2
[A73] Hacker News. DuckDB-Wasm In-Browser Analytics Bench-
marks. https://news.ycombinator.com/item?id=34741195
[A74] DuckDB Docs. httpfs and S3 API Extension . https:
//duckdb.org/docs/2.0/core_extensions/httpfs/s3api
[A75] Hacker News. Zero-Copy Arrow and DuckDB Streaming.
https://news.ycombinator.com/item?id=48553388
[A76] DuckDB LTS Docs. Parquet Row Group Size & Predi-
cate Pushdown Tips. https://duckdb.org/docs/lts/data/
parquet/tips
[A77] StackOverflow. Predicate Pushdown in DuckDB over HTTP
Range Requests. https://stackoverflow.com/questions/
76696239/predicate-pushdown-in-duckdb-for-a-parquet-file-in-s3
[A78] Hacker News. DuckDB Concurrency & Single-Writer Pat-
terns. https://news.ycombinator.com/item?id=40864091
[A79] Clay.fyi. Cheap Lakehouses with Parquet,
DuckDB, and R2 . https://clay.fyi/blog/
cheap-opentelemetry-lakehouses-parquet-duckdb-iceberg/
[A80] Gilani, S. fastRhockey Data Engineering Notes. https:
//www.saiemgilani.com/notes/fastrhockey
[A81] VHub Systems (2026). Web Scraping Tools Com-
parison 2026: curl_cffi vs Camoufox vs Play-
wright. https://dev.to/vhub_systems_ed5641f65d59/
web-scraping-tools-comparison-2026-requests-vs-curlcffi-vs-playwright-vs-scrapy-2fad
[A82] PublicAPIs. ESPN Sports API Documentation. https:
//publicapis.io/espn-sports-api
[A83] Pseudo-R. Public-ESPN-API Reference. https://github.
com/pseudo-r/Public-ESPN-API
[A84] ToddRob99. MLB-StatsAPI Endpoints Wiki (diff-
Patch). https://github.com/toddrob99/MLB-StatsAPI/
wiki/Endpoints
[A85] Hockey Community. CapWages and PuckPedia Cap
Data Sources . https://www.reddit.com/r/hockey/
comments/1e1va2j/capwages_looking_like_its_going_to_
be_a_good_alt/
[A86] Cloudflare Community (Oct 2026). Durable Objects
Free Quota Block Below 100k After WebSocket 20:1
Adjustment. https://community.cloudflare.com/t/
durable-objects-free-quota-block-below-100k-after-websocket-20-1-adjustment/
967650
[A87] AI Agency Plus. Supabase Free Tier Realtime Limits.
https://aiagencyplus.com/supabase-free-tier-limits/
[A88] Ably. Supabase Realtime vs Managed WebSockets. https:
//ably.com/compare/supabase-vs-twilio
[A89] RapidDevelopers. Supabase Broadcast Debouncing Architec-
ture. https://www.rapidevelopers.com/lovable-prompts/
lovable-prompts-for-building-chat-application
16
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
[A90] Cloudflare Developers. Workers Platform Limits (CPU,
Memory, Bundles). https://developers.cloudflare.com/
workers/platform/limits/
[A91] Shattered.io (2026). Cloudflare Workers vs Fastly
Compute Pricing 2026 . https://shattered.io/
cloudflare-workers-vs-fastly-compute-pricing-2026/
Series B: Baseball Latent State-Space, Park Factor, and Projection Literature
[B1] PROMPT_continue_contact_quality.md (Internal State-
Space Contact Quality Specification).
[B2] PROMPT_research_park_babip.md (Internal Component Park
Factor & BABIP Audit).
[B3] BLOCKED_ON_USER.md / Chadwick Bureau Baseball Register:
https://github.com/chadwickbureau/register
[B4] Improving Player Projections.md (Pitcher Kinematics,
Censoring & Convex Valuation).
[B5] PROMPT_claude_modeling_round3.md (VectorSSM Multivari-
ate State-Space Formulation).
[B6] PROMPT_claude_continue.md (MiLB Translation & WAR Re-
placement Accounting).
[B7] PROMPT_glm_agent_round3.md & Tango, T. (2004). Marcel
the Monkey Forecasting System. http://www.tangotiger.
net/marcel/
[B8] Jensen, S. T., Shirley, K. E., & Wyner, A. J. (2009) / Brown,
L. D. (2008). Hierarchical Bayesian Modeling of Hitting.
https://arxiv.org/html/0902.1360v1
[B9] MLB Glossary. Steamer Projection System. https://www.
mlb.com/glossary/projection-systems/steamer
[B10] FanGraphs Prep. Build and Test Your Own
Projection System . https://blogs.fangraphs.com/
fangraphs-prep-build-and-test-your-own-projection-system/
[B11] FanGraphs Library. Projection Systems Principles. https:
//library.fangraphs.com/principles/projections/
[B12] Chapman University Digital Commons. Novel Sta-
tistical and ML Methods for Forecasting . https:
//digitalcommons.chapman.edu/cgi/viewcontent.cgi?
article=1010&context=cads_dissertations
[B13] FanGraphs. Where ZiPS and Steamer Disagree. https://
blogs.fangraphs.com/where-zips-and-steamer-disagree/
[B14] Pitcher List. Fantasy 101: Projections and Benchmarks.
https://pitcherlist.com/fantasy-101-projections-and-benchmarks/
[B15] FanGraphs Prep. Regression Towards the Mean. https://
blogs.fangraphs.com/fangraphs-prep-regression-towards-the-mean/
[B16] Szymborski, D. (2014). 10 Lessons I Have Learned About
Creating a Projection System. https://tht.fangraphs.com/
10-lessons-i-have-learned-about-creating-a-projection-system/
[B17] Szymborski, D. 2023 ZiPS Projections: At-
lanta Braves . https://blogs.fangraphs.com/
2023-zips-projections-atlanta-braves/
[B18] Szymborski, D. ZiPS zStats for Hitters at
the Midpoint . https://blogs.fangraphs.com/
zips-zstats-for-hitters-at-the-midpoint/
[B19] Szymborski, D. The 2022 ZiPS Projections
Are Coming! . https://blogs.fangraphs.com/
the-2022-zips-projections-are-coming/
[B20] Szymborski, D. Hitter zStats Entering the Homestretch,
Part 1 (Validation) . https://blogs.fangraphs.com/
hitter-zstats-entering-the-homestretch-part-1-validation/
[B21] Szymborski, D. zStats for Hitters, June Update. https://
blogs.fangraphs.com/zstats-for-hitters-june-update/
[B22] Wikipedia. PECOTA. https://en.wikipedia.org/wiki/
PECOTA
[B23] SportsPundit. Player Empirical Comparison and Optimiza-
tion Test Algorithm. https://sportspundit.com/baseball/
terms/2180-player-empirical-comparison-and-optimization-test-algorithm/
[B24] CalState ScholarWorks. Simulation-Based Projections for
Baseball Statistics. https://scholarworks.calstate.edu/
downloads/8p58pg38j
[B25] Silver, N. Baseball Prospectus Basics: The Science of
Forecasting. https://www.baseballprospectus.com/news/
article/2659/baseball-prospectus-basics-the-science-of-forecasting/
[B26] Baseball Prospectus. 10-Year Projections, UP-
SIDE, Percentiles and Comparables . https:
//www.baseballprospectus.com/news/article/23016/
baseball-prospectus-news-10-year-projections-upside-percentiles-and-comparables/
[B27] Baseball Prospectus. Glossary: PECOTA. https://legacy.
baseballprospectus.com/glossary/?context=6&category=
true
[B28] Baseball Prospectus (2025). PECOTA 2025: An In-
troduction. https://www.baseballprospectus.com/news/
article/96300/pecota-week-pecota-2025-an-introduction/
[B29] Baseball Prospectus. Reintroducing PECOTA: The Seven
Percent Solution. https://www.baseballprospectus.com/
news/article/12133/reintroducing-pecota-the-seven-percent-solution/
[B30] FantasyPros (2026).Most Accurate Fantasy Baseball Projec-
tions (2025 Results). https://www.fantasypros.com/2026/
02/most-accurate-fantasy-baseball-projections-2025-results/
[B31] Carty, D. THE BAT X Projections! THE BAT
plus Statcast . https://rotogrinders.com/pages/
the-bat-x-projections-the-bat-plus-statcast-3361569
[B32] Carty, D. Introducing THE BAT X . https://fantasy.
fangraphs.com/introducing-the-bat-x/
[B33] SoxMachine (2026). A Look at THE BAT X
2026 Projections . https://soxmachine.com/2026/01/
a-look-at-the-bat-x-2026-chicago-white-sox-projections
[B34] RotoGrinders. THE BAT X Projection System by Derek
Carty. https://rotogrinders.com/the-bat
[B35] Carty, D. Introducing THE BAT X for Pitchers and THE
BATcast Stuff Model . https://blogs.fangraphs.com/
introducing-the-bat-x-for-pitchers-and-the-batcast-stuff-model/
[B36] FanGraphs. New Hitter xBABIP Based on BIS
Batted Ball Data . https://fantasy.fangraphs.com/
new-hitter-xbabip-based-on-bis-batted-ball-data/
[B37] Carleton, R. A. / Birdland Metrics. A Guide to Statisti-
cal Stabilization and Regression. https://birdlandmetrics.
com/articles/stabilization-regression
[B38] FanGraphs. Giancarlo Stanton Is Putting on a
Fireworks Show . https://blogs.fangraphs.com/
giancarlo-stanton-is-putting-on-a-fireworks-show/
[B39] FanGraphs. You Can’t Fake Exit Velocity. https://blogs.
fangraphs.com/you-cant-fake-exit-velocity/
[B40] PROMPT_glm_agent.md (MLB Stats API MiLB Ingestion &
Savant FRV Protocol).
[B41] Birdland Metrics. The Pete Alonso Effect . https://
birdlandmetrics.com/articles/pete-alonso-impact
[B42] FanGraphs. Musings at the Intersection of Launch Angle
Consistency and Hard-Hit Rate. https://blogs.fangraphs.
com/musings-at-the-intersection-of-launch-angle-consistency-and-hard-hit-rate/
[B43] Chamberlain, A. Let’s Talk About Launch An-
gle Tightness . https://fantasy.fangraphs.com/
lets-talk-about-launch-angle-tightness/
[B44] Pitcher List. Hitting with a TON of Authority. https:
//pitcherlist.com/hitting-with-a-ton-of-authority/
[B45] SABR Journal. The Many Flavors of DIPS: A History
and an Overview . https://sabr.org/journal/article/
the-many-flavors-of-dips-a-history-and-an-overview/
[B46] Appelman, D. Park Factors Added to Fan-
Graphs Guts! . https://blogs.fangraphs.com/
park-factors-added-to-fangraphs-guts/
[B47] Sabermetrics Community. Graded MLB Projection Model.
https://www.reddit.com/r/Sabermetrics/comments/
1uisrj9/built_a_public_graded_mlb_projection_model/
17
Multi-Sport Quantitative Analytics Platform & State-Space BlueprintArchitectural & Mathematical Specification
[B48] Taylor & Francis (2018). Machine Learning Ap-
plications in Baseball: A Systematic Literature Re-
view. https://www.tandfonline.com/doi/pdf/10.1080/
08839514.2018.1442991
[B49] Grokipedia. Adjusted Batting Average . https://
grokipedia.com/page/adjusted_batting_average
[B50] Baseball Community.fWAR Comparisons and Park Adjust-
ments. https://www.reddit.com/r/baseball/comments/
1n074j9/nick_kurtz_and_juan_soto_both_have_the_same_
fwar/
[B51] FanGraphs. 2013 Park Factors Updated. https://blogs.
fangraphs.com/2013-park-factors-updated/
[B52] Albert, J., et al.Handbook of Statistical Methods and Analy-
ses in Sports. https://api.pageplace.de/preview/DT0400.
9781498737371_A30123636/preview-9781498737371_
A30123636.pdf
[B53] Mitchell, C. (2015).KATOH: Forecasting Major League Hit-
ting with Minor League Stats. https://tht.fangraphs.com/
katoh-forecasting-a-hitters-major-league-performance-with-minor-league-stats/
[B54] Wikipedia. Clay Davenport. https://en.wikipedia.org/
wiki/Clay_Davenport
[B55] Baseball Wiki. Baseball Prospectus. https://baseball.
fandom.com/wiki/Baseball_Prospectus
[B56] Davenport, C. DTs vs. MLEs - A Validation Study .
https://www.baseballprospectus.com/news/article/49/
dts-vs-mles-a-validation-study/
[B57] Mitchell, C. A Primer on a New and Im-
proved KATOH . https://blogs.fangraphs.com/
a-primer-on-a-new-and-improved-katoh/
[B58] Mitchell, C. FanGraphs Community Research Archive .
https://community.fangraphs.com/author/mitchell/
page/2/
[B59] Kalman, R. E. (1960) / MDPI (2025).State-Space Systems
& Uncertainty-Aware Forecasting. https://www.mdpi.com/
2078-2489/16/12/1016
[B60] ROUND4_STEPS.md (Adaptive Gaussian Comps Kernel & Role-
Split RAR Specification).
[B61] Sarris, E., & Bay, M. Stuff+, Location+, and Pitch-
ing+ Primer. https://library.fangraphs.com/pitching/
stuff-location-and-pitching-primer/
[B62] FanGraphs. PitchingBot and Stuff+ Pitch Model-
ing on FanGraphs . https://blogs.fangraphs.com/
pitchingbot-and-stuff-pitch-modeling-are-now-on-fangraphs/
[B63] FanGraphs. Minors to the Majors: Calculating Indi-
vidual Pitch Grades . https://fantasy.fangraphs.com/
minors-to-the-majors-calculating-individual-pitch-grades/
[B64] Szymborski, D. Pitcher zStats Entering the Homestretch,
Part 1 (Validation) . https://blogs.fangraphs.com/
pitcher-zstats-entering-the-homestretch-part-1-validation/
[B65] Appelman, D. (2016). Park Factors - 5
Year Regressed . https://library.fangraphs.com/
park-factors-5-year-regressed/
[B66] Morris, C. N. (1983).Parametric Empirical Bayes Inference:
Theory and Applications. https://www.researchgate.net/
profile/Carl-Morris-3
[B67] Jensen, S. T., et al. (2009). Hierarchical Bayesian
Modeling of Hitting Performance in Baseball . https:
//faculty.wharton.upenn.edu/wp-content/uploads/2009/
11/Shanejensen.traj09.pdf
[B68] Klinger, T. State-Space Parameter Estimation and Co-
variance Filtering. https://dgk.badw.de/fileadmin/user_
upload/Files/DGK/docs/c-787.pdf
18