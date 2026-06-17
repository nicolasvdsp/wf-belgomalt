// ============================================
// JOURNEY MAP
// ============================================
// A multi-step "story map" that auto-plays through the geographic journey of
// a beer's ingredients across waypoints on a Mapbox GL JS map. Stories
// advance Instagram-style: an active progress bar fills left → right while
// the corresponding line segment draws itself in across the map. Past steps
// keep their lines drawn; future steps stay empty. Navigating backwards
// smoothly undraws the lines (and drains the bars) of any newly-future
// steps.
//
// PHASE STATUS (current: phase 4 — unlock overlay)
//   Phase 1 ✅  map init, pins, polyline with bezier fallback, dark style.
//   Phase 2 ✅  progress bar, content card, click navigation, locked %.
//   Phase 3 ✅  auto-play, per-step progress, draw/undraw on navigation.
//   Phase 4 ✅  unlock overlay + journey-unlock netlify fn.
//   Phase 5 ⏳  CMS wiring + sync worker emitting precomputed polylines.
//
// ────────────────────────────────────────────────────────────────────────────
// PLAYBACK MODEL
//
// Each step carries a `progress` value 0..1 which drives BOTH:
//   • the progress-bar segment's fill   (via `--progress` CSS var)
//   • the line segment from step N-1 → step N (via `line-trim-offset`)
//
// Auto-play loop (when a step becomes active):
//   1. If the step has any prior progress (revisit), it smoothly drains down
//      to 0 over `transitionDuration` ms (ease-in-out) — visible undraw of
//      the incoming line + bar.
//   2. Then it plays linearly 0 → 1 over `storyDuration` ms (Instagram feel).
//   3. On completion, auto-advance to the next unlocked step.
//
// In parallel, every OTHER step smoothly animates to its target:
//   • order < activeOrder  → target 1   (past — line stays drawn)
//   • order > activeOrder  → target 0   (future — line stays absent)
//
// Clicking a (non-locked) progress segment or pin re-triggers this for the
// chosen step, which is how the "undraw on back-navigation" effect emerges
// naturally from the same machinery.
//
// ────────────────────────────────────────────────────────────────────────────
// DEPENDENCIES — add to Webflow page <head> (NOT bundled to keep main.js lean):
//   <link  rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v3.20.0/mapbox-gl.css">
//   <script src="https://api.mapbox.com/mapbox-gl-js/v3.20.0/mapbox-gl.js"></script>
//   <script>window.MAPBOX_TOKEN = "pk.your-public-url-restricted-token";</script>
//
// ────────────────────────────────────────────────────────────────────────────
// MARKUP CONTRACT — read inside `[data-journey-init]`. Optional unless noted.
//
//   <section data-journey-init data-journey-beer-slug="pilsen"
//            data-journey-data='{"v":1,"steps":[…]}'>
//
//     <!-- UNLOCK OVERLAY (optional — gates the entire map) -->
//     <!-- When present, the map is NOT initialised until the user enters a
//          valid expiry date. JS toggles between step 1 and step 2 via
//          display toggling on [data-journey-unlock-step]. -->
//     <div data-journey-overlay class="geography_overlay">
//       <div data-journey-unlock-step="1">
//         <!-- hero, heading, copy -->
//         <a class="ui-button">Start</a>
//       </div>
//       <div data-journey-unlock-step="2" style="display:none">
//         <div class="unlock_input-wrapper">
//           <input data-journey-date-digit="1" inputmode="numeric" maxlength="1">
//           <input data-journey-date-digit="2" inputmode="numeric" maxlength="1">
//           <!-- "/" separator -->
//           <input data-journey-date-digit="3" inputmode="numeric" maxlength="1">
//           <input data-journey-date-digit="4" inputmode="numeric" maxlength="1">
//         </div>
//         <div data-journey-overlay-error></div>
//       </div>
//     </div>
//
//     <div data-journey-map></div>                  (required) Mapbox canvas
//
//     <header data-journey-progress>                Progress bar wrapper.
//       <div data-progress-bar>             ONE template segment.
//         <div data-progress-fill>  Optional inner fill
//         </div>                                     (designer styles it
//         <div data-progress-icon>      relative to its parent).
//           <!-- lock icon -->                       JS clones the whole
//         </div>                                       segment once per step.
//       </div>                                       State value:
//                                                      "active" / "unlocked" / "locked"
//                                                    CSS variable per clone:
//                                                      --progress: 0..1
//       <svg data-icon-playstate="play"></svg>     Optional. The two icons
//       <svg data-icon-playstate="pause"></svg>    are clickable toggles;
//     </header>                                      clicking either flips
//                                                    the wrapper's
//                                                    data-journey-state and
//                                                    the matching SCSS rule
//                                                    hides whichever icon
//                                                    represents the current
//                                                    state.
//
//     <h3  data-journey-content="title"></h3>       Card slots — see table
//     <p   data-journey-content="story"></p>        below.
//     <img data-journey-content="image">
//     <div data-journey-content="name"></div>
//     <div data-journey-content="address"></div>
//     <a   data-dialog-open data-journey-content="dialog-trigger">Learn more</a>
//
//   </section>
//
//   <!-- Dialog template (sibling of the card, inside .section_geography) -->
//   <div data-dialog data-journey-dialog-template>
//     <aside data-dialog-panel>
//       <div data-journey-content="learn-more"></div>  (rich-text slot)
//       <div data-journey-content="address"></div>
//       …
//     </aside>
//   </div>
//   <!-- JS clones this template once per step, assigning data-dialog="j1" etc.
//        The template is hidden after cloning. -->
//
//   Content slot values (data-journey-content="…"):
//     title            textContent ← step.title
//     story | quote    innerHTML   ← step.quote || step.story
//     name  | author   textContent ← step.author.name
//     image | avatar   src         ← step.author.avatar     (on <img>)
//     address          innerHTML   ← step.address
//     dialog-trigger   sets data-dialog-open="j{order}" on the Learn more button
//     link|learn-more  innerHTML   ← step.learnMoreText   (rich text for dialog)
//
// ────────────────────────────────────────────────────────────────────────────
// STATE ON THE WRAPPER (read by CSS, written by JS):
//   data-journey-unlock-state="incomplete|complete"
//   data-journey-state="playing|paused"     Updated when a play/pause icon is clicked.
//
// CSS VARIABLES (set per progress segment):
//   --progress: 0..1     Drives left-to-right fill on the bar.
//                                  Inherits to any nested element, including
//                                  [data-progress-fill] which
//                                  the default SCSS scales horizontally.
//   --step-count: <int>          Total step count, set on the progress wrapper(s).
//
// CONFIG OVERRIDES — attributes on `[data-journey-init]` (all optional):
//   data-journey-token="pk.…"            Public token (else window.MAPBOX_TOKEN)
//   data-journey-style="mapbox://…"      Mapbox style URL override
//   data-journey-fit-padding="64"        Padding (px) when fitBounds() runs
//   data-journey-curvature="0.18"        Bezier perpendicular offset, 0–0.5
//   data-journey-line-color="#A8DC68"    Line stroke color
//   data-journey-line-width="2.5"        Line stroke width
//   data-journey-story-duration="5000"   ms per active story playback (auto-play)
//   data-journey-draw-path-duration="2000" ms for line draw (clamped to storyDuration)
//   data-journey-transition-duration="800" ms for non-active step transitions
//   data-journey-fly-duration="1800"     ms for flyTo on each step change
//   data-journey-autoplay="true|false"   Auto-advance on story complete (default true)
//   data-journey-active-order="1"        Which step starts active (default = first unlocked)
//
// BARBA — re-inits on `barba:afterEnter`, scoped to the incoming container.
// REDUCED MOTION — `(prefers-reduced-motion: reduce)` snaps progress directly
//   to targets (no per-step animation, no auto-advance timing).
// ============================================

const SELECTOR = '[data-journey-init]';
const INIT_FLAG = 'journeyInit'; // → dataset.journeyInit = 'initialized'
const journeyInstances = new Set();

const DEFAULTS = {
  mapStyle: 'mapbox://styles/mapbox/dark-v11',
  // Belgium-ish viewport bounds — keeps the map locked to a meaningful frame
  // even if the user pans/zooms. SW corner, then NE corner: [lon, lat].
  maxBounds: [
    [2.0, 49.4],
    [6.6, 51.7]
  ],
  minZoom: 6,
  maxZoom: 100,
  fitPadding: 64,
  curvature: 0.18,
  bezierSamples: 64,
  lineColor: '#A8DC68',
  lineWidth: 2.5,
  storyDuration: 7000,
  drawPathDuration: 3000,
  transitionDuration: 800,
  flyDuration: 1800,
  autoplay: true,
  cooperativeGestures: false
};

// Fixture rendered when no `data-journey-data` is provided and no unlock
// overlay is present. All steps are fully populated for demo purposes.
// FIXTURE_DATE is the MM/YY that unlocks the fixture in demo mode (no slug).
const FIXTURE_DATE = '05/29';
const FIXTURE_FALLBACK = {
  v: 1,
  steps: [
    {
      order: 1,
      title: 'Barley grown on Belgian regenerative farms committed to healthier soils.',
      story: '',
      quote: '',
      author: { name: 'Étienne Allard', avatar: '' },
      date: 'Feb 20, 2026',
      address: 'Ferme des Warelles<br>Zwarte Vogelstraat 15, 7850 Edingen',
      learnMoreText: '<h2>Etienne Allard is one of our more than 100 Belgian farmers who is growing brewing barley for the Pure Local programme.</h2><p>He applies progressive farming practices that restore soil health, support biodiversity, and store atmospheric CO₂ in the soil. Etienne is very proud that his grains are used to brew some of the most prestigious Belgian beers. Cheers to Etienne—and cheers to our Belgian brewing culture!</p>',
      lat: 50.2929,
      lon: 5.0944, // Ciney
      // Ciney → Cultivae (50.5 km driving)
      lineToNext: 'wz}qHe}a^KSS]OWq@oACEGMIMU[KSWc@mA{BkAyBEIGKy@yAwAgCGKIMo@kAq@mAIOGE][]UUOk@e@eA}@_@[OKQMAECECCEAO[m@cAO[KUIQEMEe@k@?S?C?S?wB@}@?wBDc@Dk@PODGBIDMFiDfBc@V[Ne@LQAGGIEIAGBIHGLCPSXKHQPMLGB??k@ZgDdBwAt@gGbDgGbDcBx@a@DSBg@?m@KcB_@o@OyBg@c@K_@Ky@[qBw@eGwBeBm@iBi@{FmByC}@qF}AsJiCoEeA}A[a@I[IcBa@}AYuE}@q@MUEkAUUEaAOaGaAIA}AWaDe@cDe@cBIqAEwA@cBHw@H_@BaAHi@DwBTE?e@DM\\Sj@a@pA]bA_@pA_@lA_@zAMh@Mh@c@bBUx@c@nAQh@y@bBaEvJeEjJq@vAy@hBe@`AoBbEyBnE}FhLkC~EmC~EwEnIgBzCiBxCi@`AYb@sErH_AvAoInMe@t@}KvOkBhC}ApBwGtIuGnIgJnLoDrEkChDuAdBY\\g@p@cCxC_GrHiDrEkGrIsDtF{@tACBeDpFoAvBqA~BeB`D]r@a@v@kEvIaEbJoF~MqBpFmBtFe@vAyB`HCFKZGTELENqCtJeApD_@rASr@}AnFg@fBmIzYi@lB_GpS}ArFyB|H[fAcI`YoB~GuEfP{DpNqBtHqBvHkBxHiBzHi@`CkCxLwBfKy@~DA@WnAy@bEMl@On@e@bC[vAy@dEABwEfUwDfRq@~CUhA_@bByAdFe@rAsAlD}AdDw@xAqDjGaEbH_@n@qBhDw@rAMTiCpEkCrEoBpD}@~Am@bA}DjHE@QDqDrFsApBiCnDy@jAeChDaBxBsA`BkBpBkAlAo@l@a@^cG~EYPu@~@aHvFmC~BuDnDqCvCyCdD}CtD}CzDqC`EkCfE_DpFmBvDoBpE}BvFkBrFwA|EyAlFoDdN{AfF_B`FiBxEuBtEyBxDeCvDiCdD_DfDkC~BaDxBuAv@mAr@{CxAiDnA_DhAkD`AcDx@cDr@iDv@oMrCiCj@iTvE_JxBoDbAoDjAkDpA}CpAiD~AkDfB{Az@wBpAuBnAaDvBcD~B}C`C}CdCqR|O}HlG_F|DsHxFwIhGaAp@cC~AiDxBeEjC_@RoG|DyHvE_E`C_EbC}EvCkDrBm[jR_@Ts]pSoAt@}EpC_FvCeNhIqCdB{FhDqElC}OvJaErCmEbDeGbFuAlAqDhD_F~EuGxGwJ`K}HdI}G~GuGlGgCxB_DjCgBvAwCtBmBrAu@d@}@j@cBdAmBdAuBhA{BhAsB`A}B`AmBt@kBp@}E`ByDhAaCn@}Bh@_Ez@wB`@{B`@mF~@kGdAoLnBuGjAkBXw@Ly@NsATsU|DaHhAcEv@oFfA}Ct@iD|@cDbAgA\\aC|@kCdAyCvA}BjAqBhA}A~@iChBeCfB}BjBeCvB}BxBqBtBaChCqBbCyBpCmBlCsB|CoB|CsBhDmBfDgB~CgBfDoEnIo^ds@_DfGqCpFaItO_GbLmA|Bg@~@oNjXyG`MyCnFuGbLgB~CqF|IkFnIwBhDeHrKuNvSqHdKsJfM}HxJ_KxLeKlLeK`LqKzKwKtK{KlK_LrKwKpKuGtGiGnGiGzGiG~GcG|GgFdGgI~JiEpFwFnH_C`DoHzJgJjMszA`tB{P|UsHjK}@j@y@v@s@TWDYCSIOMOSOYKa@Ea@AU?A?[@]B]Fc@Le@Z}@N[HBJAFCFODOAOAQEMIGICmD{E_@c@yAkB_@g@k@y@sAkBcAuAmFsHkEgGmBmCIM{@kAu@eAW_@oLiPEGcGmIoKcO}@mAOUyDoF??UYM[CGKO[i@?C?C?EACACACAAAAAAAAC?C?A?OOMOOUKCEES[SWOS_CcDkCuD]e@CEoG_JqKeOlAcEHSxAiER_@LITCv@P|@Jn@PAi@AkAe@gA?KtD{IGM_O{YwC_G'
    },
    {
      order: 2,
      title: 'The place where the grains were stored.',
      story: '',
      quote: '',
      author: { name: 'Cultivae', avatar: '' },
      date: 'Feb 30, 2026',
      address: 'Rue du Buisson 19, 1360 Perwez',
      learnMoreText: '<h2>Cultivae is the cooperative behind more than 100 Pure Local barley farmers.</h2><p>They receive the grains once they are harvested, store them for a few months, then clean and deliver them to the malthouse to be transformed into malt.</p><p>Cultivae is not just a typical cooperative—they stand out through their strong support for the transition from conventional to regenerative farming. They actively advise farmers on how to support nature through their farming practices.</p>',
      lat: 50.644026,
      lon: 4.797971, // Cultivae
      // Cultivae → Boortmalt Herent (42.3 km driving)
      lineToNext: 'gibtHsfh\\iBsD_CyEeBiDYq@{CdBuA~@kAxAsA~Ac@bA_BzC}C~FiBxEcLaPaE{F_Q_Va^ig@_FaHcE{FmVg]uC}DIM_Zya@_@w@Ia@@SCSEMIMCCQCODINGPAV@JA@MNMRi@l@qLjKyPhOqJtIiAfACBqSxQgCzByAtAqAjAuDfDCB}@x@wMnLi@d@s@n@aA|@UP_EpDi@f@MJIF??eDxCoAhA{@v@yDjDQPONsCjCEDe@`@}EfEEBML_Az@_BvAcCvBuChCwChCqG|FuAnAiCzBaBzAeBpAeKhHgM|IgM~IeD|BGD_DxB}HrFoE|CmE`D{AbAqLnIk@`@uJzGWNyA`AkBjAm`@|VwH`FmG|DaWbPa@Vk@\\iU`OoCpB_AdACB_B`CMPA@iDbFsMpRgBhCq@`AYb@Ub@ABu@`Bu@rBk@tBQt@Or@Gb@OpAKrAIpAGnAC`AAdA?xABzADpAPtEF`BDlB@|@?bA?~@E~AEpAG`AKxAMnAQvAUtAYxAWdAWbA[dA[z@Yv@Yn@_@v@_@r@]h@k@z@e@l@c@d@g@h@q@j@i@b@{@f@u@`@k@Tq@Ts@Pq@NiTjDqBXwB\\kN|BqAPqBj@iBx@k@ZeAt@{@r@u@p@y@bAyArB{AxBqAjBuW|_@sExGqCfEqC~DmDfFe@r@aPvUgBpCqAdBmKnOaAvAaAjAQRg@h@KJoBjBGFqJnJm@l@mEjEi@l@kAhAq@n@aB~AgCbCu@r@uBpBg@f@QNWVYTCBILGDE@GDEHCJOLIHUJo@b@aAj@cDlBy@f@UPa@XYPWNe@VaCrAkBlAgBdA}@j@m@\\qAv@e@Ta@Pk@TSFI@s@PcAPyJdBYDo@Le@Hk@JWFkAR}TbEyQlDgAPk@HSDmDh@gI|AsB`@mCd@iCh@iARmI|Ag\\lGE@c@HcARu@NWDSDUDk@J{@PiM`CyMjCq@LoJdBSDaLvBeHrAiB^A?A???G@eF`AwAPq@HI@g@J_@FMBA?s@L]FaDn@{@Nm@Ho@Hi@Bi@@UCy@Em@GYGYGWIMGUEEAMEu@[]OWQYOu@c@e@UyPeJkH{DqEcCyAy@aAm@cAq@oA_Aa@[kAcAiAgAQQs@s@yA}AeEsEcEkEsDuDc@a@GIm@o@_AcAy@{@e@i@sCyCeFmEYU{CuBw@i@{@q@_B}@aAm@mCgBKOIS@SAQEQGMGGGAE?M@IHGLCNAN@NBNDLFHFpBPlFNxF@b@B`C@bCGnFJt@w@p]]|NGtBqA|l@ErB[~M]dMYvH]tHy@lMi@lHiAbMwAbM_BjLeAdH_BvJW|A{BlNi@dD??_ExVCL??cCdOo@xD}Ijj@oBtL_A|F]r@G^Ib@w@lEYpAKt@o@jEm@dEKj@a@nC[|A]hAc@`Ai@`Aq@x@i@d@w@b@eCpAc@Pc@Ng@Fg@Ba@Cg@Is@YQIy@i@SEiBeByAyAWYWYiAmAmD}Du@y@y@_AcBkBmAqAcA_AaDoDyAcBgAoAaHsHcAkAuBaBy@k@uAu@eBs@}Ak@cBe@kAYmEgAoBo@s@WqAq@yA{@_BmAuAqAs@u@eAsAmAeBk@aAOWu@wAq@{AkAoCi@eBcAsD{BiJ_@cBoAkFi@wBm@uBQk@s@qBc@eAQe@s@}AkAwBsA_CiBeCs@{@aAiA_C_CcCwBcBsAgBoAmEaDyAcA{IgG_DcCyBsBeBuBcB_CkAsBs@sAy@aBg@sAEKq@eBo@mBqAiEeBqGoAqECe@q@qCc@kCsBiMIUESGa@CQAa@EFe@`@k@f@e@`@_@^MNWT[ZOPq@~@IJq@dAU`@OVENUb@eCpEiApBs@tASVoA|Bm@dAqA|BS^S\\S^CBCPOXOVCDIPU^EJc@t@WVg@z@GHSXQTSZm@ZWJURi@f@WXEDCBINSNy@\\y@Z[H[Di@Js@D{ENcBDoABy@DgFNcHPa@BYD]FYFm@NQFMD_@Na@T]RQJq@f@m@d@c@`@g@l@QTOXa@GWE??k@GkC]}ASwB[OKOM[u@{AaEQo@o@mDCGMi@Ka@g@oA{@kBkBcDy@sA}BeD}EiGa@i@KOW[A?EEBK?KAKEIEEGAGBEFCFAFAH@HBFBFDBD@AJ?@GXAB_@~@a@p@UVWZ_@b@u@t@[`@aBlByAbBm@p@eArAWXCBIJMLMJYPYLODoBTm@JOBI@mAN}@LgBTOAYC]EQAALAVABELINENQj@w@jCEVERCb@CZK|AETKP[\\MPEPIZYfD??CN?@Gt@OCsZ}Ay@EMCUMS_@Mq@[oBCOCSYeBF_@L_@Rg@?MSm@'
    },
    {
      order: 3,
      title: 'Delivery of the barley to Belgomalt',
      story: '',
      quote: '',
      author: { name: 'Boorrtmalt Herent', avatar: '' },
      date: 'Feb 18, 2026',
      address: 'Zijpstraat 155, 3020 Herent',
      learnMoreText: '<h2>Belgomalt–Boortmalt receives the barley from Cultivae and transforms it into malt.</h2><p>This process takes approximately seven days. In the malthouse, they make the barley kernel ‘believe’ it is in the ground and needs to sprout (germinate). First, the barley is soaked in water, then it is transferred to the germination room, where it can grow. The process is then paused by drying the barley in the final phase.</p><p>During germination, a wide range of natural enzymes is released within the barley kernel. These enzymes play a crucial role in the brewery, where they convert complex starches in the barley into simple sugars in the wort—ideal food for the yeast.</p>',
      lat: 50.928777,
      lon: 4.680181, // Boortmalt Herent
      // Cultivae → Boortmalt Herent (42.3 km driving)
    },
    {
      order: 4,
      title: 'When the barley is transformed into malt.',
      story: '',
      quote: '',
      author: { name: 'Boortmalt', avatar: '' },
      date: 'March 31, 2026',
      address: 'Belgomalt<br>Zijpstraat 155, 3020 Herent',
      learnMoreText: '',
      lat: 50.928777,
      lon: 4.680181, // Boortmalt Herent
      lineToNext: 'gczuHw}p[Rl@?LSf@M^G^XdBBRBNZnBLp@R^TLLBx@DrZ|ANBFu@?ABO??XgDH[DQLQZ]JQDUJ}AB[Bc@DSDWv@kCPk@DOHODM@C@W@MP@\\DXBN@fBU|@MlAOHANCl@KnBUNEXMXQLKLMHKBCVYdAsAl@q@xAcB`BmBZa@t@u@^c@V[TW`@q@^_A@CFY?A@KFADEBGDD@?VZJN`@h@|EhG|BdDx@rAjBbDz@jBf@nAJ`@Lh@BFn@lDPn@zA`EZt@NLNJvBZ|ARjC\\j@F??VD`@Fd@[HIl@s@VWPOVU\\WTOPKXQb@U`@Q`AY\\I^IZE^Ef@CfISjAEnACx@CnAA|DM`CGXC^EbAOPETGl@Ur@WHAXGRIROBCd@e@JINQn@w@DGDITYd@m@DKh@{@Nc@b@u@DKT_@HQBENWNYJGbEkHBGJSv@_BN]r@uAhAqBdCqETc@LCb@u@d@w@V[LMPUJIHKLMVURAF@B@HBJD`GxNL^p@hBV\\vAjFdBlGrAlEj@dBv@tBj@vAv@`Bv@zApAvBzAvBlAxAxCtC|CbCzIhGzAbAjE|CdBpAdBrAzBpB|@v@nArAj@l@`AnAfBdCrAtBhAxBr@zAdAlCt@`Ch@fBl@bCrAvFh@zBnAvFx@`Dh@bBl@jBz@xBf@nA~@jBdAjBlA`BlAzAp@t@tAlA~AnAzA|@pAn@v@ZpBn@`Bb@dBb@JBfDx@|Aj@v@Zj@VtBlA\\Rt@n@xBnBzDfEzDnEpBdCzCjDfGdHpCbDvAlBx@dAl@x@X`@Nb@V`@PVNXRZR\\NZNVBDR^NZVl@Xn@Zz@L^L\\DPVx@HZDNDLJ`@VlARx@Z~AX~AZbBZbBJl@Hl@Lp@Hl@Ht@DZDd@BRFx@Bf@Dv@@l@@bA@jA?\\?f@Az@Cx@GtAGvAI|AE|@G|@MxBWrDMbCWvEI~AEt@OnB?N?j@}Dbk@KvAoCb`@o@~Iw@`Lk@dIcBrUiBxT{WntCcBjRy@|Jm@pHs@`Jm@rIk@xIc@~H[tFg@tKG|A[rHO`FSdGWbKQ~HOlJWnZEhNEvRAfF?rUEhpBAzY?zX?xK?jUApW?~q@A~S?rK?xI@tYHfUDdCB~B?DS|CIdBOnBw@nH_AvHKz@WvBo@xE[~AS~@WjAUt@]z@]t@]n@i@t@k@t@IHc@f@_@ZCFYb@IF}ExCcF|C_Aj@qDtBk@`@aAp@uFjDA@SLg@ZCBGDUJoC`BOHg@^oCfBmB`As@\\aAXgATyARkAHcCDuEPsCj@}BhA_CbByDrDmEdEaBbBqCfCYVsBdB_@ZuFzEuBjBoAp@kBlAm@h@aA~@yAtAcAlAy@pAeAvBq@rB{@dDk@fCgAlEw@`De@nBYhAKZkChIgI`VoBtF}AbE{@zBw@jBo@zA{@fB_AlBiAvBaAbBaAxAaAvAmA|AoBxBiB`BkA~@KFiAt@MFeAj@sB~@E@aBp@uAd@aDlAiAb@wBbAgAv@g@d@iA`Aq@r@{@hAw@hAo@fA[j@iAdCcAlCy@bCm@nBy@pCABe@|AsAzE]tA]rAe@~B[fBWhBMhAOjBOxBInCEjC?bBBtAHbCF|A@H@J??@TFj@JnALlAb@`DjD`VF`@X|BD\\DRJ~@b@lD\\fDTtCPlCP~CN`DFdBFrBDlDBxD?jD?d@CdDEhBE|AA`@MdDGbBI~AOvBOtB_@tE[rCu@~GoA|I}CxS_EhXiBzLKt@cA`HqAlJu@`Gk@dF_@jDs@hHUdCWfDWfDQxCMrBKtBQ~EGdBEfBIhDCpAArAApE?zA@fDDzBBjBBvAF`BDxAN~CNzCPjCJvAZjDVfCj@xEh@xD^~Bb@fCv@|Dt@nD`A`EdAtDn@xBp@rBr@rB`BjEdAfC|BzEnAbC|@bBpA~BnAxBdKfQ`A~A|F|JV`@BDhGjKfIlNbBpCxBdD~BfDrDxEtBdCrHtI`AlAlBdCjAdBjAjBx@|Ah@bAvAvCz@nB~@bCx@~B`AxCh@jBf@hBd@vBZrAZzAf@fCn@rDZhBtInh@lHnc@pA`Il@hDl@zCh@zBf@nBn@tBl@hBhBnEtBpD|BpDnBtCLPL\\t@hAt@hAx@xAfB~C@@FLBDJN@@HL@@FJ@B@B~CvE@BrBxC|@pApAjBTZrDhFRZn@`ATX`AxAx@pAx@tApAdCh@fAzBrErAlCb@z@LVlBtDjAdCZn@b@bAb@dA\\z@h@vANd@Nh@Tx@VrAJt@Df@HjA@p@?v@CtAGpAMfAOpA}@nGQlAq@~EKr@QxA]jD_@~Cq@bGc@~DSvBk@pFaCtT]~Cs@`H_@vDs@rIObCS~C}AtYCVg@tJ{H`zAgBx\\e@fKWjJIdI?rHFlJT~If@fLr@bLdDxe@nF|v@XnEb@nH`@rH`@rKNfKFnJAbJKnIQrIa@nKm@nK{@zLiBxWaBhVe@fGKzAe@lHyEnr@cBlV{@lLeA~KmAbKwAlJiGp_@mQfgAcCbOaD~Re@pCoAvHi@vCoDtQyDpPoDnOeBfH]vAqyAllGqAvFy@|D}AvIg@|CKr@a@pCeAhIa@dEQlBoHbz@]dEqA`NsAbLEZ}ApJyAtHKh@iA|EiApEy@`DaCtH_BpEqAhD{ApDyA`DcDpGkM|U}A~CsApCqAtCm@xAe@fAeBtE{@dCc@rAk@bByAfFeBrG}@vDu@jDy@lEw@pEu@tEu@~EaA|Im@nGc@zFG|@WpE[vGSrGMxGEpG?fIDdGJdHZlJb@fIX~DNpBn@lH@JJ`A@Jd@pEb@xDn@vFv@bGBLZpCJbAd@pEj@jGr@vJR`DPfDRpENpEHzF@~ADjF?bFG|GMfGSfGYbGg@nHs@~IMzAuAzNWjCKnAg@jFqDd`@U`C}ApPiBtRSpBw@jH}@`HcAlGgAlGoA`GsAtFiAbEaC`IaeAlkDUt@}c@bzAMb@gw@jiCyMlc@Ut@yOnh@gDzK{E|OgE|MUp@qBhGcAzCmHjSgIhTcDdIwBtFc@N[l@q@p@qBzAiAx@g@^cD`CMDM@MAKAQIWSUSU]QWKOQU[a@w@gAcByBSWs@cAQIOSIMGIm@w@c@o@GIiEaGgDuEaDoE}BaD}B_DOYqAkBg@s@e@q@w@gAW_@_AyAQYWl@Un@a@bAGNUj@IRc@jAMZuApDa@`Ak@zAo@`Bi@pA}AfEiAlCOd@CDo@dBeBnEs@lBgAlCELi@vA}@|Be@lASn@Uj@MZi@tAs@fBIRcAhC}@`Cy@rBIRWn@gAnC]v@Qf@Yz@GPABSj@Sx@k@fCGZU`AERMj@wDpPaAfEyAtGmBhIo@vCwK|e@I\\CLkAfFMh@MR]hASj@CXCHKHWr@Sj@MZMXEPCHK^CTqBpEWl@CH_@t@k@lAk@rAEJEFaA~BSd@KTUd@Yl@JFFDVX`@b@PJ\\D`@D`@BZHZL'
    },
    {
      order: 5,
      title: 'Brewed with craft and tradition.',
      story: '',
      quote: '',
      author: { name: 'Brouwerij Huyghe', avatar: '' },
      date: 'April 06, 2026',
      address: 'Geraardsbergse steenweg 14b, 9090 Melle',
      learnMoreText: '<h2>Delirium Tremens is a beer brewed with 100% malt, with no other sources of sugar added.</h2><p>Malt is one of the main raw ingredients used in brewing. It gives beer its colour and round character, and provides the sugars needed for yeast to produce CO₂ and alcohol.</p><p>Delirium Tremens is the first beer in Belgium brewed entirely with Pure Local malt that has a negative CO₂ balance. So, you can enjoy this beer knowing you are supporting nature.</p>',
      lat: 50.999559,
      lon: 3.804911 // Brouwerij Huyghe, Melle
    }
  ]
};


// --------------------------------------------
// Helpers
// --------------------------------------------
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readNumberAttr(el, attr, fallback) {
  const raw = el.getAttribute(attr);
  if (raw == null || raw.trim() === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readStringAttr(el, attr, fallback) {
  const raw = el.getAttribute(attr);
  return raw && raw.trim() !== '' ? raw : fallback;
}

function readBoolAttr(el, attr, fallback) {
  const raw = el.getAttribute(attr);
  if (raw == null) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === '' || v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

// Mapbox / Google "Encoded Polyline Algorithm Format" decoder. Mapbox's
// Directions API returns coordinates in this format when called with
// `geometries = polyline` (precision 5). About 3× more compact than a raw
// coordinate array — important because we store geometry in a 10k-char
// Webflow plain-text field.
function decodePolyline(str, precision) {
  if (typeof str !== 'string' || !str.length) return [];
  const factor = Math.pow(10, precision || 5);
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}

// Quadratic bezier between two lat/lon points. Control point sits on the
// perpendicular to the from→to vector at the midpoint, offset by `curvature *
// distance`. Sampling in lat/lon space (rather than projected screen space)
// is good enough at this zoom and avoids needing the map instance.
function bezierCurve(from, to, curvature, samples) {
  const result = [];
  const [fx, fy] = from;
  const [tx, ty] = to;
  const mx = (fx + tx) / 2;
  const my = (fy + ty) / 2;
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [from.slice(), to.slice()];
  const offset = curvature * len;
  // Perpendicular unit vector (rotated 90° counter-clockwise).
  const cx = mx + (-dy / len) * offset;
  const cy = my + (dx / len) * offset;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const omt = 1 - t;
    const x = omt * omt * fx + 2 * omt * t * cx + t * t * tx;
    const y = omt * omt * fy + 2 * omt * t * cy + t * t * ty;
    result.push([x, y]);
  }
  return result;
}

function stepsWithCoords(steps) {
  const result = [];
  for (const step of steps) {
    if (!isFiniteNumber(step.lat) || !isFiniteNumber(step.lon)) break;
    result.push(step);
  }
  return result;
}

function isStepUnlocked(step) {
  return isFiniteNumber(step.lat) && isFiniteNumber(step.lon);
}

function readJourneyData(wrapper) {
  const raw = wrapper.getAttribute('data-journey-data');
  if (!raw || !raw.trim()) return FIXTURE_FALLBACK;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.warn('[journey-map] data-journey-data parsed but has no steps; using fixture.');
      return FIXTURE_FALLBACK;
    }
    return parsed;
  } catch (err) {
    console.warn('[journey-map] could not parse data-journey-data, using fixture.', err);
    return FIXTURE_FALLBACK;
  }
}

function getMapboxToken(wrapper) {
  return wrapper.getAttribute('data-journey-token')
    || (typeof window !== 'undefined' && window.MAPBOX_TOKEN)
    || null;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Easing functions. Linear is used for story playback (Instagram-style;
// progress should be perceived as time elapsed, not as motion). Ease-in-out
// is used for everything else (smooth value transitions).
function easeLinear(t) { return t; }
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


// --------------------------------------------
// Pins
// --------------------------------------------
// All pins start inactive — `setActiveStep` toggles the active class on the
// matching pin element. One DOM marker per known waypoint (locked steps get
// no pin at all; their position is only revealed on unlock).
function createPinElement() {
  const el = document.createElement('div');
  el.className = 'journey-pin';
  el.setAttribute('data-journey-pin', '');
  return el;
}

function addPins(map, mapboxgl, steps) {
  const known = stepsWithCoords(steps);
  return known.map((step) => {
    const el = createPinElement();
    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([step.lon, step.lat])
      .addTo(map);
    return { marker, element: el, step };
  });
}


// --------------------------------------------
// Per-segment line layers
// --------------------------------------------
// Each leg N-1 → N gets its own Mapbox source + layer, keyed by the
// destination step's order. `line-trim-offset` on each layer is driven
// independently by the destination step's `progress` value.
function segmentSourceId(toOrder) { return `journey-line-${toOrder}`; }
function segmentLayerId(toOrder) { return `journey-line-${toOrder}`; }

function addJourneySegments(map, steps, opts) {
  const segments = [];
  const known = stepsWithCoords(steps);
  for (let i = 0; i < known.length - 1; i++) {
    const from = known[i];
    const to = known[i + 1];

    // Same coordinates → no line to draw (e.g. two steps at one location).
    if (from.lat === to.lat && from.lon === to.lon && !from.lineToNext) {
      segments.push({ sourceId: null, layerId: null, toOrder: to.order, fromOrder: from.order, empty: true });
      continue;
    }

    const fromPt = [from.lon, from.lat];
    const toPt = [to.lon, to.lat];

    let coords;
    if (typeof from.lineToNext === 'string' && from.lineToNext.length > 0) {
      coords = decodePolyline(from.lineToNext);
      if (coords.length < 2) {
        coords = bezierCurve(fromPt, toPt, opts.curvature, opts.bezierSamples);
      }
    } else {
      coords = bezierCurve(fromPt, toPt, opts.curvature, opts.bezierSamples);
    }

    const sourceId = segmentSourceId(to.order);
    const layerId = segmentLayerId(to.order);
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
      type: 'geojson',
      // `lineMetrics: true` is REQUIRED for `line-trim-offset` to work.
      lineMetrics: true,
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords }
      }
    });

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': opts.lineColor,
        'line-width': opts.lineWidth,
        // Start fully trimmed (invisible). progress = 0 ⇒ trim = [0, 1].
        'line-trim-offset': [0, 1]
      }
    });

    segments.push({ sourceId, layerId, toOrder: to.order, fromOrder: from.order });
  }
  return segments;
}


// --------------------------------------------
// Bounds
// --------------------------------------------
// Bounds helpers intentionally do NOT pass an explicit `padding` option —
// the per-instance map padding is set globally via `map.setPadding(...)` in
// `applyMapPadding`, and Mapbox honours that as the default for every
// fitBounds / flyTo. Passing one here would override the persistent padding.
function fitBoundsToCoords(map, mapboxgl, coords) {
  if (coords.length < 1) return;
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new mapboxgl.LngLatBounds(coords[0], coords[0])
  );
  // Guard against zero-area bounds (all points identical) — Mapbox would
  // zoom to maxZoom and the GPU can choke. Pad by ~0.01° (~1 km).
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  if (sw.lng === ne.lng && sw.lat === ne.lat) {
    bounds.extend([sw.lng - 0.01, sw.lat - 0.01]);
    bounds.extend([ne.lng + 0.01, ne.lat + 0.01]);
  }
  map.fitBounds(bounds, { duration: 0, linear: true });
}


// --------------------------------------------
// Map padding — auto-detect occluders
// --------------------------------------------
// The wrapper typically stacks UI over the map (progress bar header at the
// top, a content card at the bottom). Without padding, the camera centres
// the journey behind those overlays — pins disappear under the content card
// and the active leg lands in the wrong place.
//
// For each direct child of the wrapper (other than the map container), we
// check whether its bounding box intersects the map and which edge it hugs
// closest. We then use that edge's extent as padding for that side, taking
// the max across all occluders (so a tall header + a tall card stack
// independently). The base padding is the floor for sides with no occluder.
//
// Result is applied via `map.setPadding({...})`, which Mapbox uses as the
// default for every fitBounds / flyTo, so we don't need to thread padding
// through every camera call.
function computeMapPadding(mapContainer, wrapper, basePadding) {
  const padding = {
    top: basePadding,
    bottom: basePadding,
    left: basePadding,
    right: basePadding
  };

  const mapRect = mapContainer.getBoundingClientRect();
  if (mapRect.width <= 0 || mapRect.height <= 0) return padding;

  Array.from(wrapper.children).forEach((el) => {
    if (el === mapContainer || el.contains(mapContainer)) return;
    if (typeof el.getBoundingClientRect !== 'function') return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Skip elements that don't overlap the map at all (e.g. footer below).
    if (rect.right <= mapRect.left || rect.left >= mapRect.right) return;
    if (rect.bottom <= mapRect.top || rect.top >= mapRect.bottom) return;

    // For each edge of the map, compute how far the element extends inward
    // from that edge. The smallest value identifies which edge the element
    // is hugging (and how deep its occlusion goes from that edge).
    const extents = [
      { side: 'top', value: Math.max(0, rect.bottom - mapRect.top) },
      { side: 'bottom', value: Math.max(0, mapRect.bottom - rect.top) },
      { side: 'left', value: Math.max(0, rect.right - mapRect.left) },
      { side: 'right', value: Math.max(0, mapRect.right - rect.left) }
    ];
    extents.sort((a, b) => a.value - b.value);
    const closest = extents[0];

    padding[closest.side] = Math.max(padding[closest.side], closest.value);
  });

  // Clamp: no single side may exceed 50% of the map's dimension on that
  // axis. Without this, a tall overlay (e.g. content card + nav buttons)
  // can push the padding so high that Mapbox has no usable viewport left
  // and flyTo/fitBounds silently break.
  const maxV = mapRect.height * 0.5;
  const maxH = mapRect.width * 0.5;
  padding.top = Math.min(padding.top, maxV);
  padding.bottom = Math.min(padding.bottom, maxV);
  padding.left = Math.min(padding.left, maxH);
  padding.right = Math.min(padding.right, maxH);

  return padding;
}

function applyMapPadding(instance) {
  if (!instance.map) return;
  const padding = computeMapPadding(
    instance.mapContainer,
    instance.wrapper,
    instance.opts.fitPadding
  );
  try { instance.map.setPadding(padding); } catch (_) { /* ignore */ }
}


// --------------------------------------------
// Progress bar
// --------------------------------------------
// Designer builds ONE [data-progress-bar] somewhere inside the
// wrapper; we clone it once per step into the template's parent. Each clone
// gets the state value ("active" / "unlocked" / "locked") as its attribute,
// and a `--progress: 0..1` CSS variable updated every animation
// frame so the designer's fill rule renders smoothly.
function buildProgressBar(wrapper, steps) {
  const template = wrapper.querySelector('[data-progress-bar]');
  if (!template) {
    console.warn('[journey-map] No [data-progress-bar] template found inside [data-journey-init]; progress bar skipped.');
    return [];
  }

  const container = template.parentNode;
  if (!container) return [];

  // CSS hook for variable-length layouts; written on the container + every
  // [data-journey-progress] so either can be the grid host.
  const stepCount = String(steps.length);
  container.style.setProperty('--step-count', stepCount);
  wrapper.querySelectorAll('[data-journey-progress]').forEach((el) => {
    el.style.setProperty('--step-count', stepCount);
  });

  const segments = steps.map((step) => {
    const element = template.cloneNode(true);
    element.setAttribute('data-progress-bar', '');
    // Start every segment at progress 0; setActiveStep will animate from
    // there.
    element.style.setProperty('--progress', '0');

    const lockEl = element.querySelector('[data-progress-icon]');
    if (lockEl) lockEl.style.display = 'none';

    // Capture the inner fill element (if any) and prime it with inline
    // styles. We write the transform DIRECTLY on this element from JS rather
    // than relying on the CSS variable + a SCSS rule, because:
    //   1. The designer's class CSS on the inner element has the same
    //      specificity (0,1,0) as our attribute selector; whichever comes
    //      later in source order wins, and that order is fragile.
    //   2. Webflow Designer often sets `transform:` and/or `transition:` on
    //      classes — both of which silently kill the per-frame scaleX
    //      animation we drive from RAF.
    // Inline styles dodge both problems and make the animation work
    // regardless of what the designer styled in Webflow.
    const progressEl = element.querySelector('[data-progress-fill]');
    if (progressEl) {
      progressEl.style.transformOrigin = 'left center';
      progressEl.style.transform = 'scaleX(0)';
      progressEl.style.transition = 'none';
    }

    return { element, step, lockEl, progressEl };
  });

  segments.forEach((seg) => container.insertBefore(seg.element, template));
  template.parentNode.removeChild(template);

  return segments;
}


// --------------------------------------------
// Content card
// --------------------------------------------
// Designers mark any number of elements with `data-journey-content="<slot>"`
// inside the wrapper. The JS writes step data into each slot based on the
// value, picking the right DOM API for the element type (src for <img>, href
// for <a>, innerHTML for known rich-text slots, textContent otherwise).
function updateContentCard(wrapper, step) {
  const slots = wrapper.querySelectorAll('[data-journey-content]');
  slots.forEach((el) => {
    const slot = (el.getAttribute('data-journey-content') || '').trim().toLowerCase();
    applyContentSlot(el, slot, step);
  });
}

function applyContentSlot(el, slot, step) {
  switch (slot) {
    case 'title':
      el.textContent = step.title || '';
      break;

    // The Figma copy block is a quote attributed to a person; in this
    // project's vocabulary it's called "story". Accept either slot name and
    // pull from whichever field is populated.
    case 'story':
    case 'quote':
      el.innerHTML = step.quote || step.story || '';
      break;

    case 'name':
    case 'author':
      el.textContent = (step.author && step.author.name) || '';
      break;

    case 'image':
    case 'avatar': {
      if (el.tagName !== 'IMG') break;
      const url = (step.author && step.author.avatar) || '';
      const eyebrow = el.closest('.eyebrow') || el.parentElement;
      const fallbackEl = eyebrow.querySelector('.eyebrow_image-fallback > :first-child');
      if (url) {
        el.setAttribute('src', url);
        el.style.display = '';
        if (fallbackEl) fallbackEl.parentElement.style.display = 'none';
      } else {
        el.style.display = 'none';
        el.removeAttribute('src');
        if (fallbackEl) {
          const name = (step.author && step.author.name) || '';
          fallbackEl.textContent = name.charAt(0).toUpperCase();
          fallbackEl.parentElement.style.display = '';
        }
      }
      break;
    }

    case 'address':
      el.innerHTML = step.address || '';
      break;

    case 'date':
      el.textContent = step.date || '';
      break;

    case 'dialog-trigger':
      if (step.order != null) {
        el.setAttribute('data-dialog-open', 'j' + step.order);
      }
      el.style.display = step.learnMoreText ? '' : 'none';
      break;

    case 'link':
    case 'learn-more':
    case 'learnmore':
      el.innerHTML = step.learnMoreText || '';
      break;

    default:
      // Unknown slot — silently ignore.
      break;
  }
}


// --------------------------------------------
// Dialog cloning
// --------------------------------------------
// The designer places a single `div[data-dialog][data-journey-dialog-template]`
// inside `.section_geography` (sibling of the container that holds the card).
// On init we clone it once per step, set `data-dialog="j{order}"`, inject step
// content into any `[data-journey-content]` slots inside the clone, then hide
// the template. The dialog module (`dialog.js`) picks up the clones via its
// existing event-delegation — no re-init needed.
function dialogId(order) {
  return 'j' + order;
}

function buildDialogs(wrapper, steps) {
  const section = wrapper.closest('.section_geography') || wrapper.parentElement;
  if (!section) return [];

  const template = section.querySelector('[data-dialog][data-journey-dialog-template]')
    || section.querySelector('[data-dialog]');
  if (!template) return [];

  const clones = [];

  steps.forEach((step) => {
    const clone = template.cloneNode(true);
    clone.removeAttribute('data-journey-dialog-template');
    clone.setAttribute('data-dialog', dialogId(step.order));
    clone.setAttribute('data-dialog-status', 'closed');

    clone.querySelectorAll('[data-journey-content]').forEach((el) => {
      const slot = (el.getAttribute('data-journey-content') || '').trim().toLowerCase();
      applyContentSlot(el, slot, step);
    });

    template.parentElement.insertBefore(clone, template);
    clones.push(clone);
  });

  template.style.display = 'none';
  template.setAttribute('aria-hidden', 'true');

  if (typeof window !== 'undefined' && window.dialog && window.dialog._prep) {
    window.dialog._prep(section);
  }

  return clones;
}

function destroyDialogs(clones) {
  if (!clones) return;
  clones.forEach((el) => el.remove());
}

// Tiny helper for non-card slots (footer locked count, etc.).
function setSlot(wrapper, selector, fn) {
  const el = wrapper.querySelector(selector);
  if (el) fn(el);
}


// --------------------------------------------
// Locked count footer (legacy — kept as a no-op for backward compat)
// --------------------------------------------
function updateLockedCount(wrapper) {
  setSlot(wrapper, '[data-journey-locked-count]', (el) => {
    el.textContent = '';
  });
  wrapper.setAttribute('data-journey-unlock-state', 'complete');
}


// --------------------------------------------
// Per-step progress (single source of truth)
// --------------------------------------------
// `setStepProgress` is the only function that should write to a step's
// progress: it keeps the in-memory value, the progress-bar CSS variable, and
// the corresponding line layer's trim-offset in lock-step. All animation
// loops funnel through it.
function setBarProgress(instance, order, value) {
  const v = Math.max(0, Math.min(1, value));
  instance.progress[order] = v;

  const seg = instance.progressSegments.find((s) => s.step.order === order);
  if (seg) {
    seg.element.style.setProperty('--progress', v.toFixed(4));
    if (seg.progressEl) {
      seg.progressEl.style.transform = `scaleX(${v.toFixed(4)})`;
    }
  }
}

function setLineProgress(instance, order, value) {
  const v = Math.max(0, Math.min(1, value));
  instance.lineProgress[order] = v;

  const lineSeg = instance.lineSegments.find((s) => s.toOrder === order);
  if (lineSeg && instance.map && instance.map.getLayer(lineSeg.layerId)) {
    instance.map.setPaintProperty(lineSeg.layerId, 'line-trim-offset', [v, 1]);
  }
}

function setStepProgress(instance, order, value) {
  setBarProgress(instance, order, value);
  setLineProgress(instance, order, value);
}

function cancelBarAnimation(instance, order) {
  if (instance.animationFrames[order]) {
    cancelAnimationFrame(instance.animationFrames[order]);
    delete instance.animationFrames[order];
  }
}

function cancelLineAnimation(instance, order) {
  const key = 'line-' + order;
  if (instance.animationFrames[key]) {
    cancelAnimationFrame(instance.animationFrames[key]);
    delete instance.animationFrames[key];
  }
}

function cancelStepAnimation(instance, order) {
  cancelBarAnimation(instance, order);
  cancelLineAnimation(instance, order);
}

function cancelAllStepAnimations(instance) {
  Object.keys(instance.animationFrames).forEach((key) => {
    cancelAnimationFrame(instance.animationFrames[key]);
  });
  instance.animationFrames = {};
}

function animateBar(instance, order, target, durationMs, easing, onDone) {
  cancelBarAnimation(instance, order);
  const start = instance.progress[order] || 0;

  if (durationMs <= 0 || Math.abs(start - target) < 0.001 || prefersReducedMotion()) {
    setBarProgress(instance, order, target);
    if (onDone) onDone();
    return;
  }

  const startTs = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - startTs) / durationMs);
    setBarProgress(instance, order, start + (target - start) * easing(t));
    if (t < 1) {
      instance.animationFrames[order] = requestAnimationFrame(frame);
    } else {
      delete instance.animationFrames[order];
      if (onDone) onDone();
    }
  }
  instance.animationFrames[order] = requestAnimationFrame(frame);
}

function animateLine(instance, order, target, durationMs, easing) {
  cancelLineAnimation(instance, order);
  const start = instance.lineProgress[order] || 0;
  const key = 'line-' + order;

  if (durationMs <= 0 || Math.abs(start - target) < 0.001 || prefersReducedMotion()) {
    setLineProgress(instance, order, target);
    return;
  }

  const startTs = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - startTs) / durationMs);
    setLineProgress(instance, order, start + (target - start) * easing(t));
    if (t < 1) {
      instance.animationFrames[key] = requestAnimationFrame(frame);
    } else {
      delete instance.animationFrames[key];
    }
  }
  instance.animationFrames[key] = requestAnimationFrame(frame);
}

// Convenience: animate bar and line together at the same duration.
function animateProgress(instance, order, target, durationMs, easing, onDone) {
  animateBar(instance, order, target, durationMs, easing, onDone);
  animateLine(instance, order, target, durationMs, easing);
}


// --------------------------------------------
// Active step orchestration
// --------------------------------------------
// Sets the UI state for `order` (pins, bar attribute values, card content,
// camera) and kicks off the playback animations:
//   - Active step: reset to 0 (if needed), then play 0 → 1, then auto-advance.
//   - Every other unlocked step: smooth-transition to its non-active target
//     (1 if past, 0 if future). This produces the "undraw" effect when going
//     backwards and the "draw-ahead" effect when going forward.
function setActiveStep(instance, order, options) {
  options = options || {};
  const step = instance.steps.find((s) => s.order === order);
  if (!step || !isStepUnlocked(step)) return;

  const previousActive = instance.activeOrder;
  const isFirstActivation = previousActive === null;
  instance.activeOrder = order;

  // Switching steps implicitly resumes playback — the new step starts
  // playing immediately, so a sticky paused state would just stall it.
  if (instance.paused) {
    instance.paused = false;
    instance.wrapper.setAttribute('data-journey-state', 'playing');
  }

  // Pin highlights.
  instance.pins.forEach((p) => {
    const isActive = p.step.order === order;
    p.element.classList.toggle('journey-pin--active', isActive);
    if (isActive) p.element.setAttribute('data-journey-pin-active', '');
    else p.element.removeAttribute('data-journey-pin-active');
  });

  // Progress bar state attributes.
  instance.progressSegments.forEach((seg) => {
    const state = seg.step.order === order ? 'active' : 'unlocked';
    seg.element.setAttribute('data-progress-bar', state);
  });

  // Card content swap.
  updateContentCard(instance.wrapper, step);

  // Camera.
  if (!options.skipFly) {
    flyToActiveStep(instance, order);
  }

  // Progress animations: kick off concurrent transitions for every unlocked
  // step. The active step gets the special two-phase "reset → play" treatment.
  instance.steps.forEach((s) => {
    if (!isStepUnlocked(s)) return;

    if (s.order === order) {
      const current = instance.progress[s.order] || 0;

      const playStory = () => {
        animateBar(instance, s.order, 1, instance.opts.storyDuration, easeLinear,
          () => autoAdvance(instance, s.order));
        animateLine(instance, s.order, 1, instance.opts.drawPathDuration, easeLinear);
      };

      if (isFirstActivation || current === 0) {
        playStory();
      } else {
        animateProgress(instance, s.order, 0, instance.opts.transitionDuration, easeInOutCubic, playStory);
      }
    } else {
      const target = s.order < order ? 1 : 0;
      animateProgress(
        instance,
        s.order,
        target,
        instance.opts.transitionDuration,
        easeInOutCubic
      );
    }
  });
}

function nextUnlockedStep(steps, currentOrder) {
  return steps
    .filter((s) => isStepUnlocked(s) && s.order > currentOrder)
    .sort((a, b) => a.order - b.order)[0] || null;
}

function prevUnlockedStep(steps, currentOrder) {
  return steps
    .filter((s) => isStepUnlocked(s) && s.order < currentOrder)
    .sort((a, b) => b.order - a.order)[0] || null;
}

function autoAdvance(instance, completedOrder) {
  if (!instance.opts.autoplay) return;
  // Guard against stale callbacks from a step that's no longer active.
  if (instance.activeOrder !== completedOrder) return;
  const next = nextUnlockedStep(instance.steps, completedOrder);
  if (next) setActiveStep(instance, next.order);
  // Else: end of unlocked journey — hold on the last step.
}


// --------------------------------------------
// Pause / resume
// --------------------------------------------
// Pause only affects the ACTIVE step's playback animation. Non-active step
// transitions are brief and allowed to complete naturally — pausing them
// would create awkward in-between visual states (half-drawn future lines,
// etc). On resume, we kick off a fresh animateProgress on the active step
// from its current value to 1, scaling the remaining duration so the story
// completes in proportional time. Whether paused during the "reset" or the
// "play" phase, the resume always plays forwards from where the bar stopped.
// `paused` = user-initiated (button click). `visibilityPaused` = out of
// viewport (IntersectionObserver). Both independently freeze the active
// step's animation; resume only fires when BOTH are false.
function pauseStory(instance) {
  if (instance.paused || instance.activeOrder == null) return;
  instance.paused = true;
  cancelStepAnimation(instance, instance.activeOrder);
  instance.wrapper.setAttribute('data-journey-state', 'paused');
}

function resumeStory(instance) {
  if (!instance.paused || instance.activeOrder == null) return;
  if (instance.visibilityPaused) return;
  instance.paused = false;
  instance.wrapper.setAttribute('data-journey-state', 'playing');
  resumeActiveStep(instance);
}

function togglePause(instance) {
  if (instance.paused) resumeStory(instance);
  else pauseStory(instance);
}

function pauseForVisibility(instance) {
  if (instance.visibilityPaused || instance.activeOrder == null) return;
  instance.visibilityPaused = true;
  cancelStepAnimation(instance, instance.activeOrder);
  if (!instance.paused) {
    instance.wrapper.setAttribute('data-journey-state', 'paused');
  }
}

function resumeFromVisibility(instance) {
  if (!instance.visibilityPaused) return;
  instance.visibilityPaused = false;
  if (instance.paused) return;
  instance.wrapper.setAttribute('data-journey-state', 'playing');
  if (instance.activeOrder != null) {
    resumeActiveStep(instance);
  }
}

function resumeActiveStep(instance) {
  const order = instance.activeOrder;
  const barCurrent = instance.progress[order] || 0;
  const lineCurrent = instance.lineProgress[order] || 0;

  const barRemaining = Math.max(0, instance.opts.storyDuration * (1 - barCurrent));
  animateBar(instance, order, 1, barRemaining, easeLinear,
    () => autoAdvance(instance, order));

  const lineRemaining = Math.max(0, instance.opts.drawPathDuration * (1 - lineCurrent));
  animateLine(instance, order, 1, lineRemaining, easeLinear);
}


// --------------------------------------------
// Camera
// --------------------------------------------
// For step N > 1, fit bounds of [step N-1, step N] so users see the leg of
// the journey ending at the active step. For step 1 (no previous unlocked
// step), center on the step itself.
function flyToActiveStep(instance, order) {
  const { map, mapboxgl, steps, opts } = instance;
  const step = steps.find((s) => s.order === order);
  if (!step) return;

  const prev = steps.find((s) => s.order === order - 1);
  const sameCoords = prev && prev.lat === step.lat && prev.lon === step.lon;

  if (prev && isStepUnlocked(prev) && !sameCoords) {
    const bounds = new mapboxgl.LngLatBounds([prev.lon, prev.lat], [prev.lon, prev.lat])
      .extend([step.lon, step.lat]);
    map.fitBounds(bounds, {
      duration: opts.flyDuration,
      essential: true
    });
  } else {
    // First step or same location as previous step — zoom in to the
    // location at the "origin" zoom level (same feel as step 1).
    map.flyTo({
      center: [step.lon, step.lat],
      zoom: 10,
      duration: opts.flyDuration,
      essential: true
    });
  }
}


// --------------------------------------------
// Instance lifecycle
// --------------------------------------------
function destroyInstance(inst) {
  if (typeof inst.destroy === 'function') {
    try { inst.destroy(); } catch (_) { /* ignore */ }
  }
  cancelAllStepAnimations(inst);
  if (inst.pins) {
    inst.pins.forEach((p) => { try { p.marker.remove(); } catch (_) { } });
  }
  if (inst.map) {
    // Remove all journey-* layers + sources first, then the map itself.
    try {
      inst.lineSegments.forEach((s) => {
        if (inst.map.getLayer(s.layerId)) inst.map.removeLayer(s.layerId);
        if (inst.map.getSource(s.sourceId)) inst.map.removeSource(s.sourceId);
      });
    } catch (_) { /* ignore */ }
    try { inst.map.remove(); } catch (_) { }
  }
  if (inst.io) {
    try { inst.io.disconnect(); } catch (_) { }
  }
  if (inst.ro) {
    try { inst.ro.disconnect(); } catch (_) { }
  }
  if (inst.wrapper) {
    delete inst.wrapper.dataset[INIT_FLAG];
  }
  journeyInstances.delete(inst);
}

function purgeStaleInstances() {
  journeyInstances.forEach((inst) => {
    if (!inst.wrapper || !document.contains(inst.wrapper)) destroyInstance(inst);
  });
  overlayInstances.forEach((inst) => {
    if (!inst.wrapper || !document.contains(inst.wrapper)) destroyOverlay(inst);
  });
}


// --------------------------------------------
// Per-element init
// --------------------------------------------
function initInstance(wrapper) {
  if (wrapper.dataset[INIT_FLAG] === 'initialized') return;

  const mapboxgl = (typeof window !== 'undefined') ? window.mapboxgl : null;
  if (!mapboxgl) {
    console.warn('[journey-map] mapbox-gl is not loaded. Add the CDN <script> tag to the Webflow <head>.');
    return;
  }

  const token = getMapboxToken(wrapper);
  if (!token) {
    console.warn('[journey-map] No Mapbox token found. Set window.MAPBOX_TOKEN or data-journey-token on the wrapper.');
    return;
  }

  const mapContainer = wrapper.querySelector('[data-journey-map]');
  if (!mapContainer) {
    console.warn('[journey-map] Missing [data-journey-map] inside [data-journey-init].');
    return;
  }

  const journey = readJourneyData(wrapper);
  const steps = journey.steps.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const known = stepsWithCoords(steps);
  if (known.length < 1) {
    console.warn('[journey-map] No usable steps in journey data; nothing to render.');
    return;
  }

  // Merge config: data attributes win over defaults.
  const opts = {
    mapStyle: readStringAttr(wrapper, 'data-journey-style', DEFAULTS.mapStyle),
    fitPadding: readNumberAttr(wrapper, 'data-journey-fit-padding', DEFAULTS.fitPadding),
    curvature: readNumberAttr(wrapper, 'data-journey-curvature', DEFAULTS.curvature),
    lineColor: readStringAttr(wrapper, 'data-journey-line-color', DEFAULTS.lineColor),
    lineWidth: readNumberAttr(wrapper, 'data-journey-line-width', DEFAULTS.lineWidth),
    storyDuration: readNumberAttr(wrapper, 'data-journey-story-duration', DEFAULTS.storyDuration),
    drawPathDuration: readNumberAttr(wrapper, 'data-journey-draw-path-duration', DEFAULTS.drawPathDuration),
    transitionDuration: readNumberAttr(wrapper, 'data-journey-transition-duration', DEFAULTS.transitionDuration),
    flyDuration: readNumberAttr(wrapper, 'data-journey-fly-duration', DEFAULTS.flyDuration),
    autoplay: readBoolAttr(wrapper, 'data-journey-autoplay', DEFAULTS.autoplay),
    bezierSamples: DEFAULTS.bezierSamples
  };

  // Clamp: line can't draw slower than the story bar fills.
  if (opts.drawPathDuration > opts.storyDuration) {
    opts.drawPathDuration = opts.storyDuration;
  }

  // Default initial active step = the FIRST unlocked step (auto-play starts
  // from the beginning). Designer can override via attribute.
  const activeOrderAttr = readNumberAttr(wrapper, 'data-journey-active-order', NaN);
  const initialActiveOrder = Number.isFinite(activeOrderAttr)
    ? activeOrderAttr
    : known[0].order;

  mapboxgl.accessToken = token;

  // Use a stable id on the container so Mapbox can attach. We never set the
  // id on the wrapper itself — only on the inner [data-journey-map].
  if (!mapContainer.id) mapContainer.id = 'journey-map-' + Math.random().toString(36).slice(2, 9);

  const map = new mapboxgl.Map({
    container: mapContainer.id,
    style: opts.mapStyle,
    center: [known[0].lon, known[0].lat],
    zoom: 7,
    minZoom: DEFAULTS.minZoom,
    maxZoom: DEFAULTS.maxZoom,
    maxBounds: DEFAULTS.maxBounds,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // Desktop: scroll-zoom off (page scrolls), drag-pan off (not useful
    // without scroll-zoom). Mouse users watch the cinematic flyTo.
    scrollZoom: false,
    dragPan: false,
    doubleClickZoom: false,
    // Touch: two-finger pinch-zoom + pan enabled. Single-finger scrolls the
    // page naturally because dragPan is off. No "use 2 fingers" overlay
    // (cooperativeGestures is off).
    touchZoomRotate: true
  });

  map.addControl(new mapboxgl.AttributionControl({ compact: true }));

  wrapper.dataset[INIT_FLAG] = 'initialized';

  const instance = {
    wrapper,
    mapContainer,
    map,
    mapboxgl,
    steps,
    opts,
    activeOrder: null,
    progress: {},          // { [order]: 0..1 } — bar fill
    lineProgress: {},      // { [order]: 0..1 } — line draw
    animationFrames: {},   // { [order]: rafId, ['line-'+order]: rafId }
    paused: false,
    visibilityPaused: true,
    pins: [],
    progressSegments: [],
    lineSegments: [],
    pinClickHandlers: [],
    segmentClickHandlers: [],
    pauseClickHandlers: [],
    navClickHandlers: [],
    dialogClones: [],
    ro: null,
    destroy: null
  };
  journeyInstances.add(instance);

  // Default the wrapper into the "playing" state so designers can target
  // [data-journey-state="playing"] in CSS to show the right icon from frame 1.
  wrapper.setAttribute('data-journey-state', 'playing');

  map.on('load', () => {
    if (!document.contains(wrapper)) return;

    // Lines, pins, progress bar, footer, per-step dialogs.
    instance.lineSegments = addJourneySegments(map, steps, opts);
    instance.pins = addPins(map, mapboxgl, steps);
    instance.progressSegments = buildProgressBar(wrapper, steps);
    instance.dialogClones = buildDialogs(wrapper, steps);
    updateLockedCount(wrapper);

    // Initialise every step's progress to 0 so the data structure exists
    // before the first setActiveStep call writes targets.
    steps.forEach((s) => {
      if (isStepUnlocked(s)) {
        instance.progress[s.order] = 0;
        instance.lineProgress[s.order] = 0;
      }
    });

    // Apply auto-detected occluder padding BEFORE the first fitBounds so the
    // overview frame already accounts for the header + content card.
    applyMapPadding(instance);

    // Frame the whole journey before the first flyTo, so the camera move
    // feels like a zoom-in from the overview rather than appearing mid-pan.
    fitBoundsToCoords(
      map,
      mapboxgl,
      known.map((s) => [s.lon, s.lat])
    );

    // Click handlers — phase 2 wiring stays. Clicking a non-locked segment
    // or pin re-triggers setActiveStep for that step, exercising the same
    // playback machinery (smooth undraw of future + replay of selected).
    instance.pins.forEach((p) => {
      const handler = () => setActiveStep(instance, p.step.order);
      p.element.addEventListener('click', handler);
      instance.pinClickHandlers.push({ element: p.element, handler });
    });

    instance.progressSegments.forEach((seg) => {
      if (!isStepUnlocked(seg.step)) return;
      seg.element.style.cursor = 'pointer';
      const handler = () => setActiveStep(instance, seg.step.order);
      seg.element.addEventListener('click', handler);
      instance.segmentClickHandlers.push({ element: seg.element, handler });
    });

    // Pause / resume — the designer marks the two icons inside the header
    // with [data-icon-playstate="play"] and [data-icon-playstate="pause"].
    // The SCSS hides whichever one represents the wrapper's CURRENT state
    // (so the visible icon is always the action you can take next). We wire
    // every icon as a click target; togglePause flips the state regardless
    // of which icon was clicked.
    wrapper.querySelectorAll('[data-icon-playstate-wrapper]').forEach((btn) => {
      btn.style.cursor = 'pointer';
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePause(instance);
      };
      btn.addEventListener('click', handler);
      instance.pauseClickHandlers.push({ element: btn, handler });
    });

    // Next / previous navigation buttons.
    wrapper.querySelectorAll('[data-journey-nav]').forEach((btn) => {
      const dir = (btn.getAttribute('data-journey-nav') || '').trim().toLowerCase();
      if (dir !== 'next' && dir !== 'previous') return;
      btn.style.cursor = 'pointer';
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (instance.activeOrder == null) return;
        const target = dir === 'next'
          ? nextUnlockedStep(instance.steps, instance.activeOrder)
          : prevUnlockedStep(instance.steps, instance.activeOrder);
        if (target) setActiveStep(instance, target.order);
      };
      btn.addEventListener('click', handler);
      instance.navClickHandlers.push({ element: btn, handler });
    });

    // Pause the journey while a dialog is open so the progress bar and
    // line animation freeze. Resume when the dialog closes (unless the
    // user had already manually paused before opening).
    const dialogOpenHandler = () => {
      instance._pausedBeforeDialog = instance.paused;
      if (!instance.paused) pauseStory(instance);
    };
    const dialogCloseHandler = () => {
      if (!instance._pausedBeforeDialog) resumeStory(instance);
    };
    document.addEventListener('dialog:open', dialogOpenHandler);
    document.addEventListener('dialog:close', dialogCloseHandler);
    instance.pauseClickHandlers.push(
      { element: document, event: 'dialog:open', handler: dialogOpenHandler },
      { element: document, event: 'dialog:close', handler: dialogCloseHandler }
    );

    // Defer auto-play until the component is visible. The observer pauses
    // playback when scrolled out and resumes when scrolled back in.
    instance.io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible) {
          if (instance.activeOrder == null) {
            instance.visibilityPaused = false;
            setActiveStep(instance, initialActiveOrder);
          } else {
            resumeFromVisibility(instance);
          }
        } else {
          pauseForVisibility(instance);
        }
      },
      { threshold: 0.15 }
    );
    instance.io.observe(wrapper);
  });

  // Watch BOTH the map container AND the wrapper, since the wrapper's
  // occluder children (header height, content card height) can change
  // independently of the map (e.g. font load, content swap on a beer change,
  // mobile viewport rotation). Either change should trigger padding recompute.
  const ro = new ResizeObserver(() => {
    if (!map || map._removed) return;
    map.resize();
    applyMapPadding(instance);
  });
  ro.observe(mapContainer);
  ro.observe(wrapper);
  instance.ro = ro;

  instance.destroy = () => {
    instance.pinClickHandlers.forEach(({ element, handler }) => {
      element.removeEventListener('click', handler);
    });
    instance.segmentClickHandlers.forEach(({ element, handler }) => {
      element.removeEventListener('click', handler);
    });
    instance.pauseClickHandlers.forEach(({ element, event, handler }) => {
      element.removeEventListener(event || 'click', handler);
    });
    instance.navClickHandlers.forEach(({ element, handler }) => {
      element.removeEventListener('click', handler);
    });
    destroyDialogs(instance.dialogClones);
    instance.dialogClones = [];
  };
}


// --------------------------------------------
// Unlock overlay
// --------------------------------------------
// When a `[data-journey-overlay]` element (`.geography_overlay`) exists
// inside the wrapper, the map is NOT initialised on page load. Instead we
// show a two-screen overlay:
//   Screen 1 (`[data-journey-unlock-step="1"]`) — hero + CTA "Start" button
//   Screen 2 (`[data-journey-unlock-step="2"]`) — 4-digit MM/YY input
// After a successful API call the overlay is hidden and `initInstance` runs.
//
// Markup inside `.geography_overlay`:
//   [data-journey-unlock-step="1"]  Screen 1, contains the Start CTA
//     <a data-journey-overlay-action="start" class="ui-button">Start</a>
//   [data-journey-unlock-step="2"]  Screen 2, initially display:none
//     .unlock_input-container
//       form.w-form                 Webflow form block (submit intercepted by JS)
//         .unlock_input-wrapper     One per digit (label + input pair)
//           label.unlock_input-label  Visually hidden, for screen readers
//           input.unlock_input[data-journey-date-digit="1"]  M
//         .unlock_input-wrapper
//           ...input[data-journey-date-digit="2"]             M
//         .unlock_separator          "/" divider (plain div/text)
//         .unlock_input-wrapper
//           ...input[data-journey-date-digit="3"]             Y
//         .unlock_input-wrapper
//           ...input[data-journey-date-digit="4"]             Y
//     [data-journey-overlay-error]  Error text container
const OVERLAY_INIT_FLAG = 'journeyOverlayInit';
const overlayInstances = new Set();

// Ordered digit indices for the 4-box MM/YY input.
const DIGIT_KEYS = ['1', '2', '3', '4'];

function getDigitInputs(overlay) {
  return DIGIT_KEYS.map(
    (k) => overlay.querySelector(`[data-journey-date-digit="${k}"]`)
  ).filter(Boolean);
}

function readDateFromDigits(overlay) {
  const digits = getDigitInputs(overlay);
  if (digits.length < 4) return null;
  const d1 = digits[0].value.trim();
  const d2 = digits[1].value.trim();
  const d3 = digits[2].value.trim();
  const d4 = digits[3].value.trim();
  if (!d1 || !d2 || !d3 || !d4) return null;
  return d1 + d2 + '/' + d3 + d4;
}

function validateDate(value) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  if (month < 1 || month > 12) return null;
  return { month: match[1], year: match[2], formatted: match[1] + '/' + match[2] };
}

function setOverlayError(overlay, message) {
  const el = overlay.querySelector('[data-journey-overlay-error]');
  if (el) el.textContent = message || '';
}

function setOverlayLoading(overlay, loading) {
  overlay.querySelectorAll('[data-journey-overlay-action="submit"]').forEach((btn) => {
    btn.disabled = loading;
    btn.setAttribute('aria-busy', String(loading));
  });
  getDigitInputs(overlay).forEach((inp) => { inp.disabled = loading; });
}

function showUnlockStep(overlay, step) {
  const s1 = overlay.querySelector('[data-journey-unlock-step="1"]');
  const s2 = overlay.querySelector('[data-journey-unlock-step="2"]');
  if (s1) s1.style.display = step === 1 ? '' : 'none';
  if (s2) s2.style.display = step === 2 ? '' : 'none';
}

async function submitDate(wrapper, overlay) {
  setOverlayError(overlay, '');
  const raw = readDateFromDigits(overlay);
  const parsed = validateDate(raw);
  if (!parsed) {
    setOverlayError(overlay, 'Please enter a valid date (MM/YY).');
    return;
  }

  const beerSlug = wrapper.getAttribute('data-journey-beer-slug') || '';

  // ── Fixture / demo mode ──────────────────────────────────────────────
  // When no beer slug is configured we skip the API call entirely and
  // validate against the hardcoded FIXTURE_FALLBACK date.
  if (!beerSlug) {
    if (parsed.formatted !== FIXTURE_DATE) {
      setOverlayError(overlay, 'No journey found for this date.');
      return;
    }
    wrapper.setAttribute('data-journey-data', JSON.stringify(FIXTURE_FALLBACK));
    overlay.style.display = 'none';
    initInstance(wrapper);
    return;
  }

  // ── Production mode — fetch from Netlify function ────────────────────
  setOverlayLoading(overlay, true);
  try {
    const res = await fetch('/.netlify/functions/journey-unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ beerSlug, date: parsed.formatted })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setOverlayError(overlay, body.error || 'No journey found for this date.');
      return;
    }

    const { journey } = await res.json();
    if (!journey || !Array.isArray(journey.steps) || journey.steps.length === 0) {
      setOverlayError(overlay, 'No journey data available for this date.');
      return;
    }

    wrapper.setAttribute('data-journey-data', JSON.stringify(journey));
    overlay.style.display = 'none';
    initInstance(wrapper);
  } catch (err) {
    console.error('[journey-map] unlock fetch failed', err);
    setOverlayError(overlay, 'Network error. Please try again.');
  } finally {
    setOverlayLoading(overlay, false);
  }
}

function destroyOverlay(inst) {
  if (inst.handlers) {
    inst.handlers.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
  }
  overlayInstances.delete(inst);
}

function initOverlay(wrapper, overlay) {
  if (wrapper.dataset[OVERLAY_INIT_FLAG]) return;
  if (wrapper.dataset[INIT_FLAG] === 'initialized') return;

  wrapper.dataset[OVERLAY_INIT_FLAG] = 'initialized';
  const inst = { wrapper, overlay, handlers: [] };
  overlayInstances.add(inst);

  function addHandler(element, event, handler) {
    element.addEventListener(event, handler);
    inst.handlers.push({ element, event, handler });
  }

  // Ensure initial screen state: step 1 visible, step 2 hidden.
  showUnlockStep(overlay, 1);

  // Intercept Webflow's form submit — we handle submission via JS fetch,
  // not native form POST. Also hide Webflow's success/error banners.
  overlay.querySelectorAll('form').forEach((form) => {
    addHandler(form, 'submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      submitDate(wrapper, overlay);
    });
  });
  overlay.querySelectorAll('.w-form-done, .w-form-fail').forEach((el) => {
    el.style.display = 'none';
  });

  // Screen 1 → Screen 2: any [data-journey-overlay-action="start"] element,
  // or falls back to auto-detecting a.ui-button inside step 1.
  const step1 = overlay.querySelector('[data-journey-unlock-step="1"]');
  if (step1) {
    const explicitStart = step1.querySelectorAll('[data-journey-overlay-action="start"]');
    const triggers = explicitStart.length > 0
      ? Array.from(explicitStart)
      : Array.from(step1.querySelectorAll('a.ui-button, button.ui-button, [role="button"]'));

    // iOS Safari only opens the keyboard for a .focus() that happens
    // synchronously inside a user-gesture handler AND on an element that
    // is currently visible. Step 2 is display:none at this point, so we
    // use a tiny off-screen proxy input: focus it synchronously (keyboard
    // opens), swap screens, then move focus to the real digit input.
    const proxy = document.createElement('input');
    proxy.setAttribute('inputmode', 'numeric');
    proxy.setAttribute('pattern', '[0-9]*');
    proxy.setAttribute('aria-hidden', 'true');
    proxy.setAttribute('tabindex', '-1');
    Object.assign(proxy.style, {
      position: 'fixed', left: '-9999px', top: '0',
      width: '1px', height: '1px', opacity: '0',
      border: 'none', padding: '0', margin: '0'
    });
    overlay.appendChild(proxy);

    triggers.forEach((btn) => {
      addHandler(btn, 'click', (e) => {
        e.preventDefault();
        proxy.focus({ preventScroll: true });
        showUnlockStep(overlay, 2);
        const digs = getDigitInputs(overlay);
        if (digs[0]) {
          requestAnimationFrame(() => {
            digs[0].focus({ preventScroll: true });
            proxy.remove();
          });
        }
      });
    });
  }

  // 4-digit date inputs: numeric filter, auto-advance, backspace retreat.
  // Force inputmode + pattern so mobile browsers always show the numpad,
  // regardless of what the Webflow designer set as the input type.
  const digits = getDigitInputs(overlay);
  digits.forEach((inp) => {
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('pattern', '[0-9]*');
  });
  digits.forEach((input, idx) => {
    addHandler(input, 'input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value.length === 1 && idx < digits.length - 1) {
        digits[idx + 1].focus({ preventScroll: true });
      }
      // Auto-submit when the last digit is filled.
      if (idx === digits.length - 1 && input.value.length === 1) {
        submitDate(wrapper, overlay);
      }
    });

    addHandler(input, 'keydown', (e) => {
      if (e.key === 'Backspace' && input.value === '' && idx > 0) {
        e.preventDefault();
        digits[idx - 1].value = '';
        digits[idx - 1].focus({ preventScroll: true });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        submitDate(wrapper, overlay);
      }
    });

    // Handle paste (e.g. "0126" or "01/26") — distribute across boxes.
    addHandler(input, 'paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const nums = text.replace(/\D/g, '').slice(0, 4);
      for (let i = 0; i < nums.length && i < digits.length; i++) {
        digits[i].value = nums[i];
      }
      const focusIdx = Math.min(nums.length, digits.length - 1);
      digits[focusIdx].focus({ preventScroll: true });
      if (nums.length >= 4) submitDate(wrapper, overlay);
    });
  });

  // Explicit submit button (optional — auto-submit fires on 4th digit).
  overlay.querySelectorAll('[data-journey-overlay-action="submit"]').forEach((btn) => {
    addHandler(btn, 'click', (e) => {
      e.preventDefault();
      submitDate(wrapper, overlay);
    });
  });
}


// --------------------------------------------
// Entry
// --------------------------------------------
function initJourneyMap(container) {
  container = container || document;
  purgeStaleInstances();
  const wrappers = container.querySelectorAll(SELECTOR);
  if (!wrappers.length) return;
  wrappers.forEach((wrapper) => {
    const overlay = wrapper.querySelector('[data-journey-overlay]');
    if (overlay) {
      initOverlay(wrapper, overlay);
    } else {
      initInstance(wrapper);
    }
  });
}

function journeyMap() {
  const scheduleInit = (container) => {
    requestAnimationFrame(() => initJourneyMap(container));
  };

  document.addEventListener('barba:afterEnter', (e) => {
    scheduleInit(e.detail.container);
  });

  initJourneyMap();
}

export default journeyMap;
