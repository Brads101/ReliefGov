import app from './app.js';
import env from './config/env.js';

app.listen(env.port, () => {
  console.log(`[ReliefGov] API server listening on http://localhost:${env.port}/api`);
  console.log(`[ReliefGov] Health check: http://localhost:${env.port}/api/health`);
});
