/** Staging / Localhost Detection
 *
 * On staging (.webflow.io) with dev-mode attribute: tries localhost dev server first.
 * If localhost is available, loads the dev version with HMR.
 * If not, falls back to the bundled code.
 *
 * On production (custom domain): runs the bundled code immediately.
 *
 * Usage: <script src="main.min.js" dev-mode></script>
 */

const DEV_PORT = 3011;
const DEV_MESSAGE = "🚧 Dev Mode activated";
const LIVE_MESSAGE = "🛸 Hi there explorer! You have stumbeled upon the mothership. Lookinging for secretes?";

export function detectAndRun(runApp) {
  if (window.__LOADER_EXECUTED) {
    runApp();
    return;
  }
  window.__LOADER_EXECUTED = true;

  const isStaging = window.location.hostname.endsWith('.webflow.io');
  const hasDevMode = !!document.querySelector('script[src*="main"][dev-mode]');

  if (isStaging && hasDevMode) {
    tryLocalDevServer(runApp);
  } else {
    runBundled(runApp);
  }
}

function runBundled(runApp) {
  console.log(LIVE_MESSAGE);
  runApp();
}

function tryLocalDevServer(runApp) {
  const localhostUrl = `http://localhost:${DEV_PORT}/src/main.js`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300);

  fetch(localhostUrl, { method: 'HEAD', signal: controller.signal, mode: 'no-cors' })
    .then(() => {
      clearTimeout(timeoutId);
      console.log(DEV_MESSAGE);

      const viteClient = document.createElement('script');
      viteClient.type = 'module';
      viteClient.src = `http://localhost:${DEV_PORT}/@vite/client`;
      document.head.appendChild(viteClient);

      const devScript = document.createElement('script');
      devScript.type = 'module';
      devScript.src = localhostUrl;
      document.body.appendChild(devScript);
    })
    .catch(() => {
      clearTimeout(timeoutId);
      runBundled(runApp);
    });
}
