import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load server/.env, falling back to a repository-root .env if present.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  sessionSecret: process.env.SESSION_SECRET || 'change-me-to-a-long-random-string',
  useSyntheticDemoData: bool(process.env.USE_SYNTHETIC_DEMO_DATA, false),
  enableDevDemoLogin: bool(process.env.ENABLE_DEV_DEMO_LOGIN, false),
  devDemoPassword: process.env.DEV_DEMO_PASSWORD || 'ReliefGov!Demo123'
};

env.supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
env.serviceRoleConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);

if (!env.supabaseConfigured && !env.useSyntheticDemoData) {
  console.warn(
    '[ReliefGov] SUPABASE_URL/SUPABASE_ANON_KEY are not set and USE_SYNTHETIC_DEMO_DATA is false. ' +
      'Data endpoints will report "database not configured".'
  );
}

if (env.useSyntheticDemoData) {
  console.warn(
    '[ReliefGov] Running with SYNTHETIC DEMONSTRATION DATA for Barangay Tambacan. ' +
      'These records are not real beneficiaries.'
  );
}

export default env;
