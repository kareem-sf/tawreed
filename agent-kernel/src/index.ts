const HEALTH_RESPONSE = '{"status":"ok","protocolVersion":1}\n';

export {};

if (process.argv.slice(2).includes('--health-check')) {
  process.stdout.write(HEALTH_RESPONSE);
} else {
  try {
    const [{ AgentKernel, productionProviders }, { runProcessLoop }] = await Promise.all([
      import('./kernel'),
      import('./process-loop'),
    ]);
    const kernel = new AgentKernel({
      providers: productionProviders(process.env),
      environment: process.env,
    });
    const outcome = await runProcessLoop({
      input: process.stdin,
      output: process.stdout,
      diagnostics: process.stderr,
      kernel,
    });
    if (outcome.forced) process.exit(0);
  } catch {
    process.stderr.write('Agent kernel terminated.\n');
    process.exitCode = 1;
  }
}
