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
};

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

  // Seed the form from initialValues each time the modal opens (edit mode), and
  // clear it on close. Keyed on isOpen so typing is not clobbered mid-edit.
  useEffect(() => {
    setValues(isOpen ? (initialValues ?? EMPTY) : EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const set = <K extends keyof NewRepoValues>(
    key: K,
    value: NewRepoValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

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
