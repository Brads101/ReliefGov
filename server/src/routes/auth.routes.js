import { Router } from 'express';
import env from '../config/env.js';
import {
  login,
  register,
  requestPasswordReset,
  completePasswordReset,
  updateOwnProfile,
  devDemoAccounts,
  ROLE_LABELS,
  IMPLEMENTATION_BARANGAY
} from '../services/authService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const result = await login(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const result = await register(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const result = await requestPasswordReset(req.body?.email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const result = await completePasswordReset(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Stateless HS256 sessions cannot be revoked server-side; logout discards
 * the token on the client. The endpoint exists so the client has a single
 * documented place to call, and so future token revocation can be added here.
 */
router.post('/logout', requireAuth, (req, res) => {
  res.json({
    ok: true,
    message: 'Session ended. Sign in again to continue.'
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, roleLabel: ROLE_LABELS[req.user.role] || req.user.role });
});

/**
 * Self-service profile update. Only the signed-in user's own row can be
 * touched, and only the display name is writable (see updateOwnProfile).
 */
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await updateOwnProfile(req.user, req.body || {});
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get('/session-config', (req, res) => {
  res.json({
    authMode: env.supabaseConfigured ? 'supabase' : env.enableDevDemoLogin ? 'development-demo' : 'none',
    registrationEnabled: env.supabaseConfigured,
    roles: ROLE_LABELS,
    implementationBarangay: IMPLEMENTATION_BARANGAY,
    demoAccounts: devDemoAccounts().map((a) => ({
      email: a.email,
      role: a.role,
      roleLabel: ROLE_LABELS[a.role],
      password: env.enableDevDemoLogin ? env.devDemoPassword : null
    })),
    notice: env.enableDevDemoLogin && !env.supabaseConfigured
      ? 'Development demo accounts are active because Supabase Auth is not configured. These are demonstration accounts only.'
      : null
  });
});

export default router;
