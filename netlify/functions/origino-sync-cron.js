/**
 * Origino -> Webflow CMS sync — scheduled entrypoint.
 *
 * Triggered by the `[functions."origino-sync-cron"] schedule = ...` block
 * in netlify.toml. Runs the same runSync() as the HTTP handler, but with
 * no auth (Netlify is the only caller) and no filter (always full sync).
 *
 * Netlify discards this function's HTTP response — the only observable
 * output is the log stream. Errors are surfaced via structured JSON log
 * lines emitted by the runner.
 */

const { loadConfig } = require('../lib/config');
const { runSync, logEvent } = require('../lib/runner');

exports.handler = async () => {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logEvent('error', { event: 'config_error', mode: 'cron', message: err.message });
    return { statusCode: 500 };
  }

  const result = await runSync({ mode: 'cron', config });

  return {
    statusCode: result.ok ? 200 : 502,
    body: JSON.stringify(result),
  };
};
