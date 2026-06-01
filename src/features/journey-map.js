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
// PHASE STATUS (current: phase 3 — playback)
//   Phase 1 ✅  map init, pins, polyline with bezier fallback, dark style.
//   Phase 2 ✅  progress bar, content card, click navigation, locked %.
//   Phase 3 ✅  auto-play, per-step progress, draw/undraw on navigation.
//   Phase 4 ⏳  unlock modal + journey-unlock netlify fn.
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
//   <section data-journey-init data-journey-data='{"v":1,"steps":[…]}'>
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
//     <a   data-journey-content="link"></a>
//
//     <footer>
//       <span   data-journey-locked-count></span>   "40% data is locked"
//       <button data-journey-unlock></button>       (phase 4 wires the modal)
//     </footer>
//
//   </section>
//
//   Content slot values (data-journey-content="…"):
//     title          textContent ← step.title
//     story | quote  innerHTML   ← step.quote || step.story
//     name  | author textContent ← step.author.name
//     image | avatar src         ← step.author.avatar     (on <img>)
//     link | learn-more href     ← step.learnMoreUrl      (on <a>)
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
  storyDuration: 5000,
  transitionDuration: 800,
  flyDuration: 1800,
  autoplay: true,
  cooperativeGestures: false
};

// Fixture rendered when no `data-journey-data` is provided. Five steps with
// three unlocked + two locked = "40% data is locked", matching the Figma
// reference so we can demo phase 3 + 4 against realistic data.
const FIXTURE_FALLBACK = {
  v: 1,
  steps: [
    {
      order: 1,
      title: 'Barley grown on Belgian regenerative farms committed to healthier soils.',
      story: '<p>Our barley is grown on small Walloon farms practicing no-till agriculture. Healthier soils, better grain.</p>',
      quote: 'I have been practicing no-till farming for 20 years. I am convinced that living soil allows for healthier cultivation.',
      author: { name: 'Étienne Allard', avatar: '' },
      learnMoreUrl: '#',
      lat: 50.2929,
      lon: 5.0944, // Ciney
      // Ciney → Namur (31.1 km driving) — Mapbox Directions API polyline.
      lineToNext: 'wz}qHe}a^KSS]OWq@oACEGMIMU[KSWc@mA{BkAyBEIGKy@yAwAgCGKIMo@kAq@mAIOGE][]UUOk@e@eA}@_@[OKQMAECECCEAO[m@cAO[KUIQEMEe@k@?S?C?S?wB@}@?wBDc@Dk@PODGBIDMFiDfBc@V[Ne@LQAGGIEIAGBIHGLCPSXKHQPMLGB??k@ZgDdBwAt@gGbDgGbDcBx@a@DSBg@?m@KcB_@o@OyBg@c@K_@Ky@[qBw@eGwBeBm@iBi@{FmByC}@qF}AsJiCoEeA}A[a@I[IcBa@}AYuE}@q@MUEkAUUEaAOaGaAIA}AWaDe@cDe@cBIqAEwA@cBHw@H_@BaAHi@DwBTE?e@DM\\Sj@a@pA]bA_@pA_@lA_@zAMh@Mh@c@bBUx@c@nAQh@y@bBaEvJeEjJq@vAy@hBe@`AoBbEyBnE}FhLkC~EmC~EwEnIgBzCiBxCi@`AYb@sErH_AvAoInMe@t@}KvOkBhC}ApBwGtIuGnIgJnLoDrEkChDuAdBY\\g@p@cCxC_GrHiDrEkGrIsDtF{@tACBeDpFoAvBqA~BeB`D]r@a@v@kEvIaEbJoF~MqBpFmBtFe@vAyB`HCFKZGTELENqCtJeApD_@rASr@}AnFg@fBmIzYi@lB_GpS}ArFyB|H[fAcI`YoB~GuEfP{DpNqBtHqBvHkBxHiBzHi@`CkCxLwBfKy@~DA@WnAy@bEMl@On@e@bC[vAy@dEABwEfUwDfRq@~CUhA_@bByAdFe@rAsAlD}AdDw@xAqDjGaEbH_@n@qBhDw@rAMTiCpEkCrEoBpD}@~Am@bA}DjHE@QDqDrFsApBiCnDy@jAeChDaBxBsA`BkBpBkAlAo@l@a@^cG~EYPu@~@aHvFmC~BuDnDqCvCyCdD}CtD}CzDqC`EkCfE_DpFmBvDoBpE}BvFkBrFwA|EyAlFoDdN{AfF_B`FiBxEuBtEyBxDeCvDiCdD_DfDkC~BaDxBuAv@mAr@{CxAiDnA_DhAkD`AcDx@cDr@iDv@oMrCiCj@iTvE_JxBoDbAoDjAkDpA}CpAiD~AkDfB{Az@wBpAuBnAaDvBcD~B}C`C}CdCqR|O}HlG_F|DsHxFwIhGaAp@cC~AiDxBeEjC_@RoG|DyHvE_E`C_EbC}EvCkDrBm[jR_@Ts]pSoAt@}EpCc@?i@Pg@H_@@_@EWM[QW]]m@Ys@SYWQc@Oa@Ba@NYTe@~@Q^UZO@I@UIEUKOMIOCMBMJKPCLCN?T@NDNJTJHJDJ?LE^\\LNrA|BdChEJLJZFZB^FZHPJHNBLCLNHHJNh@|@vKpQ~@~A@BD\\HZ?BBLFH@?RXRLRTPVfAfBtDjGvA|BdBhCFJfAbBZ\\dF|HZl@h@jA`@bA\\bA`@vAf@xBTxAPjABNJ~@L`ALhA^tDDb@NdBRdCJ`BNbDFlBFhBFpBFfBBr@D|AHlC@VCXE`@GHGLCN?N@PDLFLLHDTDN@FDz@XlK?NB`AB`ADrB@H@x@JjDAzADfBBt@@V??Bv@@f@?L?DAVETa@v@e@fAYp@m@|BSt@CFi@lBIh@Sv@ELa@rA]jAQn@[lAI^ADI\\Kn@k@rCSrAG^S|AM~AGl@O~AI`@Gh@MtAEh@Cx@?dA?z@?P@n@Bf@HpADd@LzDJlDDf@L`AJb@V`ABFB@H?HEJMHMNiANiARmAD]Fm@Jm@BU@GRiB\\mDBMH{@'
    },
    {
      order: 2,
      title: 'Malted in the heart of Wallonia.',
      story: '<p>The grain is delivered to a regional maltster, who turns it into the malt that gives this beer its character.</p>',
      quote: 'Malting is the alchemy that wakes the grain up.',
      author: { name: 'Pierre Devos', avatar: '' },
      learnMoreUrl: '#',
      lat: 50.4674,
      lon: 4.8674, // Namur
      // Namur → Liège (64.3 km driving) — Mapbox Directions API polyline.
      lineToNext: 'i}_sHwtu\\NsALsABSBYb@aEDS@GDMb@gBTq@BGHMO[Wg@a@w@O[OWIOO[KUqB{DCCOOH]@EH_@ZmAPo@\\kA`@sADMRw@T]d@}ABG@CLc@Ng@r@}BFSXq@Xi@Na@FKNYNM@c@?AASAU?GQkFKkCMqD?GAUC_A?WAO?IW_JQuF?E?WB]BKBM@MAMAMEKGIC]Cc@GiBUwHE}AGsBKaCUiEGgAQmB_@qESmBUuBS}AAG?AIm@SeAUcACOg@kBUu@Uy@u@iBi@kAUa@g@{@}@wA_AyAyBiDwBkD[e@k@aA]i@s@kA_C{DYe@SYU[U[We@Ye@S]AC@SG[IM?GCGCGEAC?ISUOa@e@eAeBeAiBaCaEQWsA}BS_@{@wAIUKY@Q?OCWGSEGGGMCQAOCKIU[gCgEiB}CK]B]C[EUKOMIOCMBMJKPCLCN?T@NDNJTJHJ^DV?d@Et@Ef@Mr@Qr@Un@Uh@OTGFY\\e@^Sn@{FhDqElC}OvJaErCmEbDeGbFuAlAqDhD_F~EuGxGwJ`K}HdI}G~GuGlGgCxB_DjCgBvAwCtBmBrAu@d@}@j@cBdAmBdAuBhA{BhAsB`A}B`AmBt@kBp@}E`ByDhAaCn@}Bh@_Ez@wAFo@DuARcBT_C^}Er@uC`@cJ|Ao@R{AV_G`Aq@J_APsAR_@D[Dy@Ao@Ik@Se@[c@_@c@g@]o@Wm@Um@Qo@Mq@Im@Iq@K}@IaAIgAi@kFSaEO}DGgBIoCKqDIsDEoCIuFIwFEyFC{FE{JEgJQ{f@C}CAuCG}FE}BKaEMkEQwDKoBKkB[mEc@kFa@mEg@iEc@kDk@eEq@aEk@aDm@_De@}Bg@}BuAyFeAyDkA}DgAkDcBaFeBaFgBgFuAmEuA{EoAyEuA_Gc@sBc@}By@mEs@iEm@iEq@kFe@qEc@kESkCQcCQmCM_CQsDO_EGiBI{DGeDCmCAaF@mD@aCDeEH{DJwDNiEToETqDPgCVqD^oEZmD^}D~@qJZuCJkA|@kI^uDp@{Gh@oFj@iGl@_H`@oF\\aFT}EToEDgAJeDJwCHoDNmJDaI?iIEkGI_GGyDKkDMsDM{CMuCWsEUeEYaEk@uHm@yHe@qFi@kGsCs\\i@eGq@yH[yDi@sG]eFMeBc@cIM}CKwCKwDKuEEmFEuE?sD@cDBmDLmIvFmfDf@aXFwDh@}Z^gTvCsfBXySJoIDiI?sICuIMoIWmIa@cJk@mIs@mI_AiIkAgIuA_IyAkHkBqHqBiHyBaHaC}GkC{GgHoPaE_JmWqj@gDgHe@cA_CcFwIcR_EqIa@{@cJ{ReHiOaHeOgHqO_FoKcAuBcHiOaH_OaAwBaFsKcHaOwGsNiC{FiC_GaCiGcAkC{@eCw@}Bq@yBs@_CwAkFkM_j@aHaZeMwi@iBkHmBkHqBiHsBcHwB}GyByG}FkP_G_PgEcLkDoJgC}GmG{PeCyGw@}BeEeLaDiJmD}KkBkGsA_F}@kDk@}B_BgH}AuHqAwHoA}HeAyH}@}Hy@gIq@kIk@uIe@oI_@qIYeJYkJSiIe@iTgAei@a@cSYkMSsKiBs{@_@aR}Ey`Ce@iRa@iK]iI{@uN{@wK_@mDk@sFgA{Ic@}C{@oF{@kFwAoH{AoH}AaHeBoHeBaH_Lic@oOam@kM_g@{BuIuBgIaBqGiBkH{AiGoBgJuBiKoAaHyAgJmAmIu@qF_ZafCw@oHm@cIa@mHQyDkAkY[mHWeH{Bgi@i@eLOoCQqCq@}Hw@uHcAsHgAkHsAkH{AcHcBuGgBiGmEeNiDmKqEgNk[aaAyFgQgZe~@aHaT}@gCqAoDoAyCoAwC{CwG{F_L_B_DyEgJ{HgO{CaGiAwBoAqCuByEgHgQsA_DeBiEeCgGaCyFcE}JaLiXkDuI_EwJuBcFgAcCkA}Bu@mAy@mAw@eA_AgAcAcAaA{@aAu@k@_AaAm@s@c@uBiAq@]s@c@w@o@o@q@m@u@i@{@g@aAc@gAa@oA[mAWsASwAOwAI}AEyAEoCCcCEwJ?uFBgBH_BJsAXyBX{Ab@aB`@iA^_A`AqBj@iA~CsG`A_Cd@qAJ_ARk@Na@bAcD|@uDt@yDTyAVgB`@uDXkDLsCJiCFcCT{LBcB^kT^yTJmDFkBHuAPeCJkATyBX{Bf@yCRmAl@_DbDqPtAiHh@gCf@wBd@iBl@uBb@oAz@{B|@qBp@uArA_CvAwBtEoGfB}BrGoJj@aAdBwCf@}@`@s@n@qAn@uAdAwBvB}E~ByF~AcE`AeClC}G`D}I`CiHx@{BXm@N_@n@kAtAqB\\a@d@i@z@w@dD}C|@y@`AaAZM\\Yh@e@vBkBRMr@e@r@c@bB_AdCwATOVKb@MbAKn@GVCFCDCDGDEDIBIBK@M@KAQCSIi@AIGa@CQAE?ICMAGGq@G}@C{@CcCEaC?]a@}MO{D@[D[FQ@GNUPOb@E|@SRF~@]z@a@bBgANIHQDI@K?C@K?ICI?AAGAAEMMK[QY[YQsAo@s@UWGe@Mg@M_@Eg@CWOGICICQASHyB@[@QBk@@]@_@B[?G?GH_BTsF'
    },
    {
      order: 3,
      title: 'Brewed within a few hours of the field.',
      story: '<p>From malt to mash to fermentation, every batch is brewed locally — never further than a short truck ride from the barley.</p>',
      quote: 'A beer should taste of the land it comes from.',
      author: { name: 'Sophie Bernard', avatar: '' },
      learnMoreUrl: '#',
      lat: 50.6326,
      lon: 5.5734 // Liège
    },
    // Locked steps — no coords, no content. The unlock flow (phase 4) will
    // fetch batch-specific coordinates from Origino and fill these in.
    { order: 4, batchDependent: true },
    { order: 5, batchDependent: true }
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
// `geometries=polyline` (precision 5). About 3× more compact than a raw
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
  // A step is "known" when it has finite lat/lon AND no batchDependent flag
  // is set. We stop at the first unknown so the drawn line ends cleanly.
  const result = [];
  for (const step of steps) {
    if (step.batchDependent === true) break;
    if (!isFiniteNumber(step.lat) || !isFiniteNumber(step.lon)) break;
    result.push(step);
  }
  return result;
}

function isStepUnlocked(step) {
  return !step.batchDependent
    && isFiniteNumber(step.lat)
    && isFiniteNumber(step.lon);
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
  if (coords.length < 2) return;
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new mapboxgl.LngLatBounds(coords[0], coords[0])
  );
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
    if (lockEl) lockEl.style.display = step.batchDependent ? '' : 'none';

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
      if (url) {
        el.setAttribute('src', url);
        el.style.display = '';
      } else if (el.getAttribute('src')) {
        el.removeAttribute('src');
      }
      break;
    }

    case 'link':
    case 'learn-more':
    case 'learnmore':
      if (el.tagName === 'A') {
        el.setAttribute('href', step.learnMoreUrl || '#');
      }
      break;

    default:
      // Unknown slot — silently ignore.
      break;
  }
}

// Tiny helper for non-card slots (footer locked count, etc.).
function setSlot(wrapper, selector, fn) {
  const el = wrapper.querySelector(selector);
  if (el) fn(el);
}


// --------------------------------------------
// Locked count footer
// --------------------------------------------
function updateLockedCount(wrapper, steps) {
  const locked = steps.filter((s) => s.batchDependent === true).length;
  const total = steps.length;
  const percent = total > 0 ? Math.round((locked / total) * 100) : 0;

  setSlot(wrapper, '[data-journey-locked-count]', (el) => {
    el.textContent = locked > 0 ? `${percent}% data is locked` : '';
  });

  wrapper.setAttribute('data-journey-unlock-state', locked > 0 ? 'incomplete' : 'complete');
}


// --------------------------------------------
// Per-step progress (single source of truth)
// --------------------------------------------
// `setStepProgress` is the only function that should write to a step's
// progress: it keeps the in-memory value, the progress-bar CSS variable, and
// the corresponding line layer's trim-offset in lock-step. All animation
// loops funnel through it.
function setStepProgress(instance, order, value) {
  const v = Math.max(0, Math.min(1, value));
  instance.progress[order] = v;

  const seg = instance.progressSegments.find((s) => s.step.order === order);
  if (seg) {
    // Keep the CSS variable up to date for designers who prefer to drive
    // their own fill (linear-gradient, width-based, anything that reads
    // var(--progress)).
    seg.element.style.setProperty('--progress', v.toFixed(4));
    // And drive the inner fill via inline transform — see buildProgressBar
    // for why we do this directly instead of relying on the SCSS default.
    if (seg.progressEl) {
      seg.progressEl.style.transform = `scaleX(${v.toFixed(4)})`;
    }
  }

  const lineSeg = instance.lineSegments.find((s) => s.toOrder === order);
  if (lineSeg && instance.map && instance.map.getLayer(lineSeg.layerId)) {
    // `line-trim-offset: [a, b]` marks the line range [a, b] as TRANSPARENT
    // (Mapbox calls this the "vanishing" range). The line geometry is stored
    // ordered from N-1 → N, so to draw it forwards we want the transparent
    // window to start at `progress` and extend to 1:
    //   progress 0 ⇒ [0, 1] (entire line transparent → hidden)
    //   progress 0.5 ⇒ [0.5, 1] (first half visible, second half transparent)
    //   progress 1 ⇒ [1, 1] (zero-length range → fully visible)
    // The visible fraction grows from the start of the geometry (origin)
    // toward the end (destination), which is what reads as "drawing the line
    // from location N-1 to location N".
    instance.map.setPaintProperty(lineSeg.layerId, 'line-trim-offset', [v, 1]);
  }
}

function cancelStepAnimation(instance, order) {
  if (instance.animationFrames[order]) {
    cancelAnimationFrame(instance.animationFrames[order]);
    delete instance.animationFrames[order];
  }
}

function cancelAllStepAnimations(instance) {
  Object.keys(instance.animationFrames).forEach((order) => {
    cancelAnimationFrame(instance.animationFrames[order]);
  });
  instance.animationFrames = {};
}

function animateProgress(instance, order, target, durationMs, easing, onDone) {
  cancelStepAnimation(instance, order);

  const start = instance.progress[order] || 0;

  // Skip the animation if there's no real distance to cover, or if the user
  // prefers reduced motion. Either way, snap to target and call onDone.
  if (durationMs <= 0 || Math.abs(start - target) < 0.001 || prefersReducedMotion()) {
    setStepProgress(instance, order, target);
    if (onDone) onDone();
    return;
  }

  const startTs = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - startTs) / durationMs);
    const eased = easing(t);
    setStepProgress(instance, order, start + (target - start) * eased);
    if (t < 1) {
      instance.animationFrames[order] = requestAnimationFrame(frame);
    } else {
      delete instance.animationFrames[order];
      if (onDone) onDone();
    }
  }
  instance.animationFrames[order] = requestAnimationFrame(frame);
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
    const s = seg.step;
    let state;
    if (s.batchDependent) state = 'locked';
    else if (s.order === order) state = 'active';
    else state = 'unlocked';
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
        animateProgress(
          instance,
          s.order,
          1,
          instance.opts.storyDuration,
          easeLinear,
          () => autoAdvance(instance, s.order)
        );
      };

      if (isFirstActivation || current === 0) {
        // Nothing to undraw; play directly.
        playStory();
      } else {
        // Smooth undraw (current → 0), then linear play (0 → 1).
        animateProgress(
          instance,
          s.order,
          0,
          instance.opts.transitionDuration,
          easeInOutCubic,
          playStory
        );
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
  const current = instance.progress[order] || 0;
  const remainingMs = Math.max(0, instance.opts.storyDuration * (1 - current));

  animateProgress(
    instance,
    order,
    1,
    remainingMs,
    easeLinear,
    () => autoAdvance(instance, order)
  );
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

  if (prev && isStepUnlocked(prev)) {
    const bounds = new mapboxgl.LngLatBounds([prev.lon, prev.lat], [prev.lon, prev.lat])
      .extend([step.lon, step.lat]);
    // No `padding` option here — `map.setPadding(...)` set during init
    // (and on every resize) acts as the persistent default. Passing one
    // here would override the auto-detected occluder padding.
    map.fitBounds(bounds, {
      duration: opts.flyDuration,
      essential: true
    });
  } else {
    // First step (no previous leg) — zoom in to the location so the user
    // sees a clear focus on the origin before any line starts drawing.
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
    transitionDuration: readNumberAttr(wrapper, 'data-journey-transition-duration', DEFAULTS.transitionDuration),
    flyDuration: readNumberAttr(wrapper, 'data-journey-fly-duration', DEFAULTS.flyDuration),
    autoplay: readBoolAttr(wrapper, 'data-journey-autoplay', DEFAULTS.autoplay),
    bezierSamples: DEFAULTS.bezierSamples
  };

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
    progress: {},          // { [order]: 0..1 }
    animationFrames: {},   // { [order]: rafId }
    paused: false,
    visibilityPaused: true,
    pins: [],
    progressSegments: [],
    lineSegments: [],
    pinClickHandlers: [],
    segmentClickHandlers: [],
    pauseClickHandlers: [],
    ro: null,
    destroy: null
  };
  journeyInstances.add(instance);

  // Default the wrapper into the "playing" state so designers can target
  // [data-journey-state="playing"] in CSS to show the right icon from frame 1.
  wrapper.setAttribute('data-journey-state', 'playing');

  map.on('load', () => {
    if (!document.contains(wrapper)) return;

    // Lines, pins, progress bar, footer.
    instance.lineSegments = addJourneySegments(map, steps, opts);
    instance.pins = addPins(map, mapboxgl, steps);
    instance.progressSegments = buildProgressBar(wrapper, steps);
    updateLockedCount(wrapper, steps);

    // Initialise every step's progress to 0 so the data structure exists
    // before the first setActiveStep call writes targets.
    steps.forEach((s) => {
      if (isStepUnlocked(s)) instance.progress[s.order] = 0;
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
    wrapper.querySelectorAll('[data-icon-playstate]').forEach((btn) => {
      btn.style.cursor = 'pointer';
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePause(instance);
      };
      btn.addEventListener('click', handler);
      instance.pauseClickHandlers.push({ element: btn, handler });
    });

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
    instance.pauseClickHandlers.forEach(({ element, handler }) => {
      element.removeEventListener('click', handler);
    });
  };
}


// --------------------------------------------
// Entry
// --------------------------------------------
function initJourneyMap(container) {
  container = container || document;
  purgeStaleInstances();
  const wrappers = container.querySelectorAll(SELECTOR);
  if (!wrappers.length) return;
  wrappers.forEach(initInstance);
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
