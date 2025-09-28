import { useState } from 'react';
import { useSubmit } from 'react-router';
import FormInput from '~/components/shared/form/form-input';
import FormButton from '~/components/shared/form/form-button';
import { toast } from 'react-toastify';

interface RenameFormItem {
  readonly path: string;
  readonly name: string;
}

interface RenameFormProps {
  readonly item: RenameFormItem;
  readonly onSuccess: () => void;
  readonly onCancel: () => void;
}

export default function RenameForm({
  item,
  onSuccess,
  onCancel,
}: RenameFormProps) {
  const [newName, setNewName] = useState(item.name);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = useSubmit();

  const handleSubmit = async () => {
    if (!newName.trim() || newName.trim() === item.name) return;

    setIsSubmitting(true);

    try {
      await submit(
        { intent: 'renameFile', filePath: item.path, newName: newName.trim() },
        { action: '', method: 'post' },
      );
      onSuccess();
    } catch (error) {
      toast.error('Failed to rename item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="new-name"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          New Name
        </label>
        <FormInput
          id="new-name"
          value={newName}
          onChange={setNewName}
          placeholder="Enter new name"
          disabled={isSubmitting}
        />
      </div>
      <div className="flex justify-end gap-2">
        <FormButton
          type="secondary"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          Cancel
        </FormButton>
        <FormButton
          onClick={handleSubmit}
          disabled={
            !newName.trim() || newName.trim() === item.name || isSubmitting
          }
        >
          Save
        </FormButton>
      </div>
    </div>
  );
}
