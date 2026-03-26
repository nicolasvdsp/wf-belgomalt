/**
 * INLINE LOADER SCRIPT — For future reference only
 * 
 * This is the standalone loader approach: paste this entire script
 * in Webflow's Custom Code section (Before </body> tag).
 * 
 * Currently NOT in use — the loader logic is built into main.min.js instead.
 * Keep this as reference in case you ever need an inline loader again.
 * 
 * How it works:
 * - On staging (.webflow.io): tries localhost first, falls back to Netlify (unminified)
 * - On production (custom domain): loads from Netlify only (minified)
 */

(function () {
  'use strict';

  // ============================================
  // CONFIGURATION — Update these per project
  // ============================================
  const NETLIFY_URL = 'https://MY-PROJECT.netlify.app';
  const LOCAL_PORT = 3011;
  const FORCE_REFRESH_VERSION = '1.0.0';

  // ============================================
  // ENVIRONMENT DETECTION
  // ============================================
  const isStaging = window.location.hostname.endsWith('.webflow.io');

  // ============================================
  // URL CONSTRUCTION
  // ============================================
  const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;
  const LOCALHOST_SCRIPTS = [
    `${LOCAL_URL}/@vite/client`,
    `${LOCAL_URL}/src/main.js`,
  ];
  const PROD_SCRIPT = `${NETLIFY_URL}/main.min.js?v=${FORCE_REFRESH_VERSION}`;
  const STAGING_SCRIPT = `${NETLIFY_URL}/main.js?v=${FORCE_REFRESH_VERSION}`;

  // ============================================
  // SCRIPT LOADING
  // ============================================
  function createScript(url, isDevMode = false) {
    const script = document.createElement('script');
    script.src = url;
    if (isDevMode) script.type = 'module';
    return script;
  }

  function loadScript(script) {
    return new Promise((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load: ${script.src}`));
      document.body.appendChild(script);
    });
  }

  function loadScriptsSequentially(scripts) {
    return scripts.reduce((promise, script) => {
      return promise.then(() => loadScript(script));
    }, Promise.resolve());
  }

  // ============================================
  // LOCALHOST DETECTION
  // ============================================
  function testLocalhost() {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300);

      fetch(LOCALHOST_SCRIPTS[0], {
        method: 'HEAD',
        signal: controller.signal,
        mode: 'no-cors'
      })
        .then(() => { clearTimeout(timeoutId); resolve(true); })
        .catch(() => { clearTimeout(timeoutId); resolve(false); });
    });
  }

  // ============================================
  // MAIN
  // ============================================
  async function init() {
    let scriptsToLoad = null;
    let isDevMode = false;

    if (!isStaging) {
      // Production: minified from Netlify
      scriptsToLoad = [createScript(PROD_SCRIPT, false)];
    } else {
      // Staging: try localhost first
      const localhostAvailable = await testLocalhost();

      if (localhostAvailable) {
        scriptsToLoad = LOCALHOST_SCRIPTS.map(url => createScript(url, true));
        isDevMode = true;
        console.log('[Loader] Dev server detected');
      } else {
        scriptsToLoad = [createScript(STAGING_SCRIPT, false)];
        console.log('[Loader] Using Netlify (unminified)');
      }
    }

    try {
      await loadScriptsSequentially(scriptsToLoad);
    } catch (error) {
      console.error('[Loader] Error:', error);

      if (isDevMode) {
        console.log('[Loader] Retrying with Netlify...');
        try {
          await loadScript(createScript(STAGING_SCRIPT, false));
        } catch (fallbackError) {
          console.error('[Loader] Fallback failed:', fallbackError);
        }
      }
    }
  }

  init();
})();
