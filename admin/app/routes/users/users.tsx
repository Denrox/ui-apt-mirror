import { useState, useEffect } from 'react';
import {
  useLoaderData,
  useActionData,
  useRevalidator,
  useSubmit,
} from 'react-router';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import TableRow from '~/components/shared/table-row/table-row';
import TableWrapper from '~/components/shared/table-wrapper/table-wrapper';
import FormButton from '~/components/shared/form/form-button';
import AddUserModal from '~/components/users/add-user-modal';
import DeleteUserModal from '~/components/users/delete-user-modal';
import ChangePasswordModal from '~/components/users/change-password-modal';
import { loader } from './loader';
import { action } from './actions';
import { toast } from 'react-toastify';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUser,
  faUserPlus,
  faTrash,
  faEdit,
} from '@fortawesome/free-solid-svg-icons';

export { loader, action };

export function meta() {
  return [
    { title: 'Settings' },
    {
      name: 'description',
      content: 'User settings and management for apt-mirror2',
    },
  ];
}

export default function Users() {
  const { users, isAdmin, error } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [userToChangePassword, setUserToChangePassword] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (actionData?.success) {
      revalidator.revalidate();
    }
  }, [actionData?.success, revalidator]);

  useEffect(() => {
    if (actionData?.message) {
      toast.success(actionData.message);
    }
  }, [actionData?.message]);

  useEffect(() => {
    if (actionData?.error) {
      toast.error(actionData.error);
    }
  }, [actionData?.error]);

  const handleAddUserSuccess = () => {
    setIsAddUserModalOpen(false);
    revalidator.revalidate();
  };

  const handleDeleteClick = (username: string) => {
    setUserToDelete(username);
  };

  const handleDeleteConfirm = async () => {
    if (!userToDelete) return;

    setIsDeleting(true);

    try {
      await submit(
        { intent: 'deleteUser', username: userToDelete },
        { action: '/users', method: 'post' },
      );
      setUserToDelete(null);
      setIsDeleting(false);
    } catch (error) {
      console.error('Error deleting user:', error);
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setUserToDelete(null);
    setIsDeleting(false);
  };

  const handleChangePasswordClick = (username: string) => {
    setUserToChangePassword(username);
  };

  const handleChangePasswordSuccess = () => {
    setUserToChangePassword(null);
    revalidator.revalidate();
  };

  return (
    <PageLayoutFull>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface md:text-[30px]">
            {isAdmin ? 'User Management' : 'Settings'}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {isAdmin
              ? 'Manage administrative accounts and access'
              : 'Manage your account'}
          </p>
        </div>
        {isAdmin && (
          <FormButton onClick={() => setIsAddUserModalOpen(true)}>
            <FontAwesomeIcon icon={faUserPlus} className="mr-2" /> Add User
          </FormButton>
        )}
      </div>

      {/* Stats */}
      <div className="grid max-w-md grid-cols-2 gap-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            Total Users
          </div>
          <div className="mt-1 font-heading text-2xl font-bold text-on-surface">
            {users.length}
          </div>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            Your Access
          </div>
          <div className="mt-1 font-heading text-2xl font-bold text-on-surface">
            {isAdmin ? 'Admin' : 'Standard'}
          </div>
        </div>
      </div>

      {/* Registry */}
      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low">
        <div className="border-b border-outline-variant px-4 py-3">
          <h2 className="font-heading text-base font-semibold text-on-surface">
            Registry
          </h2>
        </div>

        {error && (
          <div className="m-4 rounded-lg border border-error/20 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        {users.length === 0 ? (
          <div className="p-6 text-center text-on-surface-variant">
            No users found
          </div>
        ) : (
          <TableWrapper>
            {users.map((user: { username: string }) => (
              <TableRow
                key={user.username}
                icon={
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary-container text-on-secondary-container">
                    <FontAwesomeIcon icon={faUser} className="text-[13px]" />
                  </span>
                }
                title={
                  <span className="font-medium text-on-surface">
                    {user.username}
                  </span>
                }
                actions={
                  <div className="flex items-center gap-2">
                    <FormButton
                      type="secondary"
                      size="small"
                      onClick={() => handleChangePasswordClick(user.username)}
                      disabled={isDeleting}
                      ariaLabel={`Change password of ${user.username}`}
                    >
                      <FontAwesomeIcon icon={faEdit} />
                    </FormButton>
                    {isAdmin && user.username !== 'admin' && (
                      <FormButton
                        type="secondary"
                        size="small"
                        onClick={() => handleDeleteClick(user.username)}
                        disabled={isDeleting}
                        ariaLabel={`Delete user ${user.username}`}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </FormButton>
                    )}
                  </div>
                }
              />
            ))}
          </TableWrapper>
        )}
      </div>

      {isAdmin && (
        <AddUserModal
          isOpen={isAddUserModalOpen}
          onClose={() => setIsAddUserModalOpen(false)}
          onSuccess={handleAddUserSuccess}
        />
      )}

      {isAdmin && (
        <DeleteUserModal
          isOpen={!!userToDelete}
          username={userToDelete || ''}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          isDeleting={isDeleting}
        />
      )}

      <ChangePasswordModal
        isOpen={!!userToChangePassword}
        username={userToChangePassword || ''}
        onClose={() => setUserToChangePassword(null)}
        onSuccess={handleChangePasswordSuccess}
      />
    </PageLayoutFull>
  );
}
