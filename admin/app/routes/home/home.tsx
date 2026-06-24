import classNames from 'classnames';
import type { Route } from './+types/home';
import appConfig from '~/config/config.json';
import { useRuntimeConfig } from '~/utils/use-runtime-config';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import { useEffect, useState } from 'react';
import { getHostAddress } from '~/utils/url';
import ResourceMonitor from '~/components/shared/resource-monitor/resource-monitor';
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useRevalidator,
} from 'react-router';
import { loader, type RepositoryConfig, type CommentedSection } from './loader';
import { action } from './actions';
import DeleteConfirmationModal from '~/components/shared/delete-confirmation-modal';
import FormButton from '~/components/shared/form/form-button';
import Dropdown from '~/components/shared/dropdown/dropdown';
import DropdownItem from '~/components/shared/dropdown/dropdown-item';
import AddRepoModal, {
  type NewRepoValues,
} from '~/components/home/add-repo-modal';
import LogPanel from '~/components/shared/log-panel/log-panel';
import { toast } from 'react-toastify';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSync,
  faPause,
  faTrash,
  faPen,
  faBox,
  faKey,
} from '@fortawesome/free-solid-svg-icons';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Apt Mirror Main Page' },
    { name: 'description', content: 'Apt Mirror Main Page' },
  ];
}

export { loader, action };

export default function Home() {
  const { isNpmProxyEnabled } = useRuntimeConfig();
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);
  const [pagesAvalabilityState, setPagesAvalabilityState] = useState<{
    [key: string]: boolean;
  }>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string>('');
  const [isActionInProgress, setIsActionInProgress] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [repoModalMode, setRepoModalMode] = useState<'add' | 'edit'>('add');
  const [editOriginalTitle, setEditOriginalTitle] = useState<string>('');
  const [repoInitialValues, setRepoInitialValues] =
    useState<NewRepoValues | null>(null);
  const [isRepositoryConfigsExpanded, setIsRepositoryConfigsExpanded] =
    useState(false);
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );
  const { repositoryConfigs, commentedSections, isLockFilePresent, latestLog } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (actionData?.success) {
      revalidator.revalidate();
    }
  }, [actionData?.success, revalidator]);

  useEffect(() => {
    if (actionData?.success) {
      setShowDeleteModal(false);
      setDeleteTarget('');
      setShowRepoModal(false);
      setIsActionInProgress(false);
      if (actionData.message) {
        toast.success(actionData.message);
      }
    } else if (actionData?.error) {
      setIsActionInProgress(false);
      toast.error(actionData.error);
    }
  }, [actionData?.success, actionData?.error, actionData?.message]);

  const handleDeleteClick = (sectionTitle: string) => {
    setDeleteTarget(sectionTitle);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    if (isActionInProgress) return;

    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', 'deleteRepository');
    formData.append('sectionTitle', deleteTarget);
    submit(formData, { method: 'post' });
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setDeleteTarget('');
  };

  const handleOpenAddRepo = () => {
    if (isLockFilePresent || isActionInProgress) return;
    setRepoModalMode('add');
    setEditOriginalTitle('');
    setRepoInitialValues(null);
    setShowRepoModal(true);
  };

  const handleOpenEditRepo = (config: RepositoryConfig) => {
    if (isLockFilePresent || isActionInProgress || !config.editable) return;
    const input = config.editable;
    setRepoModalMode('edit');
    setEditOriginalTitle(config.title);
    setRepoInitialValues({
      title: input.title,
      description: input.description ?? '',
      baseUrl: input.baseUrl,
      suites: input.suites.join(' '),
      components: input.components.join(' '),
      includeSrc: input.includeSrc,
      trusted: input.trusted,
    });
    setShowRepoModal(true);
  };

  const handleRepoSubmit = (values: NewRepoValues) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append(
      'action',
      repoModalMode === 'edit' ? 'editRepository' : 'addRepository',
    );
    if (repoModalMode === 'edit') {
      formData.append('originalTitle', editOriginalTitle);
    }
    formData.append('title', values.title);
    formData.append('description', values.description);
    formData.append('baseUrl', values.baseUrl);
    formData.append('suites', values.suites);
    formData.append('components', values.components);
    formData.append('includeSrc', String(values.includeSrc));
    formData.append('trusted', String(values.trusted));
    submit(formData, { method: 'post' });
  };

  const handleRestoreClick = (sectionTitle: string) => {
    if (isActionInProgress) return;

    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', 'restoreRepository');
    formData.append('sectionTitle', sectionTitle);
    submit(formData, { method: 'post' });
  };

  const handleGenerateGpgKey = (host: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', 'generateGpgKey');
    formData.append('host', host);
    submit(formData, { method: 'post' });
  };

  const handleSignRelease = (host: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', 'signRelease');
    formData.append('host', host);
    submit(formData, { method: 'post' });
  };

  const handleDeleteGpgKey = (host: string) => {
    if (isActionInProgress) return;
    if (
      !confirm(
        `Delete signing key for ${host}? Apt clients trusting this key will stop verifying.`,
      )
    ) {
      return;
    }
    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', 'deleteGpgKey');
    formData.append('host', host);
    submit(formData, { method: 'post' });
  };

  const handleSyncToggle = () => {
    if (isActionInProgress) return;

    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', isLockFilePresent ? 'stopSync' : 'startSync');
    submit(formData, { method: 'post' });
  };

  const handleRepositoryConfigsToggle = () => {
    setIsRepositoryConfigsExpanded(!isRepositoryConfigsExpanded);
  };

  const calculateHiddenItems = () => {
    if (repositoryConfigs.length === 0) return 0;

    const itemsPerRow = windowWidth >= 768 ? 2 : 1;
    const maxVisibleRows = 1;
    const maxVisibleItems = itemsPerRow * maxVisibleRows;

    return Math.max(0, repositoryConfigs.length - maxVisibleItems);
  };

  useEffect(() => {
    const checkPagesAvalability = async () => {
      const pages = appConfig.hosts;
      const pagesAvalabilityState = await Promise.all(
        pages.map(async (page) => {
          try {
            const healthEndpoint = '/';
            const response = await fetch(
              getHostAddress(page.address) + healthEndpoint,
            );
            return { [getHostAddress(page.address)]: response.ok };
          } catch (error) {
            return { [getHostAddress(page.address)]: false };
          }
        }),
      );
      setPagesAvalabilityState(
        pagesAvalabilityState.reduce((acc, curr) => ({ ...acc, ...curr }), {}),
      );
    };

    checkPagesAvalability();

    if (timer) {
      clearInterval(timer);
    }
    const interval = setInterval(checkPagesAvalability, 10000);
    setTimer(interval);

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, []);

  useEffect(() => {
    const syncStatusInterval = setInterval(() => {
      revalidator.revalidate();
    }, 5000);

    return () => {
      clearInterval(syncStatusInterval);
    };
  }, [revalidator]);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <PageLayoutFull>
      {/* Page header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface md:text-[30px]">
            System Overview
          </h1>
          <p className="text-sm text-on-surface-variant">
            Repository inventory &amp; synchronization status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={isActionInProgress ? undefined : handleSyncToggle}
            disabled={isActionInProgress}
            title={
              isActionInProgress
                ? 'Action in progress...'
                : isLockFilePresent
                  ? 'Click to stop sync'
                  : 'Click to start sync'
            }
            className={classNames(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
              isActionInProgress
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer',
              isLockFilePresent
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-outline-variant bg-surface-container text-on-surface-variant hover:text-on-surface',
            )}
          >
            <FontAwesomeIcon
              icon={isLockFilePresent ? faSync : faPause}
              className={isLockFilePresent ? 'animate-spin' : ''}
            />
            <span>{isLockFilePresent ? 'Syncing' : 'Idle'}</span>
          </button>
          <Dropdown
            trigger={
              <FormButton onClick={() => {}} type="primary" size="small">
                + Add
              </FormButton>
            }
            disabled={isLockFilePresent || isActionInProgress}
          >
            <DropdownItem onClick={handleOpenAddRepo}>
              Add repository…
            </DropdownItem>
            {commentedSections.map((section: CommentedSection) => (
              <DropdownItem
                key={section.title}
                onClick={() => handleRestoreClick(section.title)}
              >
                Enable: {section.title}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      </div>

      {/* Active repositories */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold text-on-surface">
          Active Repositories
        </h2>
        <div className="relative">
          <div
            className={classNames(
              'relative overflow-hidden transition-all duration-300 ease-in-out',
              isRepositoryConfigsExpanded ? 'max-h-none pb-8' : 'max-h-[200px]',
            )}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {repositoryConfigs.length > 0 ? (
                repositoryConfigs.map((config: RepositoryConfig) => (
                  <div
                    key={config.title}
                    className="relative flex max-h-[160px] flex-col gap-3 overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-low p-4"
                  >
                    <div className="w-[calc(100%-72px)] shrink-0 truncate font-heading text-base font-semibold text-on-surface">
                      {config.title}
                    </div>
                    {config.content.map((line: string, lineIndex: number) => (
                      <div
                        key={lineIndex}
                        className="shrink-0 truncate font-mono text-[12px] text-on-surface-variant"
                      >
                        {line}
                      </div>
                    ))}
                    <div className="absolute right-3 top-3 flex items-center gap-3">
                      {config.hosts.length > 0 && (
                        <Dropdown
                          trigger={
                            <span
                              className="cursor-pointer text-on-surface-variant transition-colors hover:text-primary"
                              title="GPG signing options"
                            >
                              <FontAwesomeIcon icon={faKey} />
                            </span>
                          }
                          disabled={isActionInProgress}
                        >
                          {config.hosts.map((h, idx) => (
                            <div
                              key={h.host}
                              className={
                                idx > 0
                                  ? 'border-t border-outline-variant/40'
                                  : ''
                              }
                            >
                              <div
                                className="px-4 py-2 text-xs"
                                title={h.gpgKey?.fingerprint ?? h.host}
                              >
                                <div className="truncate font-semibold text-on-surface">
                                  {h.host}
                                </div>
                                <div
                                  className={`truncate font-mono text-[10px] ${
                                    h.gpgKey
                                      ? 'text-success'
                                      : 'text-on-surface-variant/60'
                                  }`}
                                >
                                  {h.gpgKey ? h.gpgKey.keyId : 'unsigned'}
                                </div>
                              </div>
                              {h.gpgKey ? (
                                <>
                                  <DropdownItem
                                    onClick={() =>
                                      window.open(
                                        `/api/pubkey/${h.host}`,
                                        '_blank',
                                      )
                                    }
                                  >
                                    Download public key
                                  </DropdownItem>
                                  <DropdownItem
                                    onClick={() => handleSignRelease(h.host)}
                                    disabled={
                                      isLockFilePresent || isActionInProgress
                                    }
                                  >
                                    Re-sign Release files
                                  </DropdownItem>
                                  <DropdownItem
                                    onClick={() => handleDeleteGpgKey(h.host)}
                                    disabled={isActionInProgress}
                                  >
                                    Delete signing key
                                  </DropdownItem>
                                </>
                              ) : (
                                <DropdownItem
                                  onClick={() => handleGenerateGpgKey(h.host)}
                                  disabled={isActionInProgress}
                                >
                                  Generate signing key
                                </DropdownItem>
                              )}
                            </div>
                          ))}
                        </Dropdown>
                      )}
                      {config.editable && (
                        <button
                          onClick={() => handleOpenEditRepo(config)}
                          className="cursor-pointer text-on-surface-variant transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            isActionInProgress
                              ? 'Action in progress...'
                              : isLockFilePresent
                                ? 'Cannot edit while sync is running'
                                : 'Edit repository configuration'
                          }
                          disabled={isLockFilePresent || isActionInProgress}
                        >
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteClick(config.title)}
                        className="cursor-pointer text-on-surface-variant transition-colors hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                        title={
                          isActionInProgress
                            ? 'Action in progress...'
                            : isLockFilePresent
                              ? 'Cannot delete while sync is running'
                              : 'Delete repository configuration'
                        }
                        disabled={isLockFilePresent || isActionInProgress}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full flex h-[160px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-variant p-4">
                  <div className="mb-2 text-[48px] text-on-surface-variant/40">
                    <FontAwesomeIcon icon={faBox} />
                  </div>
                  <div className="text-center text-sm font-medium text-on-surface-variant">
                    No repository configurations found
                  </div>
                  <div className="mt-1 text-center text-xs text-on-surface-variant/60">
                    Use the + Add button to add configurations
                  </div>
                </div>
              )}
            </div>
            {/* +x more / show less control */}
            {calculateHiddenItems() > 0 && !isRepositoryConfigsExpanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-gradient-to-t from-background via-background to-transparent">
                <button
                  onClick={handleRepositoryConfigsToggle}
                  className="pointer-events-auto cursor-pointer rounded-full border border-outline-variant bg-surface-container px-3 py-1 text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
                  title="Expand and see all repository configurations"
                >
                  +{calculateHiddenItems()} more
                </button>
              </div>
            )}
          </div>
          {isRepositoryConfigsExpanded && (
            <div className="mt-2 flex justify-center">
              <button
                onClick={handleRepositoryConfigsToggle}
                className="cursor-pointer rounded-full border border-outline-variant bg-surface-container px-3 py-1 text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
              >
                Show less
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Service status */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold text-on-surface">
          Service Status
        </h2>
        <ResourceMonitor />
      </section>

      {/* Live output */}
      {latestLog && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold text-on-surface">
              Live Output
            </h2>
            {isLockFilePresent && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                Live
              </span>
            )}
          </div>
          <LogPanel
            content={latestLog.content}
            title={latestLog.name}
            bodyClassName="max-h-[320px] min-h-[200px]"
          />
        </section>
      )}

      {/* Endpoints */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold text-on-surface">
          Endpoints
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {appConfig.hosts
            .filter((page) => {
              if (page.id === 'npm' && !isNpmProxyEnabled) {
                return false;
              }
              return true;
            })
            .map((page) => {
              const online =
                pagesAvalabilityState[getHostAddress(page.address)];
              return (
                <div
                  key={page.address}
                  className="relative flex min-h-[120px] flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-low p-4"
                >
                  <a
                    href={getHostAddress(page.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-[calc(100%-56px)] truncate font-heading text-base font-semibold text-on-surface hover:text-primary"
                  >
                    {page.name}
                  </a>
                  <div className="truncate font-mono text-[11px] text-on-surface-variant">
                    {getHostAddress(page.address)}
                  </div>
                  <div className="text-xs text-on-surface-variant/80">
                    {page.description}
                  </div>
                  <span
                    className={classNames(
                      'absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      online
                        ? 'bg-success/10 text-success'
                        : 'bg-error/10 text-error',
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {online ? 'Online' : 'Offline'}
                  </span>
                </div>
              );
            })}
        </div>
      </section>

      {/* Add / Edit Repository Modal */}
      <AddRepoModal
        isOpen={showRepoModal}
        onClose={() => setShowRepoModal(false)}
        onSubmit={handleRepoSubmit}
        isSubmitting={isActionInProgress}
        initialValues={repoInitialValues}
        title={repoModalMode === 'edit' ? 'Edit Repository' : 'Add Repository'}
        submitLabel={
          repoModalMode === 'edit' ? 'Save Changes' : 'Add Repository'
        }
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title="Confirm Deletion"
        itemName={deleteTarget}
        itemType="repository configuration"
        isLoading={isActionInProgress}
      />
    </PageLayoutFull>
  );
}
