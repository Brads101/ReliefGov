import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/layout/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Beneficiaries from './pages/Beneficiaries.jsx';
import Users from './pages/Users.jsx';
import Application from './pages/Application.jsx';
import ApplicationForm from './pages/ApplicationForm.jsx';
import Notifications from './pages/Notifications.jsx';
import Validation from './pages/Validation.jsx';
import Reports from './pages/Reports.jsx';
import Analytics from './pages/Analytics.jsx';
import Scoring from './pages/Scoring.jsx';
import Distribution from './pages/Distribution.jsx';
import Profile from './pages/Profile.jsx';
import NotFound from './pages/NotFound.jsx';
import { LoadingState } from './components/ui/States.jsx';

function RequireAuth({ roles, children }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="p-8">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

const STAFF = ['barangay_staff', 'cswd_staff'];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Beneficiary Profiling Module (Batch 3) */}
        <Route path="/application" element={<Application />} />
        <Route path="/application/new" element={<ApplicationForm />} />
        <Route path="/application/edit" element={<ApplicationForm />} />
        <Route path="/notifications" element={<Notifications />} />

        {/* Self-service account profile (beneficiaries only) */}
        <Route
          path="/profile"
          element={
            <RequireAuth roles={['beneficiary']}>
              <Profile />
            </RequireAuth>
          }
        />

        <Route
          path="/beneficiaries"
          element={
            <RequireAuth roles={STAFF}>
              <Beneficiaries />
            </RequireAuth>
          }
        />
        {/* Data Validation & Duplicate Detection (Batch 4) */}
        <Route
          path="/validation"
          element={
            <RequireAuth roles={STAFF}>
              <Validation />
            </RequireAuth>
          }
        />
        {/* Random Forest Vulnerability Scoring (Batch 5) */}
        <Route
          path="/scoring"
          element={
            <RequireAuth roles={STAFF}>
              <Scoring />
            </RequireAuth>
          }
        />
        {/* Distribution Monitoring (Batch 6): the single distribution page —
            operational ledger (record / release / cancel) plus the summary
            figures. The old /distribution route is kept as a redirect so
            existing links and bookmarks still land on the same page. */}
        <Route path="/distribution" element={<Navigate to="/monitoring" replace />} />
        <Route
          path="/monitoring"
          element={
            <RequireAuth roles={STAFF}>
              <Distribution />
            </RequireAuth>
          }
        />
        {/* Analytics: every chart in one place (operational + model panel) — CSWD oversight */}
        <Route
          path="/analytics"
          element={
            <RequireAuth roles={['cswd_staff']}>
              <Analytics />
            </RequireAuth>
          }
        />
        {/* Reports: prepare, preview and export (Batch 4 slice) */}
        <Route
          path="/reports"
          element={
            <RequireAuth roles={STAFF}>
              <Reports />
            </RequireAuth>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAuth roles={['cswd_staff']}>
              <Users />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
