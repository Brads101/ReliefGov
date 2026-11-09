import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import { ConfirmDialog } from '../components/ui/Dialog.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';
import { STATUS_META, EDITABLE_STATUSES, incomeLevelLabel, damageExtentLabel, vulnerabilityClassMeta, vulnerabilityClassLabel, displayPriorityScore, isFloodPronePurok, documentPurposeLabel } from '../lib/constants.js';
import { formatBytes, getDocumentUrl } from '../lib/documents.js';

const ROLE_LABEL = {
  beneficiary: 'You',
  barangay_staff: 'Barangay Staff',
  cswd_staff: 'CSWD Staff',
  system: 'System'
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

/**
 * "My Application" — status, verification timeline, supporting documents,
 * and the applicant's own vulnerability assessment result (shown only for
 * their own record, and only once the workflow has produced one).
 */
export default function Application() {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);
  const [downloading, setDownloading] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api('/applications/mine')
      .then(setBundle)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const application = bundle?.application;
  const meta = application ? STATUS_META[application.application_status] : null;
  const canEdit = application && EDITABLE_STATUSES.includes(application.application_status);

  const submit = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      await api('/applications/mine/submit', { method: 'POST' });
      setConfirmOpen(false);
      setActionNotice('Your application has been submitted for verification.');
      load();
    } catch (err) {
      setActionError(err);
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const download = async (doc) => {
    setDownloading(doc.id);
    setActionError(null);
    try {
      const { url } = await getDocumentUrl(doc.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setActionError(err);
    } finally {
      setDownloading(null);
    }
  };

  if (loading) return <LoadingState label="Loading your application…" />;
  if (error) {
    return <ErrorState title="Could not load your application" description={error.message} onRetry={load} />;
  }

  if (!application) {
    return (
      <>
        <PageHeader
          title="My Application"
          description="Your disaster assistance application for Barangay Tambacan."
          breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'My Application' }]}
        />
        <Card>
          <EmptyState
            title="You have not started an application yet"
            description="Fill in the beneficiary form, attach your Barangay Certificate of Residency, and submit it for verification by the barangay office."
            minHeight="min-h-[200px]"
            action={
              <Link to="/application/new">
                <Button>Start your application</Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My Application"
        description={`Reference ${application.beneficiary_number} · Barangay Tambacan, Iligan City`}
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'My Application' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Link to="/application/edit">
                <Button variant="secondary">
                  {application.application_status === 'Draft' ? 'Continue filling out' : 'Make corrections'}
                </Button>
              </Link>
            )}
            {canEdit && (
              <Button onClick={() => setConfirmOpen(true)}>Submit for verification</Button>
            )}
          </div>
        }
      />

      {actionNotice && (
        <div className="mb-4">
          <InlineAlert level="success">{actionNotice}</InlineAlert>
        </div>
      )}
      {actionError && (
        <div className="mb-4">
          <InlineAlert level="error" title="Action could not be completed">
            {actionError.message}
            {actionError.details?.documents && (
              <span> {actionError.details.documents}</span>
            )}
          </InlineAlert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Current status */}
          <Card title="Current status" subtitle="Updated automatically by the verification workflow">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Badge tone={meta?.tone || 'neutral'} className="px-3 py-1 text-[13px]">
                {meta?.label || application.application_status}
              </Badge>
              <p className="text-[13px] text-slate-500">
                Last updated {formatDate(application.updated_at)}
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-navy-800">{meta?.hint}</p>

            {application.status_reason && (
              <div className="mt-3">
                <InlineAlert
                  level={application.application_status === 'Rejected' ? 'error' : 'warning'}
                  title={
                    application.application_status === 'Rejected'
                      ? 'Reason for rejection'
                      : 'What you need to do'
                  }
                >
                  {application.status_reason}
                </InlineAlert>
              </div>
            )}

            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Submitted on</dt>
                <dd className="font-medium text-navy-900">{formatDate(application.submitted_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Record created</dt>
                <dd className="font-medium text-navy-900">{formatDate(application.created_at)}</dd>
              </div>
            </dl>
          </Card>

          {/* Status timeline */}
          <Card title="Status timeline" subtitle="Every change, who made it, and why">
            {bundle.history.length === 0 ? (
              <EmptyState
                title="No status changes yet"
                description="Your timeline will start once you submit your application for verification."
                minHeight="min-h-[140px]"
              />
            ) : (
              <ol className="relative ml-2 border-l-2 border-line">
                {bundle.history.map((entry, index) => {
                  const entryMeta = STATUS_META[entry.to_status];
                  const isLast = index === bundle.history.length - 1;
                  return (
                    <li key={entry.id} className={`relative pb-5 pl-5 ${isLast ? 'pb-0' : ''}`}>
                      <span
                        aria-hidden="true"
                        className="absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-white bg-gov-700"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {entry.from_status && (
                          <span className="text-[12px] text-slate-500">{entry.from_status} →</span>
                        )}
                        <Badge tone={entryMeta?.tone || 'neutral'}>{entryMeta?.label || entry.to_status}</Badge>
                        <span className="text-[12px] text-slate-400">
                          {formatDate(entry.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-navy-800">
                        Changed by {ROLE_LABEL[entry.actor_role] || entry.actor_role || 'System'}
                      </p>
                      {entry.reason && (
                        <p className="mt-1 text-[13px] italic text-slate-600">“{entry.reason}”</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          {/* Submitted information (read-only) */}
          <Card title="Submitted information" subtitle="Read-only copy of your application">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div><dt className="text-slate-500">Full name</dt>
                <dd className="font-medium text-navy-900">
                  {[application.first_name, application.middle_name, application.last_name].filter(Boolean).join(' ')}
                </dd>
              </div>
              <div><dt className="text-slate-500">Sex · Civil status</dt>
                <dd className="font-medium text-navy-900">{application.sex || '—'} · {application.civil_status || '—'}</dd>
              </div>
              <div><dt className="text-slate-500">Disability status (PWD)</dt>
                <dd className="font-medium text-navy-900">{application.is_pwd ? 'Yes' : 'No'}</dd>
              </div>
              <div><dt className="text-slate-500">Purok / zone</dt>
                <dd className="font-medium text-navy-900">{application.purok || '—'}</dd>
              </div>
              <div><dt className="text-slate-500">Barangay</dt>
                <dd className="font-medium text-navy-900">{application.barangay}, {application.city_municipality}</dd>
              </div>
              <div><dt className="text-slate-500">Family size</dt>
                <dd className="font-medium text-navy-900">{application.household_size ?? '—'} member(s)</dd>
              </div>
              <div><dt className="text-slate-500">House status</dt>
                <dd className="font-medium text-navy-900">{application.house_status || '—'}</dd>
              </div>
              <div><dt className="text-slate-500">Disaster · Date</dt>
                <dd className="font-medium text-navy-900">
                  {application.incident_type || '—'} · {application.incident_date || '—'}
                </dd>
              </div>
              <div className="sm:col-span-2"><dt className="text-slate-500">Incident description</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-navy-900">{application.incident_description || '—'}</dd>
              </div>
              <div><dt className="text-slate-500">Property damage</dt>
                <dd className="font-medium text-navy-900">{damageExtentLabel(application.damage_extent)}</dd>
              </div>
              <div><dt className="text-slate-500">Location flood hazard exposure</dt>
                <dd className="font-medium text-navy-900">{isFloodPronePurok(application.purok) ? 'Yes (Puroks 1–4: High hazard zone)' : 'No (Puroks 5–8: Low risk)'}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <div className="space-y-5">
          {/* Vulnerability result */}
          <Card title="Vulnerability assessment" subtitle="Shown only on your own record">
            {application.vulnerability_class ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Classification</span>
                  <Badge
                    tone={vulnerabilityClassMeta(application.vulnerability_class)?.tone || 'neutral'}
                    className="px-2.5 py-1 text-[13px]"
                  >
                    {vulnerabilityClassLabel(application.vulnerability_class)}
                  </Badge>
                </div>
                {application.vulnerability_score !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Score</span>
                    <span className="text-sm font-semibold tabular-nums text-navy-900">
                      {displayPriorityScore(application.vulnerability_score, application.vulnerability_class)?.toFixed(2)}
                    </span>
                  </div>
                )}
                <p className="pt-1 text-[12px] text-slate-500">
                  Computed by the Random Forest vulnerability model from your validated profile.
                </p>
              </div>
            ) : (
              <EmptyState
                title="Not yet assessed"
                description="Your vulnerability assessment will appear here after the office validates your profile and the scoring model runs."
                minHeight="min-h-[130px]"
              />
            )}
          </Card>

          {/* Documents */}
          <Card
            title="Supporting documents"
            subtitle={`${bundle.documents.length} file(s) attached`}
            actions={
              canEdit ? (
                <Link to="/application/edit">
                  <Button size="sm" variant="secondary">Add files</Button>
                </Link>
              ) : null
            }
          >
            {bundle.documents.length === 0 ? (
              <p className="text-[13px] text-slate-500">
                No documents attached yet. A Barangay Certificate of Residency is required before submission.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {bundle.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-navy-900">{doc.file_name}</p>
                      <p className="text-[12px] text-slate-500">
                        {documentPurposeLabel(doc.purpose)} · {formatBytes(doc.size_bytes)} ·{' '}
                        <Badge tone={doc.status === 'Accepted' ? 'success' : doc.status === 'Rejected' ? 'danger' : 'neutral'}>
                          {doc.status}
                        </Badge>
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => download(doc)}
                      disabled={downloading === doc.id}
                    >
                      {downloading === doc.id ? 'Opening…' : 'View'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="pt-3 text-[12px] text-slate-400">
              Files are stored privately and open only for your account or authorized staff.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit your application?"
        message={
          'Your application will be sent to the barangay office for verification. ' +
          'You cannot edit it while it is under verification unless the office asks for a correction. ' +
          'Submitting does not guarantee approval.'
        }
        confirmLabel="Yes, submit my application"
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
        busy={submitting}
      />
    </>
  );
}
