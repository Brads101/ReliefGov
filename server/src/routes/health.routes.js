import { Router } from 'express';
import env from '../config/env.js';
import dataSource from '../data/dataSource.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    system: 'ReliefGov',
    identity: 'ReliefGov — Disaster Assistance Profiling and Beneficiary Validation System.',
    version: '0.1.0',
    batch: 'Batch 1 — foundation'
  });
});

router.get('/health', (req, res) => {
  const source = dataSource.describeSource();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
    supabaseConfigured: env.supabaseConfigured,
    serviceRoleConfigured: env.serviceRoleConfigured,
    dataSource: source,
    authMode: env.supabaseConfigured
      ? 'supabase'
      : env.enableDevDemoLogin
        ? 'development-demo'
        : 'none',
    implementationScope: {
      barangay: 'Tambacan',
      city: 'Iligan City',
      province: 'Lanao del Norte',
      centralOffice: 'CSWD Office, Iligan City'
    }
  });
});

export default router;
