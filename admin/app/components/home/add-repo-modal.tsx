import { useEffect, useState } from 'react';
import Modal from '~/components/shared/modal/modal';
import FormButton from '~/components/shared/form/form-button';
import FormField from '~/components/shared/form/form-field';
import FormInput from '~/components/shared/form/form-input';
import FormCheckbox from '~/components/shared/form/form-checkbox';

export interface NewRepoValues {
  title: string;
  description: string;
  baseUrl: string;
  suites: string;
  components: string;
  includeSrc: boolean;
  trusted: boolean;
  // Mirror filters (apt-mirror2). Space/comma-separated; exact name match.
  arches: string;
  includeSourceName: string;
  includeBinaryPackages: string;
  excludeBinaryPackages: string;
  includeSections: string;
}

interface AddRepoModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (values: NewRepoValues) => void;
  readonly isSubmitting: boolean;
  /** When provided, the form opens pre-filled (edit mode). */
  readonly initialValues?: NewRepoValues | null;
  /** Modal heading; defaults to "Add Repository". */
  readonly title?: string;
  /** Submit button label; defaults to "Add Repository"/"Adding...". */
  readonly submitLabel?: string;
}

const EMPTY: NewRepoValues = {
  title: '',
  description: '',
  baseUrl: '',
  suites: '',
  components: '',
  includeSrc: false,
  trusted: false,
  arches: '',
  includeSourceName: '',
  includeBinaryPackages: '',
  excludeBinaryPackages: '',
  includeSections: '',
};

/** Dark-themed multiline input for package lists. */
function Textarea({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={2}
      className="w-full resize-y rounded-lg border border-outline-variant bg-surface-container-lowest px-[12px] py-2 font-mono text-[13px] text-on-surface placeholder:text-on-surface-variant/50 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
    />
  );
}

const hasFilters = (v: NewRepoValues): boolean =>
  Boolean(
    v.arches.trim() ||
      v.includeSourceName.trim() ||
      v.includeBinaryPackages.trim() ||
      v.excludeBinaryPackages.trim() ||
      v.includeSections.trim(),
  );

export default function AddRepoModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  initialValues,
  title = 'Add Repository',
  submitLabel,
}: AddRepoModalProps) {
  const [values, setValues] = useState<NewRepoValues>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [seeds, setSeeds] = useState('');
  const [recommends, setRecommends] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolveInfo, setResolveInfo] = useState<string | null>(null);

  // Seed the form from initialValues each time the modal opens (edit mode), and
  // clear it on close. Keyed on isOpen so typing is not clobbered mid-edit.
  useEffect(() => {
    const next = isOpen ? (initialValues ?? EMPTY) : EMPTY;
    setValues(next);
    setShowFilters(hasFilters(next));
    setSeeds('');
    setRecommends(true);
    setResolveInfo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const set = <K extends keyof NewRepoValues>(
    key: K,
    value: NewRepoValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  const handleResolve = async () => {
    if (resolving) return;
    setResolving(true);
    setResolveInfo('Resolving — fetching upstream indices…');
    try {
      const fd = new FormData();
      fd.append('baseUrl', values.baseUrl);
      fd.append('suite', values.suites);
      fd.append('components', values.components);
      fd.append('arches', values.arches);
      fd.append('seeds', seeds);
      fd.append('includeRecommends', String(recommends));
      const res = await fetch('/api/resolve-deps', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResolveInfo(data.error ?? 'Resolve failed');
        return;
      }
      // The binary list becomes authoritative; clear the source-name filter so
      // apt-mirror2 doesn't AND the two together.
      setValues((prev) => ({
        ...prev,
        includeBinaryPackages: (data.packages as string[]).join(' '),
        includeSourceName: '',
      }));
      const miss = data.missingSeeds?.length
        ? ` · missing seeds: ${data.missingSeeds.join(', ')}`
        : '';
      setResolveInfo(
        `Resolved ${data.packages.length} packages${data.truncated ? ' (truncated)' : ''}${miss}`,
      );
    } catch {
      setResolveInfo('Resolve failed');
    } finally {
      setResolving(false);
    }
  };

  const isValid =
    values.title.trim() !== '' &&
    values.baseUrl.trim() !== '' &&
    values.suites.trim() !== '' &&
    values.components.trim() !== '';

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return;
    onSubmit(values);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="lg">
      <div className="flex flex-col gap-[16px]">
        <FormField label="Title" required>
          <FormInput
            value={values.title}
            onChange={(v) => set('title', v)}
            placeholder="e.g., Ubuntu Jammy"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Base URL" required>
          <FormInput
            value={values.baseUrl}
            onChange={(v) => set('baseUrl', v)}
            placeholder="http://archive.ubuntu.com/ubuntu"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Suites" required>
          <FormInput
            value={values.suites}
            onChange={(v) => set('suites', v)}
            placeholder="jammy jammy-updates jammy-security"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Components" required>
          <FormInput
            value={values.components}
            onChange={(v) => set('components', v)}
            placeholder="main restricted universe multiverse"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Description">
          <FormInput
            value={values.description}
            onChange={(v) => set('description', v)}
            placeholder="Optional note shown on the repository card"
            disabled={isSubmitting}
          />
        </FormField>

        <FormCheckbox
          id="add-repo-include-src"
          label="Also mirror source packages (deb-src)"
          checked={values.includeSrc}
          onChange={(v) => set('includeSrc', v)}
          disabled={isSubmitting}
        />

        <FormCheckbox
          id="add-repo-trusted"
          label="Mark as trusted"
          description="Adds [trusted=yes] to the client snippet. Superseded automatically once you generate a GPG signing key for this host."
          checked={values.trusted}
          onChange={(v) => set('trusted', v)}
          disabled={isSubmitting}
        />

        {/* Mirror filters (advanced) */}
        <div className="rounded-lg border border-outline-variant">
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface"
          >
            <span>Mirror filters (advanced)</span>
            <span className="text-[11px]">{showFilters ? '▲' : '▼'}</span>
          </button>

          {showFilters && (
            <div className="flex flex-col gap-[12px] border-t border-outline-variant p-3">
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                Mirror only a subset of packages. Names are matched{' '}
                <strong>exactly</strong> (space/comma separated) and{' '}
                <strong>dependencies are not pulled in automatically</strong> —
                list every package you need. Leave blank to mirror everything.
                Filters apply to every repository with the same base URL, and
                clients still see the full upstream package list.
              </p>

              <FormField label="Architectures">
                <FormInput
                  value={values.arches}
                  onChange={(v) => set('arches', v)}
                  placeholder="i386 (blank = default arch)"
                  disabled={isSubmitting}
                />
              </FormField>

              {/* Auto dependency-closure resolver */}
              <div className="flex flex-col gap-[10px] rounded-lg border border-outline-variant/60 bg-surface-container-lowest/40 p-3">
                <FormField label="Resolve dependency closure">
                  <div className="flex gap-2">
                    <FormInput
                      value={seeds}
                      onChange={setSeeds}
                      placeholder="steam (seed package name)"
                      disabled={isSubmitting || resolving}
                    />
                    <FormButton
                      type="secondary"
                      onClick={handleResolve}
                      disabled={
                        isSubmitting ||
                        resolving ||
                        !seeds.trim() ||
                        !values.baseUrl.trim() ||
                        !values.suites.trim() ||
                        !values.components.trim()
                      }
                    >
                      {resolving ? 'Resolving…' : 'Resolve →'}
                    </FormButton>
                  </div>
                </FormField>
                <FormCheckbox
                  id="resolve-recommends"
                  label="Also follow Recommends"
                  checked={recommends}
                  onChange={setRecommends}
                  disabled={isSubmitting || resolving}
                />
                {resolveInfo && (
                  <p className="text-[11px] text-on-surface-variant">
                    {resolveInfo}
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-on-surface-variant/80">
                  Fetches the upstream indices and fills “Include binary
                  packages” below with the full dependency set, so a complete{' '}
                  <span className="font-mono">apt install</span> works from the
                  mirror.
                </p>
              </div>

              <FormField label="Include source packages">
                <Textarea
                  value={values.includeSourceName}
                  onChange={(v) => set('includeSourceName', v)}
                  placeholder="steam"
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField label="Include binary packages">
                <Textarea
                  value={values.includeBinaryPackages}
                  onChange={(v) => set('includeBinaryPackages', v)}
                  placeholder="steam steam-installer libc6 libgl1 ..."
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField label="Exclude binary packages">
                <Textarea
                  value={values.excludeBinaryPackages}
                  onChange={(v) => set('excludeBinaryPackages', v)}
                  placeholder="package-to-skip ..."
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField label="Include sections">
                <FormInput
                  value={values.includeSections}
                  onChange={(v) => set('includeSections', v)}
                  placeholder="games libs"
                  disabled={isSubmitting}
                />
              </FormField>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-[12px] pt-[8px]">
          <FormButton
            type="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </FormButton>
          <FormButton
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? 'Saving...' : (submitLabel ?? 'Add Repository')}
          </FormButton>
        </div>
      </div>
    </Modal>
  );
}
