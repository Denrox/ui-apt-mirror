import classNames from 'classnames';
import type { Route } from './+types/home';
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
  faPowerOff,
  faPen,
  faBox,
  faKey,
  faCopy,
} from '@fortawesome/free-solid-svg-icons';
import { copyText } from '~/utils/copy-text';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Apt Mirror Main Page' },
    { name: 'description', content: 'Apt Mirror Main Page' },
  ];
}

export { loader, action };

export default function Home() {
  const { isNpmProxyEnabled, hosts } = useRuntimeConfig();
  const [pagesAvalabilityState, setPagesAvalabilityState] = useState<{
    [key: string]: boolean;
  }>({});
  const [confirmTarget, setConfirmTarget] = useState<{
    action: 'deleteRepository' | 'removeRepository';
    title: string;
    revision: string;
  } | null>(null);
  const [deleteMirrorData, setDeleteMirrorData] = useState(false);
  const [isActionInProgress, setIsActionInProgress] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [repoModalMode, setRepoModalMode] = useState<'add' | 'edit'>('add');
  const [editOriginalTitle, setEditOriginalTitle] = useState<string>('');
  const [editRevision, setEditRevision] = useState<string>('');
  const [repoInitialValues, setRepoInitialValues] =
    useState<NewRepoValues | null>(null);
  const [isRepositoryConfigsExpanded, setIsRepositoryConfigsExpanded] =
    useState(false);
  // The real width is set after hydration, so the server HTML still matches.
  const [windowWidth, setWindowWidth] = useState(1024);
  const {
    repositoryConfigs,
    commentedSections,
    isLockFilePresent,
    latestLog,
    upstreams,
  } = useLoaderData<typeof loader>();
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
      setConfirmTarget(null);
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

  // Deleting mirrored files is chosen anew for every removal or disable.
  useEffect(() => setDeleteMirrorData(false), [confirmTarget]);

  const handleConfirm = () => {
    if (isActionInProgress || !confirmTarget) return;

    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', confirmTarget.action);
    formData.append('sectionTitle', confirmTarget.title);
    formData.append('revision', confirmTarget.revision);
    if (deleteMirrorData) {
      formData.append('deleteData', 'true');
    }
    submit(formData, { method: 'post' });
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
    setEditRevision(config.revision);
    setRepoInitialValues({
      title: input.title,
      description: input.description ?? '',
      baseUrl: input.baseUrl,
      suites: input.suites.join(' '),
      components: input.components.join(' '),
      includeSrc: input.includeSrc,
      trusted: input.trusted,
      arches: (input.arches ?? []).join(' '),
      includeSourceName: (input.filters?.include_source_name ?? []).join(' '),
      includeBinaryPackages: (
        input.filters?.include_binary_packages ?? []
      ).join(' '),
      excludeBinaryPackages: (
        input.filters?.exclude_binary_packages ?? []
      ).join(' '),
      includeSections: (input.filters?.include_sections ?? []).join(' '),
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
      formData.append('revision', editRevision);
    }
    formData.append('title', values.title);
    formData.append('description', values.description);
    formData.append('baseUrl', values.baseUrl);
    formData.append('suites', values.suites);
    formData.append('components', values.components);
    formData.append('includeSrc', String(values.includeSrc));
    formData.append('trusted', String(values.trusted));
    formData.append('arches', values.arches);
    formData.append('includeSourceName', values.includeSourceName);
    formData.append('includeBinaryPackages', values.includeBinaryPackages);
    formData.append('excludeBinaryPackages', values.excludeBinaryPackages);
    formData.append('includeSections', values.includeSections);
    submit(formData, { method: 'post' });
  };

  const handleRestoreClick = (section: CommentedSection) => {
    if (isActionInProgress) return;

    setIsActionInProgress(true);
    const formData = new FormData();
    formData.append('action', 'restoreRepository');
    formData.append('sectionTitle', section.title);
    formData.append('revision', section.revision);
    submit(formData, { method: 'post' });
  };

  const handleGenerateGpgKey = (host: string) => {
    if (isActionInProgress) return;
    if (
      !confirm(
        `Sign ${host} with a new key? Its Release files lose their upstream signatures: apt clients that verify it with the upstream key fail until they install the new key from the Usage snippet.`,
      )
    ) {
      return;
    }
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

  // Collapsed, the list shows its first row of cards.
  const collapsedCount = windowWidth >= 768 ? 2 : 1;
  const calculateHiddenItems = () =>
    Math.max(0, repositoryConfigs.length - collapsedCount);
  const visibleConfigs = isRepositoryConfigsExpanded
    ? repositoryConfigs
    : repositoryConfigs.slice(0, collapsedCount);

  const handleCopyUsage = async (config: RepositoryConfig) => {
    if (await copyText(config.content.join('\n'))) {
      toast.success(`Copied the ${config.title} sources`);
    } else {
      toast.error('Copying failed; select the text instead');
    }
  };

  useEffect(() => {
    const checkPagesAvalability = async () => {
      const pages = hosts;
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
    const interval = setInterval(checkPagesAvalability, 10000);
    return () => clearInterval(interval);
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

    handleResize();
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
            disabledReason={
              isLockFilePresent
                ? 'Repositories can be added once the sync is done'
                : 'Wait for the current action to finish'
            }
          >
            <DropdownItem onClick={handleOpenAddRepo}>
              Add repository…
            </DropdownItem>
            {commentedSections.map((section: CommentedSection, i: number) => (
              <DropdownItem
                key={`${i}:${section.title}`}
                onClick={() => handleRestoreClick(section)}
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
          <div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {repositoryConfigs.length > 0 ? (
                visibleConfigs.map((config: RepositoryConfig, i: number) => (
                  <div
                    key={`${i}:${config.title}`}
                    className="relative flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-4"
                  >
                    {/* The title takes the room the icons leave; the full title is in its tooltip. */}
                    <div className="flex items-center gap-3">
                      <div
                        className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-on-surface"
                        title={config.title}
                      >
                        {config.title}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <button
                          onClick={() => handleCopyUsage(config)}
                          className="cursor-pointer text-on-surface-variant transition-colors hover:text-primary"
                          title="Copy the sources"
                        >
                          <FontAwesomeIcon icon={faCopy} />
                        </button>
                        {config.hosts.length > 0 && (
                          <Dropdown
                            trigger={
                              <button
                                type="button"
                                className="cursor-pointer text-on-surface-variant transition-colors hover:text-primary"
                                title="GPG signing options"
                                aria-label="GPG signing options"
                              >
                                <FontAwesomeIcon icon={faKey} />
                              </button>
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
                          onClick={() =>
                            setConfirmTarget({
                              action: 'deleteRepository',
                              title: config.title,
                              revision: config.revision,
                            })
                          }
                          className="cursor-pointer text-on-surface-variant transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            isActionInProgress
                              ? 'Action in progress...'
                              : isLockFilePresent
                                ? 'Cannot disable while sync is running'
                                : 'Disable repository'
                          }
                          disabled={isLockFilePresent || isActionInProgress}
                        >
                          <FontAwesomeIcon icon={faPowerOff} />
                        </button>
                        <button
                          onClick={() =>
                            setConfirmTarget({
                              action: 'removeRepository',
                              title: config.title,
                              revision: config.revision,
                            })
                          }
                          className="cursor-pointer text-on-surface-variant transition-colors hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            isActionInProgress
                              ? 'Action in progress...'
                              : isLockFilePresent
                                ? 'Cannot remove while sync is running'
                                : 'Remove repository'
                          }
                          disabled={isLockFilePresent || isActionInProgress}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap break-all font-mono text-[12px] text-on-surface-variant">
                      {config.content.join('\n')}
                    </pre>
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
              <div className="mt-2 flex justify-center">
                <button
                  onClick={handleRepositoryConfigsToggle}
                  className="cursor-pointer rounded-full border border-outline-variant bg-surface-container px-3 py-1 text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
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

      {commentedSections.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold text-on-surface">
            Disabled Repositories
          </h2>
          <div className="flex flex-col divide-y divide-outline-variant/40 rounded-xl border border-outline-variant bg-surface-container-low">
            {commentedSections.map((section: CommentedSection, i: number) => (
              <div
                key={`${i}:${section.title}`}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                <span className="truncate text-sm text-on-surface-variant">
                  {section.title}
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => handleRestoreClick(section)}
                    className="cursor-pointer text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isLockFilePresent || isActionInProgress}
                  >
                    Enable
                  </button>
                  <button
                    onClick={() =>
                      setConfirmTarget({
                        action: 'removeRepository',
                        title: section.title,
                        revision: section.revision,
                      })
                    }
                    className="cursor-pointer text-on-surface-variant transition-colors hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                    title="Remove repository"
                    disabled={isLockFilePresent || isActionInProgress}
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
            firstLine={latestLog.firstLine}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {hosts
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
        upstreams={upstreams}
        title={repoModalMode === 'edit' ? 'Edit Repository' : 'Add Repository'}
        submitLabel={
          repoModalMode === 'edit' ? 'Save Changes' : 'Add Repository'
        }
      />

      {/* Disable / Remove Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={handleConfirm}
        title={
          confirmTarget?.action === 'removeRepository'
            ? 'Remove Repository'
            : 'Disable Repository'
        }
        itemName={confirmTarget?.title ?? ''}
        message={
          confirmTarget?.action === 'removeRepository'
            ? `Remove "${confirmTarget.title}" from mirror.list? Its sources and filters are deleted and the title can be reused.`
            : `Disable "${confirmTarget?.title}"? Its sources and filters are commented out and it is no longer synced. You can enable it again later.`
        }
        confirmLabel={
          confirmTarget?.action === 'removeRepository' ? 'Remove' : 'Disable'
        }
        isLoading={isActionInProgress}
      >
        {confirmTarget && (
          <label className="flex items-start gap-2 mb-6 text-sm text-on-surface-variant">
            <input
              type="checkbox"
              className="mt-1"
              checked={deleteMirrorData}
              onChange={(e) => setDeleteMirrorData(e.target.checked)}
            />
            <span>
              {confirmTarget.action === 'removeRepository'
                ? 'Also delete its mirrored files. Syncs never clean an upstream that is no longer configured.'
                : 'Also delete its mirrored files, so clients stop getting them. Syncs never clean a disabled repository; enabling it again downloads everything anew.'}{' '}
              Files still used by another enabled repository are kept.
            </span>
          </label>
        )}
      </DeleteConfirmationModal>
    </PageLayoutFull>
  );
}
