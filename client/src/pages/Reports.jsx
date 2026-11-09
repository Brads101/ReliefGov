import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Input.jsx';
import DataNotice from '../components/DataNotice.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';
import { REPORT_TYPES } from '../lib/constants.js';

/**
 * Reports (Batch 6, full module) — barangay and CSWD staff.
 *
 * Reporting only. Distribution progress is monitored on /monitoring and the
 * charts live on /analytics; this page is where reports are prepared,
 * previewed and exported.
 *
 * TWO WAYS TO READ A REPORT:
 *  1. Prepared reports — a SNAPSHOT of live counts at preparation time,
 *     filed for the CSWD Office's oversight. The snapshot is immutable and
 *     shows what the figures were when the report was prepared.
 *  2. Live preview & export — pick a type and period, preview the ROW-LEVEL
 *     table on screen, then Print (save as PDF via the browser) or Export
 *     CSV. The export re-runs the SAME server query with the SAME
 *     authorization and filters as the preview, so a file can never carry
 *     more than the screen shows. Exports are audited server-side.
 *
 * Every barangay-level report is labelled "Barangay Tambacan" and every
 * figure comes from real database rows — nothing here is hard-coded.
 */

const ROLE_LABEL = { barangay_staff: 'Barangay Staff', cswd_staff: 'CSWD Staff' };

const dateFmt = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const dateTimeFmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

const humanize = (key) =>
  String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Fetches a CSV export with the session token; throws ApiError on failure. */
async function fetchCsv(query) {
  let token = null;
  try {
    token = localStorage.getItem('reliefgov_token');
  } catch {
    token = null;
  }
  const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  let response;
  try {
    response = await fetch(`${base}/reports/export?${query}&format=csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the ReliefGov server. Make sure the API server is running.');
  }
  if (!response.ok) {
    let message = `Export failed (${response.status}).`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, message);
  }
  const filename =
    (response.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] ||
    'reliefgov-report.csv';
  return { csv: await response.text(), filename };
}

/** Renders a snapshot value: nested tallies become labelled sub-lists. */
function SnapshotValue({ value }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">None</span>;
    if (typeof value[0] === 'object') {
      return (
        <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-navy-800">
          {value.map((item, i) => (
            <li key={i}>{[item.action, item.created_at ? dateTimeFmt(item.created_at) : null].filter(Boolean).join(' · ') || JSON.stringify(item)}</li>
          ))}
        </ul>
      );
    }
    return <span className="text-[13px] text-navy-800">{value.join(', ')}</span>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-slate-400">None</span>;
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-slate-500">{humanize(k)}</dt>
            <dd className="font-medium tabular-nums text-navy-900">{String(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="text-[13px] tabular-nums text-navy-800">{String(value)}</span>;
}

export default function Reports() {
  const { user } = useAuth();
  const isCswd = user?.role === 'cswd_staff';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Prepare-report dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ report_type: '', date_from: '', date_to: '', notes: '' });
  const [dialogError, setDialogError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Report detail dialog
  const [viewing, setViewing] = useState(null);

  // Live preview & export
  const [previewForm, setPreviewForm] = useState({ report_type: '', date_from: '', date_to: '' });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const printRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api('/reports'));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDialog = () => {
    setForm({ report_type: '', date_from: '', date_to: '', notes: '' });
    setDialogError(null);
    setDialogOpen(true);
  };

  const submitReport = async () => {
    if (!form.report_type) {
      setDialogError({ message: 'Choose a report type.' });
      return;
    }
    if (form.date_from) {
      const y = new Date(form.date_from).getFullYear();
      if (y < 1900 || y > 2100) {
        setDialogError({ message: 'Please enter a valid start year (e.g. 2026).' });
        return;
      }
    }
    if (form.date_to) {
      const y = new Date(form.date_to).getFullYear();
      if (y < 1900 || y > 2100) {
        setDialogError({ message: 'Please enter a valid end year (e.g. 2026).' });
        return;
      }
    }
    if (form.date_from && form.date_to && Date.parse(form.date_from) > Date.parse(form.date_to)) {
      setDialogError({ message: 'The start date must be on or before the end date.' });
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      const body = { report_type: form.report_type };
      if (form.date_from) body.date_from = form.date_from;
      if (form.date_to) body.date_to = form.date_to;
      if (form.notes.trim()) body.notes = form.notes.trim();
      await api('/reports', { method: 'POST', body });
      setDialogOpen(false);
      setNotice({
        level: 'success',
        text: isCswd
          ? `“${form.report_type}” prepared and filed in the CSWD oversight registry.`
          : `“${form.report_type}” prepared and submitted to the CSWD Office for oversight.`
      });
      await load();
    } catch (err) {
      setDialogError(err);
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- live preview + export ---------------- */

  const previewQuery = () => {
    const params = new URLSearchParams();
    params.set('report_type', previewForm.report_type);
    if (previewForm.date_from) params.set('date_from', previewForm.date_from);
    if (previewForm.date_to) params.set('date_to', previewForm.date_to);
    return params.toString();
  };

  const runPreview = async () => {
    if (!previewForm.report_type) {
      setPreviewError({ message: 'Choose a report type to preview.' });
      return;
    }
    if (
      previewForm.date_from &&
      previewForm.date_to &&
      Date.parse(previewForm.date_from) > Date.parse(previewForm.date_to)
    ) {
      setPreviewError({ message: 'The start date must be on or before the end date.' });
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      setPreview(await api(`/reports/preview?${previewQuery()}`));
    } catch (err) {
      setPreviewError(err);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const exportCsv = async (query) => {
    setExporting(true);
    setNotice(null);
    try {
      const { csv, filename } = await fetchCsv(query);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice({
        level: 'success',
        title: 'Export ready',
        text: `“${filename}” was downloaded. Exports use the same authorization and filters as the on-screen report.`
      });
    } catch (err) {
      setNotice({
        level: 'error',
        title: 'Export failed',
        text: err.message
      });
    } finally {
      setExporting(false);
    }
  };

  /** Puts the preview into the print-only container, then prints.
   *  Browser "Save as PDF" produces the PDF — no server PDF dependency. */
  const printPreview = () => {
    setNotice(null);
    window.print();
  };

  const columns = [
    { key: 'report_type', header: 'Report', render: (r) => <span className="font-medium">{r.report_type}</span> },
    {
      key: 'period',
      header: 'Period',
      render: (r) => {
        const from = r.parameters?.date_from;
        const to = r.parameters?.date_to;
        if (!from && !to) return <span className="text-slate-400">All records to date</span>;
        return (
          <span className="whitespace-nowrap text-[13px]">
            {from ? dateFmt(from) : '…'} — {to ? dateFmt(to) : '…'}
          </span>
        );
      }
    },
    {
      key: 'row_count',
      header: 'Rows',
      align: 'right',
      render: (r) => <span className="tabular-nums">{r.row_count ?? '—'}</span>
    },
    {
      key: 'prepared_by',
      header: 'Prepared by',
      render: (r) => (
        <div className="text-[13px]">
          <p className="text-navy-900">{r.prepared_by?.full_name || '—'}</p>
          <p className="text-slate-500">{ROLE_LABEL[r.prepared_by?.role] || r.prepared_by?.role || ''}</p>
        </div>
      )
    },
    { key: 'created_at', header: 'Prepared', render: (r) => <span className="whitespace-nowrap">{dateTimeFmt(r.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setViewing(r)}>
            View
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={exporting}
            onClick={() => {
              const params = new URLSearchParams();
              params.set('report_type', r.report_type);
              if (r.parameters?.date_from) params.set('date_from', r.parameters.date_from);
              if (r.parameters?.date_to) params.set('date_to', r.parameters.date_to);
              exportCsv(params.toString());
            }}
          >
            CSV
          </Button>
        </div>
      )
    }
  ];

  const params = viewing?.parameters;

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          isCswd
            ? 'Central CSWD oversight reports and barangay-submitted snapshots from live Tambacan records.'
            : 'Barangay-level reports prepared from live Tambacan records and submitted to the CSWD Office for oversight.'
        }
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Reports' }]}
        actions={<Button onClick={openDialog}>Prepare report</Button>}
      />

      <DataNotice />

      {notice && (
        <div className="mb-4 print:hidden">
          <InlineAlert level={notice.level} title={notice.title || 'Report prepared'}>{notice.text}</InlineAlert>
        </div>
      )}

      <ErrorText error={error} loading={loading} onRetry={load} />

      {loading && !data && <LoadingState label="Loading prepared reports…" />}

      {data && (
        <Card
          title="Prepared reports"
          subtitle="Shared list — barangay prepares and submits; CSWD oversees. Figures are snapshotted at preparation time."
          actions={<span className="text-[13px] tabular-nums text-slate-500">{data.total} report{data.total === 1 ? '' : 's'}</span>}
        >
          <Table
            columns={columns}
            rows={data.reports}
            keyFn={(r) => r.id}
            emptyState={
              <EmptyState
                title="No reports prepared yet"
                description="Use “Prepare report” to snapshot live counts for Barangay Tambacan — the report is filed here and becomes visible to the CSWD Office immediately."
                minHeight="min-h-[180px]"
                action={<Button size="sm" onClick={openDialog}>Prepare the first report</Button>}
              />
            }
          />
        </Card>
      )}

      {/* Live preview & export */}
      <Card
        className="mt-5 print:hidden"
        title="Live preview & export"
        subtitle="Preview row-level figures, then print (save as PDF via your browser) or export CSV. Exports use the same authorization and filters as this preview."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Report type" htmlFor="preview-type" required>
              <Select
                id="preview-type"
                value={previewForm.report_type}
                onChange={(e) => setPreviewForm({ ...previewForm, report_type: e.target.value })}
                placeholder="Choose a report type…"
                options={REPORT_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Period from" htmlFor="preview-from">
              <Input
                id="preview-from"
                type="date"
                value={previewForm.date_from}
                onChange={(e) => setPreviewForm({ ...previewForm, date_from: e.target.value })}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Period to" htmlFor="preview-to">
              <Input
                id="preview-to"
                type="date"
                value={previewForm.date_to}
                onChange={(e) => setPreviewForm({ ...previewForm, date_to: e.target.value })}
              />
            </Field>
          </div>
          <Button onClick={runPreview} loading={previewLoading}>
            Load preview
          </Button>
        </div>

        {previewError && (
          <div className="mt-4">
            <InlineAlert level="error" title="Could not load the preview">
              {previewError.message}
            </InlineAlert>
          </div>
        )}

        {previewLoading && !preview && (
          <div className="mt-4">
            <LoadingState label="Loading report rows…" minHeight="min-h-[120px]" />
          </div>
        )}

        {preview && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-navy-900">{preview.report_type}</h3>
                <p className="text-[12.5px] text-slate-500">
                  Barangay Tambacan, Iligan City ·{' '}
                  {preview.date_from || preview.date_to
                    ? `${preview.date_from ? dateFmt(preview.date_from) : '…'} — ${preview.date_to ? dateFmt(preview.date_to) : '…'}`
                    : 'All records to date'}{' '}
                  · Generated {dateTimeFmt(preview.generatedAt)} · <span className="tabular-nums">{preview.row_count}</span> row
                  {preview.row_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={printPreview}>
                  Print / Save as PDF
                </Button>
                <Button
                  disabled={exporting}
                  onClick={() => exportCsv(previewQuery())}
                >
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </Button>
              </div>
            </div>
            {preview.row_count === 0 ? (
              <EmptyState
                title="No rows in this period"
                description="Try widening the date range or choosing a different report type."
                minHeight="min-h-[140px]"
              />
            ) : (
              <Table
                columns={preview.columns.map((col, i) => ({
                  key: `c${i}`,
                  header: col,
                  render: (row) => <span className="text-[13px]">{row[i] ?? '—'}</span>
                }))}
                rows={preview.rows}
                className="max-h-[480px] overflow-y-auto"
              />
            )}
          </div>
        )}
      </Card>

      {/* Print-only rendering of the preview (hidden on screen). */}
      {preview && (
        <div ref={printRef} className="print-only hidden print:block">
          <div className="border-b-2 border-navy-900 pb-3">
            <h1 className="text-xl font-bold text-navy-900">ReliefGov — {preview.report_type}</h1>
            <p className="text-sm text-navy-800">
              Barangay Tambacan, Iligan City, Lanao del Norte · CSWD Office, Iligan City
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Period:{' '}
              {preview.date_from || preview.date_to
                ? `${preview.date_from ? dateFmt(preview.date_from) : '…'} — ${preview.date_to ? dateFmt(preview.date_to) : '…'}`
                : 'All records to date'}{' '}
              · Generated {dateTimeFmt(preview.generatedAt)} · <span className="tabular-nums">{preview.row_count}</span> rows
            </p>
          </div>
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-navy-900 text-left">
                {preview.columns.map((col) => (
                  <th key={col} className="py-1 pr-3 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-200">
                  {row.map((cell, j) => (
                    <td key={j} className="py-1 pr-3 align-top">
                      {cell ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-[10px] text-slate-500">
            Prepared through ReliefGov — AI-Enhanced Disaster Assistance Profiling System. Figures reflect live
            database records at the generation time shown above.
          </p>
        </div>
      )}

      {/* Prepare dialog */}
      {dialogOpen && (
        <Dialog
          open
          title={isCswd ? 'Prepare a CSWD oversight report' : 'Prepare a barangay report'}
          description="Counts are computed live from Barangay Tambacan records and snapshotted with the report."
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialogOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submitReport} loading={busy}>
                {isCswd ? 'Prepare & save' : 'Prepare & submit'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {dialogError && (
              <InlineAlert level="error" title="Could not prepare the report">
                {dialogError.message}
              </InlineAlert>
            )}
            <Field label="Report type" htmlFor="report-type" required>
              <Select
                id="report-type"
                value={form.report_type}
                onChange={(e) => setForm({ ...form, report_type: e.target.value })}
                placeholder="Choose a report type…"
                options={REPORT_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Period from (optional)" htmlFor="report-from">
                <Input
                  id="report-from"
                  type="date"
                  value={form.date_from}
                  onChange={(e) => setForm({ ...form, date_from: e.target.value })}
                />
              </Field>
              <Field label="Period to (optional)" htmlFor="report-to">
                <Input
                  id="report-to"
                  type="date"
                  value={form.date_to}
                  onChange={(e) => setForm({ ...form, date_to: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Notes (optional)" htmlFor="report-notes" hint="Recorded with the report (under 500 characters).">
              <Textarea
                id="report-notes"
                rows={3}
                maxLength={500}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Year-end validation snapshot for the barangay filing."
              />
            </Field>
            <InlineAlert level="info">
              {isCswd
                ? 'On preparation, this snapshot is recorded directly in the CSWD Office oversight registry.'
                : 'On preparation, the report is submitted to the CSWD Office, Iligan City for oversight.'}
            </InlineAlert>
          </div>
        </Dialog>
      )}

      {/* Report detail dialog */}
      {viewing && (
        <Dialog
          open
          title={viewing.report_type}
          description={`Prepared ${dateTimeFmt(viewing.created_at)} · ${viewing.row_count ?? '—'} rows`}
          onClose={() => setViewing(null)}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={exporting}
                onClick={() => {
                  const p = new URLSearchParams();
                  p.set('report_type', viewing.report_type);
                  if (params?.date_from) p.set('date_from', params.date_from);
                  if (params?.date_to) p.set('date_to', params.date_to);
                  exportCsv(p.toString());
                }}
              >
                Export CSV (live data)
              </Button>
              <Button variant="secondary" onClick={() => setViewing(null)}>
                Close
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">{viewing.format}</Badge>
              <Badge tone="neutral">Barangay Tambacan</Badge>
              <Badge tone="neutral">To: {params?.submitted_to || 'CSWD Office, Iligan City'}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <div>
                <dt className="text-slate-500">Prepared by</dt>
                <dd className="font-medium text-navy-900">
                  {viewing.prepared_by?.full_name || '—'} ({ROLE_LABEL[viewing.prepared_by?.role] || ''})
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Period</dt>
                <dd className="font-medium text-navy-900">
                  {params?.date_from ? dateFmt(params.date_from) : 'All'} — {params?.date_to ? dateFmt(params.date_to) : 'today'}
                </dd>
              </div>
            </dl>
            {params?.notes && (
              <p className="rounded-md bg-surface-muted p-3 text-[13px] text-navy-800">Notes: {params.notes}</p>
            )}
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Figures at preparation</h3>
              <div className="space-y-3">
                {params?.snapshot ? (
                  Object.entries(params.snapshot).map(([key, value]) => (
                    <div key={key}>
                      <p className="mb-1 text-[13px] font-medium text-navy-800">{humanize(key)}</p>
                      <SnapshotValue value={value} />
                    </div>
                  ))
                ) : (
                  <p className="text-slate-400">No snapshot stored.</p>
                )}
              </div>
            </section>
            <p className="text-[12.5px] leading-relaxed text-slate-500">
              CSV export regenerates live rows for this report&rsquo;s type and period under your own
              permissions — the snapshot above stays as the record at preparation time.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Small helper: error banner + retry (kept local to keep imports tidy). */
function ErrorText({ error, loading, onRetry }) {
  if (!error || loading) return null;
  return (
    <div className="mb-4 print:hidden">
      <InlineAlert level="error" title="Could not load reports">
        {error.message}
        <button type="button" onClick={onRetry} className="ml-2 underline hover:no-underline">
          Try again
        </button>
      </InlineAlert>
    </div>
  );
}
