import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Input.jsx';
import { ConfirmDialog } from '../components/ui/Dialog.jsx';
import { LoadingState, ErrorState, InlineAlert } from '../components/ui/States.jsx';
import {
  uploadDocument, formatBytes, getDocumentUrl, sniffFileMime, MAX_FILE_BYTES
} from '../lib/documents.js';
import {
  FORM_STEPS, SEX_OPTIONS, CIVIL_STATUS_OPTIONS,
  INCIDENT_TYPE_OPTIONS, incidentTypeOptions, DAMAGE_EXTENT_OPTIONS, damageExtentLabel,
  getDamageExtentOptions,
  houseStatusOptions,
  PUROK_OPTIONS, isFloodPronePurok, DOCUMENT_PURPOSES,
  IDENTITY_DOCUMENT_OPTIONS,
  DOCUMENT_CHECKLIST, DOCUMENT_PURPOSE_OPTIONS, documentPurposeLabel,
  EDITABLE_STATUSES, EMPTY_FORM, validateStep, toApiPayload, fromApiApplication
} from '../lib/constants.js';

const toSelectOptions = (values) => values.map((value) => ({ value, label: value }));

const FIELD_STEP = {
  first_name: 'personal', middle_name: 'personal', last_name: 'personal',
  sex: 'personal', date_of_birth: 'personal', civil_status: 'personal',
  is_pwd: 'personal', mobile_number: 'personal',
  purok: 'household', purok_other: 'household', household_size: 'household',
  house_status: 'household',
  incident_type: 'incident', incident_date: 'incident',
  incident_description: 'incident', damage_extent: 'incident',
  documents: 'documents'
};

const VIEW_ONLY_STATUSES = ['Pending', 'Under Verification'];

/** Human-readable names for the sniffed types — used in the "recognized as"
 *  feedback shown after a file is chosen, so the user sees immediately that
 *  the app accepted the file (before they press Upload). */
const MIME_LABELS = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' };

/**
 * Multi-section beneficiary form (Batch 3).
 * Sections: Personal → Household → Incident → Documents → Review & submit.
 * Inputs survive validation failures (all state lives in React), drafts are
 * auto-saved between sections, and submission asks for confirmation.
 */
export default function ApplicationForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [application, setApplication] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null); // { level, message }
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Document upload state
  const [activeUploadPurpose, setActiveUploadPurpose] = useState(null);
  const [uploadingPurpose, setUploadingPurpose] = useState(null);
  const [selectedIdentityPurpose, setSelectedIdentityPurpose] = useState('Barangay certificate');
  const [uploadPct, setUploadPct] = useState(null);
  const [docFeedback, setDocFeedback] = useState(null); // { level, message, purpose }
  const [busyDoc, setBusyDoc] = useState(null);

  const step = FORM_STEPS[stepIndex];
  const canEdit = !application || EDITABLE_STATUSES.includes(application.application_status);
  const identityDocs = useMemo(
    () =>
      documents.filter(
        (doc) =>
          ['Barangay certificate', 'Valid ID', 'Proof of residence'].includes(doc.purpose) &&
          doc.status !== 'Rejected'
      ),
    [documents]
  );
  const hasIdentityOrResidency = identityDocs.length > 0;
  const needsDamagePhoto = Boolean(form.damage_extent && form.damage_extent !== 'None');
  const hasDamagePhoto = useMemo(
    () => documents.some((doc) => doc.purpose === 'Damage photos' && doc.status !== 'Rejected'),
    [documents]
  );
  const needsPwdProof = Boolean(form.is_pwd === 'Yes' || form.is_pwd === true);
  const hasPwdProof = useMemo(
    () => documents.some((doc) => doc.purpose === 'Medical record' && doc.status !== 'Rejected'),
    [documents]
  );
  const canSubmit = hasIdentityOrResidency && (!needsDamagePhoto || hasDamagePhoto) && (!needsPwdProof || hasPwdProof);

  const refresh = useCallback(async () => {
    const bundle = await api('/applications/mine');
    setApplication(bundle.application);
    setDocuments(bundle.documents || []);
    return bundle;
  }, []);

  useEffect(() => {
    api('/applications/mine')
      .then((bundle) => {
        setDocuments(bundle.documents || []);
        if (bundle.application && EDITABLE_STATUSES.includes(bundle.application.application_status)) {
          setApplication(bundle.application);
          setForm(fromApiApplication(bundle.application));
        } else {
          setApplication(bundle.application);
        }
      })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  }, []);

  const set = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'purok') {
        const allowed = getDamageExtentOptions(value).map((opt) => opt.value);
        if (next.damage_extent && !allowed.includes(next.damage_extent)) {
          next.damage_extent = '';
        }
      }
      return next;
    });
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  /** Saves the draft (creates the record on first save). Returns the row. */
  const saveDraft = useCallback(
    async ({ skipEmpty = true, silent = false } = {}) => {
      const payload = toApiPayload(form, { skipEmpty });
      if (Object.keys(payload).length === 0) {
        if (!silent) setBanner({ level: 'warning', message: 'Fill in at least one field before saving.' });
        return application;
      }
      setSaving(true);
      setBanner(null);
      try {
        const isEditableExisting =
          application && EDITABLE_STATUSES.includes(application.application_status);
        const result = isEditableExisting
          ? await api('/applications/mine', { method: 'PATCH', body: payload })
          : await api('/applications/mine', { method: 'POST', body: payload });
        setApplication(result.application);
        if (!silent) {
          setBanner({ level: 'success', message: 'Draft saved. You can come back to it any time.' });
        }
        return result.application;
      } catch (err) {
        if (err.details && typeof err.details === 'object') {
          setErrors((prev) => ({ ...prev, ...err.details }));
        }
        setBanner({ level: 'error', message: err.message });
        if (!silent) {
          const first = Object.keys(err.details || {})[0];
          const target = first && FIELD_STEP[first];
          const index = FORM_STEPS.findIndex((s) => s.key === target);
          if (index >= 0) setStepIndex(index);
        }
        return null;
      } finally {
        setSaving(false);
      }
    },
    [application, form]
  );

  const validateCurrentStep = () => {
    const stepErrors = validateStep(step.key, form);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      setBanner({
        level: 'error',
        message: 'Please fix the highlighted fields. Everything you typed has been kept.'
      });
      return false;
    }
    setBanner(null);
    return true;
  };

  const goNext = async () => {
    if (!validateCurrentStep()) return;
    const nextIndex = stepIndex + 1;
    // Auto-save between sections (best effort); documents need the record id.
    const saved = await saveDraft({ silent: true });
    if (FORM_STEPS[nextIndex].key === 'documents' && !saved) {
      setBanner((prev) => (prev && prev.level === 'error' ? prev : {
        level: 'error',
        message: 'The draft must be saved before documents can be uploaded. Please try again.'
      }));
      return;
    }
    setStepIndex(nextIndex);
    window.scrollTo({ top: 0 });
  };

  const goBack = () => {
    setErrors({});
    setBanner(null);
    setStepIndex((i) => Math.max(0, i - 1));
    window.scrollTo({ top: 0 });
  };

  const jumpToStep = (index) => {
    setErrors({});
    setBanner(null);
    setStepIndex(index);
    window.scrollTo({ top: 0 });
  };

  const submitApplication = async () => {
    // Full client validation first — jump back to the section that needs work.
    const allErrors = {
      ...validateStep('personal', form),
      ...validateStep('household', form),
      ...validateStep('incident', form)
    };
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      setConfirmOpen(false);
      const firstField = Object.keys(allErrors)[0];
      const target = FIELD_STEP[firstField];
      const index = FORM_STEPS.findIndex((s) => s.key === target);
      setStepIndex(index >= 0 ? index : 0);
      setBanner({ level: 'error', message: 'Some fields still need attention before submitting.' });
      window.scrollTo({ top: 0 });
      return;
    }

    // Client-side copy of the server's document requirements: send the user to the
    // Documents section instead of letting the server bounce the submit.
    if (!hasIdentityOrResidency) {
      setConfirmOpen(false);
      const index = FORM_STEPS.findIndex((s) => s.key === 'documents');
      setStepIndex(index >= 0 ? index : 0);
      setBanner({
        level: 'error',
        message: 'Attach either your Barangay Certificate of Residency, National ID, or Barangay ID before submitting.'
      });
      window.scrollTo({ top: 0 });
      return;
    }

    if (needsDamagePhoto && !hasDamagePhoto) {
      setConfirmOpen(false);
      const index = FORM_STEPS.findIndex((s) => s.key === 'documents');
      setStepIndex(index >= 0 ? index : 0);
      setBanner({
        level: 'error',
        message: 'You reported property damage. Please attach at least one photo of the damaged house before submitting.'
      });
      window.scrollTo({ top: 0 });
      return;
    }

    if (needsPwdProof && !hasPwdProof) {
      setConfirmOpen(false);
      const index = FORM_STEPS.findIndex((s) => s.key === 'documents');
      setStepIndex(index >= 0 ? index : 0);
      setBanner({
        level: 'error',
        message: 'You indicated a PWD in your household. Please attach a PWD ID or Medical Certificate before submitting.'
      });
      window.scrollTo({ top: 0 });
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      const payload = toApiPayload(form, { skipEmpty: false });
      const isEditableExisting =
        application && EDITABLE_STATUSES.includes(application.application_status);
      if (isEditableExisting) {
        await api('/applications/mine', { method: 'PATCH', body: payload });
      } else {
        // New application (or a fresh one after a terminal decision).
        await api('/applications/mine', { method: 'POST', body: payload });
      }
      await api('/applications/mine/submit', { method: 'POST' });
      setConfirmOpen(false);
      navigate('/application');
    } catch (err) {
      if (err.details && typeof err.details === 'object') {
        setErrors((prev) => ({ ...prev, ...err.details }));
        const first = Object.keys(err.details)[0];
        const target = first && FIELD_STEP[first];
        const index = FORM_STEPS.findIndex((s) => s.key === target);
        if (index >= 0) setStepIndex(index);
      }
      setConfirmOpen(false);
      setBanner({ level: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------------------- documents ---------------------------- */

  const triggerDirectUpload = (targetPurpose) => {
    if (!application) {
      setBanner({ level: 'warning', message: 'Save your draft first so your files can be linked to your application.' });
      return;
    }
    setActiveUploadPurpose(targetPurpose);
    setDocFeedback(null);
    const input = document.getElementById('direct-file-input');
    if (input) {
      input.value = '';
      input.click();
    }
  };

  const handleDirectFileChange = async (event) => {
    const chosen = event.target.files?.[0];
    if (!chosen || !activeUploadPurpose) return;
    const targetPurpose = activeUploadPurpose;

    if (chosen.size > MAX_FILE_BYTES) {
      setDocFeedback({
        level: 'error',
        purpose: targetPurpose,
        message: `The file is ${formatBytes(chosen.size)} — the maximum is 5 MB. Try a smaller photo or PDF scan.`
      });
      event.target.value = '';
      return;
    }

    const mime = await sniffFileMime(chosen);
    if (!mime) {
      setDocFeedback({
        level: 'error',
        purpose: targetPurpose,
        message: 'Only PDF, JPEG, or PNG files are supported. If your photo is HEIC/WEBP, save or convert it as JPG first.'
      });
      event.target.value = '';
      return;
    }

    setUploadingPurpose(targetPurpose);
    setUploadPct(0);
    try {
      const uploaded = await uploadDocument({
        file: chosen,
        beneficiaryId: application.id,
        purpose: targetPurpose,
        onProgress: setUploadPct
      });
      await refresh();
      setDocFeedback({
        level: 'success',
        purpose: targetPurpose,
        message: `Attached: ${uploaded?.file_name || chosen.name} (${documentPurposeLabel(targetPurpose)}).`
      });
    } catch (err) {
      setDocFeedback({
        level: 'error',
        purpose: targetPurpose,
        message: err.message || 'Failed to upload document.'
      });
    } finally {
      setUploadingPurpose(null);
      setUploadPct(null);
      event.target.value = '';
    }
  };

  const removeDocument = async (doc) => {
    setBusyDoc(doc.id);
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setBanner({ level: 'error', message: err.message });
    } finally {
      setBusyDoc(null);
    }
  };

  const openDocument = async (doc) => {
    setBusyDoc(doc.id);
    try {
      const { url } = await getDocumentUrl(doc.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setBanner({ level: 'error', message: err.message });
    } finally {
      setBusyDoc(null);
    }
  };

  if (loading) return <LoadingState label="Loading the beneficiary form…" />;
  if (loadError) {
    return <ErrorState title="Could not open the form" description={loadError.message} onRetry={() => window.location.reload()} />;
  }
  if (application && VIEW_ONLY_STATUSES.includes(application.application_status)) {
    return <Navigate to="/application" replace />;
  }

  const nameValue = [form.first_name, form.middle_name, form.last_name].filter(Boolean).join(' ');

  return (
    <>
      <PageHeader
        title={application ? 'Edit your application' : 'Beneficiary application form'}
        description={
          application ? (
            <span className="inline-flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-100/90 px-2.5 py-0.5 text-[12.5px] font-bold text-amber-950 shadow-xs">
                <span className="font-semibold text-amber-800">Reference:</span>
                <span className="font-mono tracking-wide">{application.beneficiary_number}</span>
              </span>
            </span>
          ) : undefined
        }
        breadcrumbs={[
          { label: 'Home', to: '/dashboard' },
          { label: 'My Application', to: '/application' },
          { label: application ? 'Edit' : 'New application' }
        ]}
        actions={
          <Button variant="secondary" onClick={() => saveDraft({ skipEmpty: true })} disabled={saving}>
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
        }
      />

      {/* Section progress */}
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Form sections">
        {FORM_STEPS.map((s, index) => {
          const active = index === stepIndex;
          const done = index < stepIndex;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => index <= stepIndex && jumpToStep(index)}
                disabled={index > stepIndex}
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                  active
                    ? 'border-gov-700 bg-gov-700 text-white'
                    : done
                      ? 'border-gov-200 bg-gov-50 text-gov-800 hover:bg-gov-100'
                      : 'border-line bg-white text-slate-400 cursor-not-allowed'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    active ? 'bg-white/20' : done ? 'bg-gov-200 text-gov-900' : 'bg-slate-100'
                  }`}
                >
                  {done ? '✓' : index + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {banner && (
        <div className="mb-4">
          <InlineAlert level={banner.level} title={banner.level === 'error' ? 'Please check this' : undefined}>
            {banner.message}
          </InlineAlert>
        </div>
      )}

      <form
        noValidate
        onSubmit={(event) => event.preventDefault()}
        className="grid grid-cols-1 gap-5 lg:grid-cols-3"
      >
        <div className="lg:col-span-2">
          <Card title={step.label} subtitle={step.description}>
            {step.key === 'personal' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="First name" htmlFor="first_name" required error={errors.first_name}>
                  <Input name="first_name" value={form.first_name} onChange={set('first_name')} autoComplete="given-name" />
                </Field>
                <Field label="Middle name" htmlFor="middle_name" error={errors.middle_name}>
                  <Input name="middle_name" value={form.middle_name} onChange={set('middle_name')} autoComplete="additional-name" />
                </Field>
                <Field label="Last name" htmlFor="last_name" required error={errors.last_name}>
                  <Input name="last_name" value={form.last_name} onChange={set('last_name')} autoComplete="family-name" />
                </Field>
                <Field label="Sex" htmlFor="sex" required error={errors.sex}>
                  <Select
                    name="sex"
                    value={form.sex}
                    onChange={set('sex')}
                    placeholder="Select…"
                    options={toSelectOptions(SEX_OPTIONS)}
                  />
                </Field>
                <Field label="Date of birth" htmlFor="date_of_birth" required error={errors.date_of_birth}>
                  <Input name="date_of_birth" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
                </Field>
                <Field label="Civil status" htmlFor="civil_status" required error={errors.civil_status}>
                  <Select
                    name="civil_status"
                    value={form.civil_status}
                    onChange={set('civil_status')}
                    placeholder="Select…"
                    options={toSelectOptions(CIVIL_STATUS_OPTIONS)}
                  />
                </Field>
                <Field
                  label="Disability status (PWD)"
                  htmlFor="is_pwd"
                  required
                  error={errors.is_pwd}
                  hint={form.is_pwd === 'Yes' ? 'A PWD ID or Medical Certificate will be required in the Documents step.' : undefined}
                >
                  <Select
                    name="is_pwd"
                    value={form.is_pwd}
                    onChange={set('is_pwd')}
                    placeholder="Select…"
                    options={[
                      { value: 'No', label: 'No — No household member is PWD' },
                      { value: 'Yes', label: 'Yes — PWD in household' }
                    ]}
                  />
                </Field>
                <Field
                  label="Mobile number"
                  htmlFor="mobile_number"
                  error={errors.mobile_number}
                >
                  <Input
                    name="mobile_number"
                    type="tel"
                    inputMode="numeric"
                    value={form.mobile_number}
                    onChange={set('mobile_number')}
                    autoComplete="tel"
                  />
                </Field>
              </div>
            )}

            {step.key === 'household' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Purok / zone of residence"
                  htmlFor="purok"
                  required
                  error={errors.purok}
                >
                  <Select
                    name="purok"
                    value={form.purok}
                    onChange={set('purok')}
                    placeholder="Select your purok…"
                    options={toSelectOptions(PUROK_OPTIONS)}
                  />
                </Field>
                {form.purok === 'Other (specify)' && (
                  <Field label="Specify your purok or zone" htmlFor="purok_other" required error={errors.purok_other}>
                    <Input name="purok_other" value={form.purok_other} onChange={set('purok_other')} />
                  </Field>
                )}
                <Field label="Family size" htmlFor="household_size" required error={errors.household_size}>
                  <Input
                    name="household_size"
                    type="number"
                    min="1"
                    max="50"
                    inputMode="numeric"
                    value={form.household_size}
                    onChange={set('household_size')}
                  />
                </Field>
                <Field label="House condition / status" htmlFor="house_status" required error={errors.house_status}>
                  <Select
                    name="house_status"
                    value={form.house_status}
                    onChange={set('house_status')}
                    placeholder="Select…"
                    options={toSelectOptions(houseStatusOptions(form.house_status))}
                  />
                </Field>
              </div>
            )}

            {step.key === 'incident' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Type of disaster" htmlFor="incident_type" required error={errors.incident_type}>
                  <Select
                    name="incident_type"
                    value={form.incident_type}
                    onChange={set('incident_type')}
                    placeholder="Select…"
                    options={toSelectOptions(incidentTypeOptions(form.incident_type))}
                  />
                </Field>
                <Field label="Date of incident" htmlFor="incident_date" required error={errors.incident_date}>
                  <Input name="incident_date" type="date" value={form.incident_date} onChange={set('incident_date')} />
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    label="What happened?"
                    htmlFor="incident_description"
                    required
                    error={errors.incident_description}
                    hint="Describe the incident and how it affected your household (10–1000 characters)"
                  >
                    <Textarea
                      name="incident_description"
                      rows={5}
                      maxLength={1000}
                      value={form.incident_description}
                      onChange={set('incident_description')}
                    />
                  </Field>
                </div>
                <Field
                  label="Extent of property damage"
                  htmlFor="damage_extent"
                  required
                  error={errors.damage_extent}
                  hint={
                    isFloodPronePurok(form.purok)
                      ? 'Showing flood hazard options for coastal / riverbank zone (Puroks 1–4)'
                      : form.purok && /purok\s*0?[5-8]/i.test(form.purok)
                      ? 'Showing flood hazard options for inland zone (Puroks 5–8)'
                      : undefined
                  }
                >
                  <Select
                    name="damage_extent"
                    value={form.damage_extent}
                    onChange={set('damage_extent')}
                    placeholder="Select…"
                    options={getDamageExtentOptions(form.purok)}
                  />
                </Field>
              </div>
            )}

            {step.key === 'documents' && (
              <div className="space-y-5">
                {/* Prominent reminder that submission cannot proceed without an ID/residency document */}
                <div className="rounded-lg border border-amber-300 bg-amber-50/80 p-3.5 text-[13px] text-amber-950">
                  <div className="flex items-start gap-2.5">
                    <span className="text-base leading-none">⚠️</span>
                    <div>
                      <strong className="font-semibold">Important Submission Requirement:</strong>
                      <p className="mt-0.5 leading-relaxed">
                        You <strong>cannot submit</strong> your application without attaching at least one valid ID or residency document from the options below (<strong>Barangay Certificate of Residency</strong>, <strong>National ID</strong>, or <strong>Barangay ID</strong>). Please attach whichever option you currently have (PDF, JPEG, or PNG up to 5 MB each).
                      </p>
                    </div>
                  </div>
                </div>

                {!application && (
                  <InlineAlert level="warning">
                    Save your draft first so your files can be linked to your application.
                  </InlineAlert>
                )}

                {/* Hidden unified file picker triggered directly by "Upload document" buttons */}
                <input
                  id="direct-file-input"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.jfif,.jpe,.jfi,.pjp,.pjpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={handleDirectFileChange}
                  className="hidden"
                />

                {docFeedback && (
                  <InlineAlert level={docFeedback.level} title={docFeedback.level === 'error' ? 'Upload error' : 'Success'}>
                    {docFeedback.message}
                  </InlineAlert>
                )}

                {/* Guided attachment checklist with 1-click direct upload */}
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-navy-900">What to attach</h3>
                  <ul className="space-y-3">
                    {/* 1. Unified Proof of Identity / Residency Card with Dropdown */}
                    <li
                      className={`flex flex-col gap-3 rounded-lg border p-3.5 transition-all ${
                        hasIdentityOrResidency
                          ? 'border-teal-200 bg-teal-50/40'
                          : 'border-amber-200 bg-amber-50/50'
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-navy-900">
                            Proof of Identity / Residency
                            <Badge tone={hasIdentityOrResidency ? 'success' : 'neutral'}>
                              {hasIdentityOrResidency ? `attached (${identityDocs.length})` : 'not attached yet'}
                            </Badge>
                            <Badge tone={hasIdentityOrResidency ? 'success' : 'warning'}>
                              {hasIdentityOrResidency ? 'satisfied ✓' : 'required to submit'}
                            </Badge>
                          </p>
                          <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                            Select whichever document you have available, then click upload. Any one of the options satisfies the requirement to submit.
                          </p>

                          {/* Dropdown choice */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <label htmlFor="identity-type-select" className="text-[12px] font-semibold text-slate-700">
                              Choose document to attach:
                            </label>
                            <select
                              id="identity-type-select"
                              value={selectedIdentityPurpose}
                              onChange={(e) => setSelectedIdentityPurpose(e.target.value)}
                              className="rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-navy-900 shadow-sm focus:border-gov-600 focus:outline-none focus:ring-1 focus:ring-gov-600"
                            >
                              {IDENTITY_DOCUMENT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="shrink-0 sm:pt-1">
                          <Button
                            size="sm"
                            variant={hasIdentityOrResidency ? 'secondary' : undefined}
                            disabled={!application || uploadPct !== null || saving}
                            onClick={() => triggerDirectUpload(selectedIdentityPurpose)}
                          >
                            {uploadingPurpose === selectedIdentityPurpose && uploadPct !== null
                              ? 'Uploading…'
                              : hasIdentityOrResidency
                                ? 'Upload another'
                                : 'Upload document'}
                          </Button>
                        </div>
                      </div>

                      {/* Progress bar if uploading an identity document */}
                      {['Barangay certificate', 'Valid ID', 'Proof of residence'].includes(uploadingPurpose) && uploadPct !== null && (
                        <div className="pt-1">
                          <div
                            className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
                            role="progressbar"
                            aria-valuenow={uploadPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="h-2 rounded-full bg-gov-700 transition-all duration-150"
                              style={{ width: `${uploadPct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] font-medium text-gov-700">Uploading… {uploadPct}%</p>
                        </div>
                      )}

                      {/* Attached identity documents */}
                      {identityDocs.length > 0 && (
                        <ul className="divide-y divide-teal-100 rounded-md border border-teal-200/80 bg-white/80 px-3 py-1">
                          {identityDocs.map((doc) => (
                            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="truncate max-w-[240px] sm:max-w-md font-medium text-navy-900">
                                  📎 {doc.file_name} <span className="font-normal text-slate-500">({formatBytes(doc.size_bytes)})</span>
                                </span>
                                <Badge tone="info">{documentPurposeLabel(doc.purpose)}</Badge>
                                <Badge tone={doc.status === 'Accepted' ? 'success' : doc.status === 'Rejected' ? 'danger' : 'neutral'}>
                                  {doc.status}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2.5 text-[11px]"
                                  onClick={() => openDocument(doc)}
                                  disabled={busyDoc === doc.id}
                                >
                                  View
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  className="h-7 px-2.5 text-[11px]"
                                  onClick={() => removeDocument(doc)}
                                  disabled={busyDoc === doc.id}
                                >
                                  {busyDoc === doc.id ? 'Removing…' : 'Remove'}
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>

                    {/* 2. Other supporting document cards (Damage photo, PWD proof) */}
                    {DOCUMENT_CHECKLIST.map((item) => {
                      const attached = documents.filter(
                        (doc) => doc.purpose === item.purpose && doc.status !== 'Rejected'
                      );
                      const done = attached.length > 0;
                      const isRequired =
                        (item.category === 'damage' && needsDamagePhoto) ||
                        (item.category === 'pwd' && needsPwdProof);
                      const isPendingRequired = isRequired && !done;
                      const isUploading = uploadingPurpose === item.purpose;

                      return (
                        <li
                          key={item.purpose}
                          className={`flex flex-col gap-3 rounded-lg border p-3.5 transition-all ${
                            done
                              ? 'border-teal-200 bg-teal-50/40'
                              : isPendingRequired
                                ? 'border-amber-200 bg-amber-50/50'
                                : 'border-line bg-white'
                          }`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-navy-900">
                                {item.title}
                                <Badge tone={done ? 'success' : 'neutral'}>
                                  {done ? `attached (${attached.length})` : 'not attached yet'}
                                </Badge>
                                <Badge tone={isRequired ? 'warning' : 'info'}>
                                  {isRequired ? 'required to submit' : 'optional'}
                                </Badge>
                              </p>
                              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{item.why}</p>
                            </div>
                            <div className="shrink-0">
                              <Button
                                size="sm"
                                variant={done ? 'secondary' : undefined}
                                disabled={!application || uploadPct !== null || saving}
                                onClick={() => triggerDirectUpload(item.purpose)}
                              >
                                {isUploading ? 'Uploading…' : done ? 'Upload another' : 'Upload document'}
                              </Button>
                            </div>
                          </div>

                          {/* Progress bar */}
                          {isUploading && uploadPct !== null && (
                            <div className="pt-1">
                              <div
                                className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
                                role="progressbar"
                                aria-valuenow={uploadPct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              >
                                <div
                                  className="h-2 rounded-full bg-gov-700 transition-all duration-150"
                                  style={{ width: `${uploadPct}%` }}
                                />
                              </div>
                              <p className="mt-1 text-[11px] font-medium text-gov-700">Uploading… {uploadPct}%</p>
                            </div>
                          )}

                          {/* List of files attached under this specific item */}
                          {attached.length > 0 && (
                            <ul className="divide-y divide-teal-100 rounded-md border border-teal-200/80 bg-white/80 px-3 py-1">
                              {attached.map((doc) => (
                                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
                                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    <span className="truncate max-w-[240px] sm:max-w-md font-medium text-navy-900">
                                      📎 {doc.file_name} <span className="font-normal text-slate-500">({formatBytes(doc.size_bytes)})</span>
                                    </span>
                                    <Badge tone={doc.status === 'Accepted' ? 'success' : doc.status === 'Rejected' ? 'danger' : 'neutral'}>
                                      {doc.status}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="h-7 px-2.5 text-[11px]"
                                      onClick={() => openDocument(doc)}
                                      disabled={busyDoc === doc.id}
                                    >
                                      View
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="danger"
                                      className="h-7 px-2.5 text-[11px]"
                                      onClick={() => removeDocument(doc)}
                                      disabled={busyDoc === doc.id}
                                    >
                                      {busyDoc === doc.id ? 'Removing…' : 'Remove'}
                                    </Button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {(!hasIdentityOrResidency || (needsDamagePhoto && !hasDamagePhoto) || (needsPwdProof && !hasPwdProof)) && (
                  <div className="space-y-3">
                    {!hasIdentityOrResidency && (
                      <InlineAlert level="warning" title="Proof of identity or residency required to submit">
                        You cannot submit your application without attaching at least one valid ID or residency proof: Barangay Certificate of Residency, National ID, or Barangay ID.
                      </InlineAlert>
                    )}
                    {needsDamagePhoto && !hasDamagePhoto && (
                      <InlineAlert level="warning" title="Photo of damaged house missing">
                        You reported property damage ({damageExtentLabel(form.damage_extent)}). Please upload at least one photo of the damaged house before submitting.
                      </InlineAlert>
                    )}
                    {needsPwdProof && !hasPwdProof && (
                      <InlineAlert level="warning" title="PWD ID or Medical Certificate missing">
                        You indicated a PWD in the household. Please upload a PWD ID or Medical Certificate before submitting.
                      </InlineAlert>
                    )}
                  </div>
                )}
              </div>
            )}

            {step.key === 'review' && (
              <div className="space-y-4">
                <InlineAlert level="info">
                  Review your answers carefully. After submitting you cannot edit the application
                  unless the barangay office requests a correction.
                </InlineAlert>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                  <div><dt className="text-slate-500">Full name</dt>
                    <dd className="font-medium text-navy-900">{nameValue || '—'}</dd></div>
                  <div><dt className="text-slate-500">Sex · Civil status</dt>
                    <dd className="font-medium text-navy-900">{form.sex || '—'} · {form.civil_status || '—'}</dd></div>
                  <div><dt className="text-slate-500">Date of birth</dt>
                    <dd className="font-medium text-navy-900">{form.date_of_birth || '—'}</dd></div>
                  <div><dt className="text-slate-500">Disability status (PWD)</dt>
                    <dd className="font-medium text-navy-900">{form.is_pwd === 'Yes' ? 'Yes (PWD in household)' : 'No'}</dd></div>
                  <div><dt className="text-slate-500">Mobile number</dt>
                    <dd className="font-medium text-navy-900">{form.mobile_number || 'Not provided'}</dd></div>
                  <div><dt className="text-slate-500">Purok / zone</dt>
                    <dd className="font-medium text-navy-900">{form.purok === 'Other (specify)' ? form.purok_other : form.purok || '—'}</dd></div>
                  <div><dt className="text-slate-500">Barangay</dt>
                    <dd className="font-medium text-navy-900">Tambacan, Iligan City</dd></div>
                  <div><dt className="text-slate-500">Family size</dt>
                    <dd className="font-medium text-navy-900">{form.household_size || '—'}</dd></div>
                  <div><dt className="text-slate-500">House status</dt>
                    <dd className="font-medium text-navy-900">{form.house_status || '—'}</dd></div>
                  <div><dt className="text-slate-500">Disaster type</dt>
                    <dd className="font-medium text-navy-900">{form.incident_type || '—'}</dd></div>
                  <div><dt className="text-slate-500">Incident date</dt>
                    <dd className="font-medium text-navy-900">{form.incident_date || '—'}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-slate-500">Incident description</dt>
                    <dd className="whitespace-pre-wrap text-navy-900">{form.incident_description || '—'}</dd></div>
                  <div><dt className="text-slate-500">Property damage</dt>
                    <dd className="font-medium text-navy-900">{damageExtentLabel(form.damage_extent)}</dd></div>
                  <div><dt className="text-slate-500">Location flood hazard exposure</dt>
                    <dd className="font-medium text-navy-900">{isFloodPronePurok(form.purok === 'Other (specify)' ? form.purok_other : form.purok) ? 'Yes (High flood hazard zone — Puroks 1–4)' : 'No (Inland / low flood risk — Puroks 5–8)'}</dd></div>
                  <div><dt className="text-slate-500">Documents attached</dt>
                    <dd className="font-medium text-navy-900">
                      {documents.length} file(s)
                      {' · '}
                      {hasIdentityOrResidency ? 'Identity / Residency proof ✓' : 'Identity / Residency proof missing ✗'}
                      {needsDamagePhoto && (
                        hasDamagePhoto ? ' · Damage photo ✓' : ' · Damage photo missing ✗'
                      )}
                      {needsPwdProof && (
                        hasPwdProof ? ' · PWD proof ✓' : ' · PWD proof missing ✗'
                      )}
                    </dd></div>
                </dl>

                {!hasIdentityOrResidency && (
                  <InlineAlert level="warning" title="Proof of identity or residency required">
                    You cannot submit without uploading at least one proof of identity or residency (Barangay Certificate of Residency, National ID, or Barangay ID).{' '}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => jumpToStep(FORM_STEPS.findIndex((s) => s.key === 'documents'))}
                    >
                      Go to the Documents section
                    </button>
                    .
                  </InlineAlert>
                )}

                {needsDamagePhoto && !hasDamagePhoto && (
                  <InlineAlert level="warning" title="Photo of damaged house required">
                    You reported property damage ({damageExtentLabel(form.damage_extent)}). A photo of the damaged house is required before you can submit.{' '}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => jumpToStep(FORM_STEPS.findIndex((s) => s.key === 'documents'))}
                    >
                      Go to the Documents section
                    </button>
                    .
                  </InlineAlert>
                )}

                {needsPwdProof && !hasPwdProof && (
                  <InlineAlert level="warning" title="PWD ID or Medical Certificate required">
                    You indicated a person with disability (PWD) in the household. A PWD ID or Medical Certificate is required before you can submit.{' '}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => jumpToStep(FORM_STEPS.findIndex((s) => s.key === 'documents'))}
                    >
                      Go to the Documents section
                    </button>
                    .
                  </InlineAlert>
                )}

                <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
                  <Button onClick={() => setConfirmOpen(true)} disabled={saving || submitting || !canSubmit}>
                    Submit application for verification
                  </Button>
                  {!canSubmit && (
                    <p className="text-[12px] text-slate-500">
                      Please attach all required documents in the Documents section to unlock submission (
                      {[
                        !hasIdentityOrResidency && 'Barangay Certificate / National ID / Barangay ID',
                        needsDamagePhoto && !hasDamagePhoto && 'Photo of the Damaged House',
                        needsPwdProof && !hasPwdProof && 'PWD ID or Medical Certificate'
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      ).
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Section navigation */}
            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                {stepIndex > 0 && (
                  <Button type="button" variant="secondary" onClick={goBack}>
                    Back
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-[12px] text-slate-400">
                  Section {stepIndex + 1} of {FORM_STEPS.length}
                </span>
                {stepIndex < FORM_STEPS.length - 1 && (
                  <Button type="button" onClick={goNext} disabled={saving}>
                    {saving ? 'Saving…' : 'Next'}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Side help panel */}
        <div className="space-y-5">
          <Card title="Before you continue" subtitle="Good to know">
            <ul className="space-y-2 text-[13px] leading-relaxed text-slate-600">
              <li>· Your answers are saved as a draft — you can leave and come back.</li>
              <li>· Only your own account can see or edit this application.</li>
              <li>· Your barangay is fixed to <strong>Barangay Tambacan</strong> by the system.</li>
              <li>· Submitting starts verification; it does <strong>not</strong> mean automatic approval.</li>
              <li>· You will be notified here if the office asks for a correction.</li>
            </ul>
          </Card>

          {application && (
            <Card title="Application record" subtitle="Current state">
              <dl className="space-y-2 text-[13px]">
                <div className="flex justify-between items-center gap-3">
                  <dt className="text-slate-500">Reference</dt>
                  <dd className="font-mono font-bold text-amber-950 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 text-xs">
                    {application.beneficiary_number}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Status</dt>
                  <dd><Badge tone={application.application_status === 'Draft' ? 'neutral' : 'warning'}>
                    {application.application_status}
                  </Badge></dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Documents</dt>
                  <dd className="font-medium text-navy-900">{documents.length}</dd>
                </div>
              </dl>
              <div className="mt-3 border-t border-line pt-3">
                <Link to="/application" className="text-[13px] font-medium text-gov-700 hover:underline">
                  View status and timeline →
                </Link>
              </div>
            </Card>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit your application?"
        message={
          'This will send your application to the barangay office for verification. ' +
          'You will not be able to edit it unless the office requests a correction, and submitting ' +
          'does not guarantee approval. Do you want to continue?'
        }
        confirmLabel="Yes, submit it"
        onConfirm={submitApplication}
        onCancel={() => setConfirmOpen(false)}
        busy={submitting}
      />
    </>
  );
}
