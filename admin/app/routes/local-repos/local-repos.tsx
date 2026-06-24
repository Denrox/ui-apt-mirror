import { useEffect, useState } from 'react';
import type { Route } from './+types/local-repos';
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useRevalidator,
} from 'react-router';
import { toast } from 'react-toastify';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faTrash,
  faKey,
  faBoxesStacked,
  faSync,
  faCopy,
} from '@fortawesome/free-solid-svg-icons';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import FormButton from '~/components/shared/form/form-button';
import Dropdown from '~/components/shared/dropdown/dropdown';
import DropdownItem from '~/components/shared/dropdown/dropdown-item';
import DeleteConfirmationModal from '~/components/shared/delete-confirmation-modal';
import CreateRepoModal, {
  type NewLocalRepoValues,
} from '~/components/local-repos/create-repo-modal';
import DebUpload from '~/components/local-repos/deb-upload';
import { loader, type LocalRepoView } from './loader';
import { action } from './actions';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Local Repositories' },
    { name: 'description', content: 'Hosted local APT repositories' },
  ];
}

export { loader, action };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export default function LocalRepos() {
  const { repos } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const revalidator = useRevalidator();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (actionData?.success) {
      revalidator.revalidate();
      setShowCreate(false);
      setDeleteTarget('');
      setIsBusy(false);
      if (actionData.message) toast.success(actionData.message);
    } else if (actionData?.error) {
      setIsBusy(false);
      toast.error(actionData.error);
    }
  }, [actionData]);

  const send = (fields: Record<string, string>) => {
    if (isBusy) return;
    setIsBusy(true);
    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    submit(formData, { method: 'post' });
  };

  const handleCreate = (values: NewLocalRepoValues) =>
    send({
      intent: 'createRepo',
      name: values.name.trim(),
      suite: values.suite.trim(),
      components: values.components.trim(),
      arches: values.arches.trim(),
      origin: values.origin.trim(),
      label: values.label.trim(),
    });

  const copySnippet = (snippet: string, host: string) => {
    navigator.clipboard
      ?.writeText(snippet)
      .then(() => toast.success(`Copied sources snippet for ${host}`))
      .catch(() => toast.error('Copy failed'));
  };

  return (
    <PageLayoutFull>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold text-on-surface md:text-[30px]">
          Local Repositories
        </h1>
        <FormButton onClick={() => setShowCreate(true)} disabled={isBusy}>
          <FontAwesomeIcon icon={faPlus} className="mr-2" /> Create
        </FormButton>
      </div>

      <div className="flex flex-col gap-[16px]">
        {repos.length === 0 ? (
          <div className="w-full h-[200px] bg-surface-container-low border-2 border-dashed border-outline-variant rounded-md flex flex-col items-center justify-center">
            <div className="text-on-surface-variant/60 text-[48px] mb-2">
              <FontAwesomeIcon icon={faBoxesStacked} />
            </div>
            <div className="text-on-surface-variant text-[14px] font-medium">
              No local repositories yet
            </div>
            <div className="text-on-surface-variant/60 text-[12px] mt-1">
              Use Create to host your own .deb packages
            </div>
          </div>
        ) : (
          repos.map((repo: LocalRepoView) => (
            <div
              key={repo.host}
              className="bg-surface-container-low border border-outline-variant shadow-md rounded-md p-[16px] flex flex-col gap-[12px]"
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-[12px]">
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold text-on-surface truncate">
                    {repo.host}
                  </div>
                  <div className="text-[12px] text-on-surface-variant">
                    suite <span className="font-mono">{repo.suite}</span> ·
                    components{' '}
                    <span className="font-mono">
                      {repo.components.join(', ')}
                    </span>{' '}
                    · arch{' '}
                    <span className="font-mono">{repo.arches.join(', ')}</span>{' '}
                    · {repo.packages.length} package
                    {repo.packages.length === 1 ? '' : 's'} ·{' '}
                    {repo.gpgKey ? (
                      <span className="text-success">
                        signed ({repo.gpgKey.keyId})
                      </span>
                    ) : (
                      <span className="text-tertiary">unsigned</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-[12px] flex-shrink-0">
                  {repo.components.map((component) => (
                    <DebUpload
                      key={component}
                      host={repo.host}
                      component={component}
                      disabled={isBusy}
                      onUploaded={() => revalidator.revalidate()}
                    />
                  ))}
                  <FormButton
                    type="secondary"
                    size="small"
                    onClick={() =>
                      send({ intent: 'publishRepo', host: repo.host })
                    }
                    disabled={isBusy}
                  >
                    <FontAwesomeIcon icon={faSync} /> Republish
                  </FormButton>
                  <Dropdown
                    trigger={
                      <span
                        className="text-on-surface-variant hover:text-on-surface cursor-pointer"
                        title="GPG signing options"
                      >
                        <FontAwesomeIcon icon={faKey} />
                      </span>
                    }
                    disabled={isBusy}
                  >
                    {repo.gpgKey ? (
                      <>
                        <DropdownItem
                          onClick={() =>
                            window.open(`/api/pubkey/${repo.host}`, '_blank')
                          }
                        >
                          Download public key
                        </DropdownItem>
                        <DropdownItem
                          onClick={() =>
                            send({ intent: 'signRelease', host: repo.host })
                          }
                        >
                          Re-sign Release
                        </DropdownItem>
                        <DropdownItem
                          onClick={() =>
                            send({ intent: 'deleteGpgKey', host: repo.host })
                          }
                        >
                          Delete signing key
                        </DropdownItem>
                      </>
                    ) : (
                      <DropdownItem
                        onClick={() =>
                          send({ intent: 'generateGpgKey', host: repo.host })
                        }
                      >
                        Generate signing key
                      </DropdownItem>
                    )}
                  </Dropdown>
                  <button
                    onClick={() => setDeleteTarget(repo.host)}
                    className="text-on-surface-variant hover:text-on-surface cursor-pointer disabled:opacity-50"
                    title="Delete repository"
                    disabled={isBusy}
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>

              {/* Packages */}
              {repo.packages.length > 0 && (
                <div className="flex flex-col gap-[4px]">
                  {repo.packages.map((pkg) => (
                    <div
                      key={`${pkg.component}/${pkg.filename}`}
                      className="flex items-center justify-between bg-surface-container-lowest border border-outline-variant rounded px-[10px] py-[6px] text-[12px]"
                    >
                      <span className="font-mono truncate text-on-surface">
                        {pkg.component}/{pkg.filename}
                      </span>
                      <div className="flex items-center gap-[12px] flex-shrink-0">
                        <span className="text-on-surface-variant/60">
                          {formatBytes(pkg.size)}
                        </span>
                        <button
                          onClick={() =>
                            send({
                              intent: 'deletePackage',
                              host: repo.host,
                              component: pkg.component,
                              filename: pkg.filename,
                            })
                          }
                          className="text-on-surface-variant/60 hover:text-error cursor-pointer disabled:opacity-50"
                          title="Remove package"
                          disabled={isBusy}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Client sources snippet */}
              <div className="bg-surface-container-lowest border border-outline-variant rounded p-[10px]">
                <div className="flex items-center justify-between mb-[6px]">
                  <span className="text-[12px] font-semibold text-on-surface-variant">
                    /etc/apt/sources.list.d/{repo.host.replace(/\./g, '-')}
                    .sources
                  </span>
                  <button
                    onClick={() => copySnippet(repo.snippet, repo.host)}
                    className="text-on-surface-variant/60 hover:text-on-surface-variant cursor-pointer text-[12px]"
                    title="Copy snippet"
                  >
                    <FontAwesomeIcon icon={faCopy} /> Copy
                  </button>
                </div>
                <pre className="text-[11px] text-on-surface-variant whitespace-pre-wrap break-all font-mono">
                  {repo.snippet}
                </pre>
              </div>
            </div>
          ))
        )}
      </div>

      <CreateRepoModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        isSubmitting={isBusy}
      />

      <DeleteConfirmationModal
        isOpen={deleteTarget !== ''}
        onClose={() => setDeleteTarget('')}
        onConfirm={() => send({ intent: 'deleteRepo', host: deleteTarget })}
        title="Delete Local Repository"
        itemName={deleteTarget}
        itemType="local repository (and its packages + key)"
        isLoading={isBusy}
      />
    </PageLayoutFull>
  );
}
