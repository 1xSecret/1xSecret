/**
 * Runs once when the server process starts (never during `next build`):
 *
 * 1. Fail-fast validation of the runtime configuration.
 * 2. Install the socket-IP hook that anchors client-IP resolution.
 * 3. Start the expiry/retention sweeper.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadConfig } = await import("./lib/server/config");
  const config = loadConfig(); // throws ConfigError with a readable list

  const { installSocketIpHook } = await import("./lib/server/socket-ip-hook");
  installSocketIpHook();

  const { startSweeper } = await import("./lib/server/sweeper");
  startSweeper();

  console.log(
    `[1xsecret] started — mode=${config.accessMode}, defaultLanguage=${config.defaultLanguage}, ` +
      `replicas=${config.databaseReplicaUrls.length}, indexing=${config.allowIndexing ? "on" : "off"}`,
  );
}
