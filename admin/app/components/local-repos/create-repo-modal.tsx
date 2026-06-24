import { useEffect, useState } from 'react';
import Modal from '~/components/shared/modal/modal';
import FormButton from '~/components/shared/form/form-button';
import FormField from '~/components/shared/form/form-field';
import FormInput from '~/components/shared/form/form-input';

export interface NewLocalRepoValues {
  name: string;
  suite: string;
  components: string;
  arches: string;
  origin: string;
  label: string;
}

interface CreateRepoModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (values: NewLocalRepoValues) => void;
  readonly isSubmitting: boolean;
}

const EMPTY: NewLocalRepoValues = {
  name: '',
  suite: 'stable',
  components: 'main',
  arches: 'amd64',
  origin: '',
  label: '',
};

export default function CreateRepoModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: CreateRepoModalProps) {
  const [values, setValues] = useState<NewLocalRepoValues>(EMPTY);

  useEffect(() => {
    if (!isOpen) setValues(EMPTY);
  }, [isOpen]);

  const set = <K extends keyof NewLocalRepoValues>(
    key: K,
    value: NewLocalRepoValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  const isValid =
    values.name.trim() !== '' &&
    values.suite.trim() !== '' &&
    values.components.trim() !== '' &&
    values.arches.trim() !== '';

  const host = values.name.trim()
    ? `${values.name.trim().toLowerCase()}.local`
    : '<name>.local';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Local Repository"
      maxWidth="lg"
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Name" required>
          <FormInput
            value={values.name}
            onChange={(v) => set('name', v)}
            placeholder="e.g., team-tools"
            disabled={isSubmitting}
          />
        </FormField>
        <div className="text-[12px] text-on-surface-variant -mt-[8px]">
          Served at{' '}
          <span className="font-mono">http://mirror.intra/{host}</span>
        </div>

        <FormField label="Suite" required>
          <FormInput
            value={values.suite}
            onChange={(v) => set('suite', v)}
            placeholder="stable"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Components" required>
          <FormInput
            value={values.components}
            onChange={(v) => set('components', v)}
            placeholder="main"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Architectures" required>
          <FormInput
            value={values.arches}
            onChange={(v) => set('arches', v)}
            placeholder="amd64 arm64"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Origin / Label">
          <FormInput
            value={values.origin}
            onChange={(v) => set('origin', v)}
            placeholder="Optional — shown in repo Release metadata"
            disabled={isSubmitting}
          />
        </FormField>

        <div className="flex justify-end gap-[12px] pt-[8px]">
          <FormButton
            type="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </FormButton>
          <FormButton
            onClick={() => isValid && !isSubmitting && onSubmit(values)}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </FormButton>
        </div>
      </div>
    </Modal>
  );
}
