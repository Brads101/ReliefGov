import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import beneficiariesRoutes from './beneficiaries.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import usersRoutes from './users.routes.js';
import documentsRoutes from './documents.routes.js';
import applicationsRoutes from './applications.routes.js';
import notificationsRoutes from './notifications.routes.js';
import validationRoutes from './validation.routes.js';
import reportsRoutes from './reports.routes.js';
import scoringRoutes from './scoring.routes.js';
import distributionRoutes from './distribution.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/beneficiaries', beneficiariesRoutes);
router.use('/users', usersRoutes);
router.use('/documents', documentsRoutes);
router.use('/applications', applicationsRoutes);
router.use('/notifications', notificationsRoutes);

// Batch 4: Data Validation & Duplicate Detection, and the barangay report
// preparation slice of Monitoring & Reporting, are live for staff roles.
router.use('/validation', validationRoutes);
router.use('/reports', reportsRoutes);

// Batch 5: Random Forest Vulnerability Scoring — live for staff roles.
router.use('/scoring', scoringRoutes);

// Batch 6: Monitoring & Reporting (full module), Aid Distribution
// Monitoring, and in-system notifications — live for staff roles.
router.use('/distributions', distributionRoutes);

// Core modules scheduled for later batches — explicit HTTP 501 until built.
export default router;
