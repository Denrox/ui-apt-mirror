import { useState } from 'react';
import { useSubmit } from 'react-router';
import FormButton from '~/components/shared/form/form-button';
import FormInput from '~/components/shared/form/form-input';
import Modal from '~/components/shared/modal/modal';

interface CreateFolderModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly currentPath: string;
}

export default function CreateFolderModal({
  isOpen,
  onClose,
  currentPath,
}: CreateFolderModalProps) {
  const [folderName, setFolderName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = useSubmit();

  const handleSubmit = async () => {
    if (!folderName.trim()) return;
    setIsSubmitting(true);
    try {
      await submit(
        {
          intent: 'createFolder',
          folderName: folderName.trim(),
          currentPath: currentPath,
        },
        { action: '', method: 'post' },
      );
      setFolderName('');
      onClose();
    } catch (error) {
      console.error('Failed to create folder:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setFolderName('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Create Folder">
      <div className="space-y-4">
        <div>
          <label
            htmlFor="folder-name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Folder Name
          </label>
          <FormInput
            id="folder-name"
            value={folderName}
            onChange={setFolderName}
            placeholder="e.g., documents"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <FormButton type="secondary" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </FormButton>
          <FormButton onClick={handleSubmit} disabled={!folderName.trim() || isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create'}
          </FormButton>
        </div>
      </div>
    </Modal>
  );
}


