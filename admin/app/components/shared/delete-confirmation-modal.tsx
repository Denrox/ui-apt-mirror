import Modal from '~/components/shared/modal/modal';
import FormButton from '~/components/shared/form/form-button';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  itemName: string;
  itemType?: string;
  isLoading?: boolean;
}

export default function DeleteConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  itemName,
  itemType = 'item',
  isLoading = false,
}: DeleteConfirmationModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
    >
      <p className="text-gray-600 mb-6">
        Are you sure you want to delete {itemType} "{itemName}"? This action cannot be undone.
      </p>
      <div className="flex justify-end gap-3">
        <FormButton
          onClick={onClose}
          type="secondary"
          disabled={isLoading}
        >
          Cancel
        </FormButton>
        <FormButton
          onClick={onConfirm}
          type="danger"
          disabled={isLoading}
        >
          Delete
        </FormButton>
      </div>
    </Modal>
  );
}
