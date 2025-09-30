import { useState } from 'react';
import { useSubmit } from 'react-router';
import Modal from '~/components/shared/modal/modal';
import FormField from '~/components/shared/form/form-field';
import FormInput from '~/components/shared/form/form-input';
import FormButton from '~/components/shared/form/form-button';

interface ChangePasswordModalProps {
  readonly isOpen: boolean;
  readonly username: string;
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}

export default function ChangePasswordModal({
  isOpen,
  username,
  onClose,
  onSuccess,
}: ChangePasswordModalProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = useSubmit();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword.trim() || !confirmPassword.trim()) {
      setError('Both password fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 4) {
      setError('Password must be at least 4 characters long');
      return;
    }

    setIsSubmitting(true);

    try {
      await submit(
        { intent: 'changePassword', username, newPassword },
        { action: '/users', method: 'post' }
      );

      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setIsSubmitting(false);

      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (error) {
      console.error('Error changing password:', error);
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setIsSubmitting(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Change Password for ${username}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        <FormField label="New Password" required>
          <FormInput
            type="password"
            name="newPassword"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="Enter new password"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Confirm Password" required>
          <FormInput
            type="password"
            name="confirmPassword"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm new password"
            disabled={isSubmitting}
          />
        </FormField>

        <div className="flex justify-end gap-2 mt-6">
          <FormButton
            type="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </FormButton>
          <FormButton
            type="primary"
            buttonType="submit"
            disabled={!newPassword.trim() || !confirmPassword.trim() || isSubmitting}
          >
            {isSubmitting ? 'Changing...' : 'Change Password'}
          </FormButton>
        </div>
      </form>
    </Modal>
  );
}

