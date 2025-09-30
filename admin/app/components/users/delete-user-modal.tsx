import Modal from '~/components/shared/modal/modal';
import FormButton from '~/components/shared/form/form-button';

interface DeleteUserModalProps {
  readonly isOpen: boolean;
  readonly username: string;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly isDeleting: boolean;
}

export default function DeleteUserModal({
  isOpen,
  username,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteUserModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete User">
      <div className="space-y-4">
        <p className="text-gray-700">
          Are you sure you want to delete user <strong>{username}</strong>?
        </p>
        <p className="text-gray-600 text-sm">This action cannot be undone.</p>

        <div className="flex justify-end gap-2 mt-6">
          <FormButton type="secondary" onClick={onClose} disabled={isDeleting}>
            Cancel
          </FormButton>
          <FormButton type="primary" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </FormButton>
        </div>
      </div>
    </Modal>
  );
}
