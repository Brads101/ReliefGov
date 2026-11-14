import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, BASE } from '../lib/api.js';
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
  let response;
  try {
    response = await fetch(`${BASE}/reports/export?${query}&format=csv`, {
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

function getStatusTone(label) {
  const l = String(label).toLowerCase();
  if (l.includes('approved') || l.includes('verified') || l.includes('high') || l.includes('completed')) return 'emerald';
  if (l.includes('pending') || l.includes('under') || l.includes('medium') || l.includes('in progress')) return 'amber';
  if (l.includes('correction') || l.includes('draft')) return 'sky';
  if (l.includes('rejected') || l.includes('duplicate') || l.includes('flagged') || l.includes('low')) return 'rose';
  return 'slate';
}

/** Renders a snapshot value: nested tallies become labelled sub-lists. */
function SnapshotValue({ value }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">None</span>;
    if (typeof value[0] === 'object') {
      return (
        <ul className="divide-y divide-slate-100 text-[12.5px]">
          {value.map((item, i) => (
            <li key={i} className="flex items-center justify-between py-1.5 text-slate-800">
              <span className="font-medium">{item.action || JSON.stringify(item)}</span>
              {item.created_at && (
                <span className="font-mono text-[11px] text-slate-400">{dateTimeFmt(item.created_at)}</span>
              )}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {value.map((v, i) => (
          <span key={i} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
            {v}
          </span>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-slate-400">None</span>;
    return (
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        {entries.map(([k, v]) => {
          const tone = getStatusTone(k);
          const badgeClass =
            tone === 'emerald'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : tone === 'amber'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : tone === 'sky'
              ? 'bg-sky-50 text-sky-800 border-sky-200'
              : tone === 'rose'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-white text-slate-800 border-slate-200/90 shadow-2xs';

          return (
            <div
              key={k}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-slate-50/50 px-2.5 py-1.5 transition-colors hover:bg-white"
            >
              <dt className="truncate font-medium text-slate-700">{humanize(k)}</dt>
              <dd
                className={`shrink-0 rounded-md border px-2 py-0.5 text-[11.5px] font-bold tabular-nums ${badgeClass}`}
              >
                {String(v)}
              </dd>
            </div>
          );
        })}
      </div>
    );
  }
  return <span className="text-[13px] font-bold tabular-nums text-navy-950">{String(value)}</span>;
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
                variant="primary"
                disabled={exporting}
                onClick={() => {
                  const p = new URLSearchParams();
                  p.set('report_type', viewing.report_type);
                  if (params?.date_from) p.set('date_from', params.date_from);
                  if (params?.date_to) p.set('date_to', params.date_to);
                  exportCsv(p.toString());
                }}
              >
                <svg viewBox="0 0 20 20" className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 14v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2M10 3v10m0 0l-3-3m3 3l3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                {viewing.format}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                Barangay Tambacan
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                To: {params?.submitted_to || 'CSWD Office, Iligan City'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 to-sky-50/30 p-3.5 text-[13px]">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Prepared by</dt>
                <dd className="mt-0.5 font-bold text-navy-900">
                  {viewing.prepared_by?.full_name || '—'}
                </dd>
                <p className="text-[11.5px] text-slate-500">
                  {ROLE_LABEL[viewing.prepared_by?.role] || ''}
                </p>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reporting Period</dt>
                <dd className="mt-0.5 font-bold text-navy-900">
                  {params?.date_from ? dateFmt(params.date_from) : 'All'} — {params?.date_to ? dateFmt(params.date_to) : 'today'}
                </dd>
                <p className="text-[11.5px] text-slate-500">
                  Snapshot locked at preparation
                </p>
              </div>
            </div>

            {params?.notes && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[12.5px] text-amber-900 shadow-2xs">
                <span className="font-semibold text-amber-950">Notes:</span> {params.notes}
              </div>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-1 rounded-full bg-sky-500" aria-hidden="true" />
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-700">
                    Figures at Preparation
                  </h3>
                </div>
                <span className="rounded-full border border-sky-200/80 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                  Locked Snapshot
                </span>
              </div>

              <div className="space-y-3">
                {params?.snapshot ? (
                  Object.entries(params.snapshot).map(([key, value]) => {
                    const isTotal = key.toLowerCase() === 'total' || typeof value !== 'object';
                    if (isTotal) {
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between rounded-xl border border-sky-200/80 bg-gradient-to-r from-sky-50/80 via-white to-sky-50/40 p-3.5 shadow-2xs"
                        >
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-sky-900">
                              {humanize(key)} Records Snapshotted
                            </p>
                            <p className="text-[11.5px] text-slate-500">
                              Direct counts computed at the moment of report generation
                            </p>
                          </div>
                          <span className="text-2xl font-black tabular-nums tracking-tight text-navy-950">
                            {String(value)}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={key}
                        className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs"
                      >
                        <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-1.5">
                          <p className="text-[12px] font-bold tracking-tight text-navy-900">
                            {humanize(key)}
                          </p>
                          {typeof value === 'object' && value && (
                            <span className="text-[11px] font-medium text-slate-400">
                              {Object.keys(value).length} items
                            </span>
                          )}
                        </div>
                        <SnapshotValue value={value} />
                      </div>
                    );
                  })
                ) : (
                  <p className="py-4 text-center text-sm text-slate-400">No snapshot stored.</p>
                )}
              </div>
            </section>
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
