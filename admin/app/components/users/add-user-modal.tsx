import { useState } from 'react';
import { useSubmit } from 'react-router';
import Modal from '~/components/shared/modal/modal';
import FormField from '~/components/shared/form/form-field';
import FormInput from '~/components/shared/form/form-input';
import FormButton from '~/components/shared/form/form-button';

interface AddUserModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}

export default function AddUserModal({
  isOpen,
  onClose,
  onSuccess,
}: AddUserModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = useSubmit();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      return;
    }

    setIsSubmitting(true);
    
    try {
      await submit(
        { intent: 'addUser', username, password },
        { action: '/users', method: 'post' }
      );
      
      setUsername('');
      setPassword('');
      setIsSubmitting(false);
      
      if (onSuccess) {
        onSuccess();
      }
      
      onClose();
    } catch (error) {
      console.error('Error adding user:', error);
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setUsername('');
    setPassword('');
    setIsSubmitting(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add User">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Username" required>
          <FormInput
            type="text"
            name="username"
            value={username}
            onChange={setUsername}
            placeholder="Enter username"
            disabled={isSubmitting}
          />
        </FormField>

        <FormField label="Password" required>
          <FormInput
            type="password"
            name="password"
            value={password}
            onChange={setPassword}
            placeholder="Enter password"
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
            disabled={!username.trim() || !password.trim() || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </FormButton>
        </div>
      </form>
    </Modal>
  );
}
