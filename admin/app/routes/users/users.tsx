import { useState, useEffect } from 'react';
import {
  useLoaderData,
  useActionData,
  useRevalidator,
  useSubmit,
} from 'react-router';
import Title from '~/components/shared/title/title';
import ContentBlock from '~/components/shared/content-block/content-block';
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
  const { users, currentUser, isAdmin, error } = useLoaderData<typeof loader>();
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
      <div className="flex items-center justify-between mb-4 px-[12px]">
        <div className="flex items-center gap-4">
          <Title title={isAdmin ? 'Users' : 'Settings'} />
          {isAdmin && (
            <div className="hidden md:block">
              <FormButton
                type="secondary"
                onClick={() => setIsAddUserModalOpen(true)}
              >
                <FontAwesomeIcon icon={faUserPlus} /> Add User
              </FormButton>
            </div>
          )}
        </div>
      </div>

      <ContentBlock>
        <div className="flex flex-col gap-4">
          {error && (
            <div className="p-4 bg-red-100 text-red-700 rounded-md">
              {error}
            </div>
          )}

          <div className="border border-gray-200 rounded-md">
            {users.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No users found
              </div>
            ) : (
              <TableWrapper>
                {users.map((user) => (
                  <TableRow
                    key={user.username}
                    icon={
                      <FontAwesomeIcon
                        icon={faUser}
                        className="text-gray-600"
                      />
                    }
                    title={
                      <div className="flex align-center font-medium">
                        {user.username}
                      </div>
                    }
                    actions={
                      <div className="flex items-center gap-2">
                        <FormButton
                          type="secondary"
                          size="small"
                          onClick={() =>
                            handleChangePasswordClick(user.username)
                          }
                          disabled={isDeleting}
                        >
                          <FontAwesomeIcon icon={faEdit} />
                        </FormButton>
                        {isAdmin && user.username !== 'admin' && (
                          <FormButton
                            type="secondary"
                            size="small"
                            onClick={() => handleDeleteClick(user.username)}
                            disabled={isDeleting}
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
        </div>
      </ContentBlock>

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
