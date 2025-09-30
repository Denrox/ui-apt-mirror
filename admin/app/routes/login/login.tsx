import { useState, useEffect } from 'react';
import { useActionData } from 'react-router';
import FormButton from '~/components/shared/form/form-button';
import FormInput from '~/components/shared/form/form-input';
import FormField from '~/components/shared/form/form-field';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import ContentBlock from '~/components/shared/content-block/content-block';
import { toast } from 'react-toastify';
import { loader } from './loader';
import { action } from './actions';

export function meta() {
  return [{ title: 'Login' }, { name: 'description', content: 'Admin Login' }];
}

export { loader, action };

export default function Login() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const actionData = useActionData<typeof action>();

  useEffect(() => {
    if (actionData?.error) {
      toast.error(actionData.error);
    } else if (actionData?.success) {
      toast.success(actionData.message);
    }
  }, [actionData]);

  return (
    <PageLayoutFull>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">
              UI APT Mirror Admin Login
            </h2>
          </div>

          <ContentBlock>
            <form className="space-y-6" action="/login" method="post">
              <FormField label="Username" required>
                <FormInput
                  type="text"
                  name="username"
                  placeholder="Enter username"
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField label="Password" required>
                <FormInput
                  type="password"
                  name="password"
                  placeholder="Enter password"
                  disabled={isSubmitting}
                />
              </FormField>

              <div className="flex justify-center">
                <FormButton
                  type="primary"
                  buttonType="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Signing in...' : 'Sign In'}
                </FormButton>
              </div>
            </form>
          </ContentBlock>
        </div>
      </div>
    </PageLayoutFull>
  );
}
