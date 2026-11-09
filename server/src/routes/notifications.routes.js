import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listOwn, markRead, markAllRead, getOwnCounts } from '../services/notificationService.js';

/**
 * In-app notifications for the signed-in user only. A beneficiary is told
 * when their application changes status; nothing cross-account is exposed.
 *
 *  GET    /            — own history (category / unread filters, pagination)
 *  GET    /counts      — own unread + total counters (dashboard)
 *  POST   /read-all    — mark every own unread notification as read
 *  POST   /:id/read    — mark one of the caller's notifications as read
 *
 * Every route is scoped to req.user inside the service; a notification id
 * belonging to another account answers 404 and can never be read or altered.
 */
const router = Router();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const result = await listOwn(req.user, {
      limit: req.query.limit,
      offset: req.query.offset,
      category: req.query.category,
      unread: req.query.unread
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/counts', async (req, res, next) => {
  try {
    res.json(await getOwnCounts(req.user));
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    res.json(await markAllRead(req.user));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    res.json(await markRead(req.user, req.params.id));
  } catch (err) {
    next(err);
  }
});

export default router;
