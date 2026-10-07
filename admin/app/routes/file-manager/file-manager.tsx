import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ContentBlock from '~/components/shared/content-block/content-block';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import FormButton from '~/components/shared/form/form-button';
import FormSelect from '~/components/shared/form/form-select';
import FormInput from '~/components/shared/form/form-input';
import Modal from '~/components/shared/modal/modal';
import DeleteConfirmationModal from '~/components/shared/delete-confirmation-modal';
import RenameForm from '~/components/file-manager/rename-form';
import Ellipsis from '~/components/shared/ellipsis/ellipsis';
import Dropdown from '~/components/shared/dropdown/dropdown';
import DropdownItem from '~/components/shared/dropdown/dropdown-item';
import DownloadImageModal from '~/components/file-manager/download-image-modal';
import MediaPlayerModal from '~/components/file-manager/media-player-modal';
import CreateFolderModal from '~/components/file-manager/create-folder-modal';
import FilePreviewModal from '~/components/file-manager/file-preview-modal';
import FileManagerWarning from '~/components/shared/filemanager-warning/filemanager-warning';
import TableRow from '~/components/shared/table-row/table-row';
import TableWrapper from '~/components/shared/table-wrapper/table-wrapper';
import {
  useActionData,
  useLoaderData,
  useSubmit,
  useRevalidator,
  useSearchParams,
  useFetcher,
} from 'react-router';
import appConfig from '~/config/config.json';
import { hostOf, useRuntimeConfig } from '~/utils/use-runtime-config';
import { loader } from './loader';
import { action } from './action';
import classNames from 'classnames';
import ChunkedUpload from '~/components/shared/form/chunked-upload';
import DownloadFile from '~/components/shared/form/download-file';
import { getHostAddress } from '~/utils/url';
import { canDelete, fileUrl, viewOfPath, type FileManagerView } from '~/utils/file-links';
import { formatDateTime, useHydrated } from '~/utils/use-hydrated';
import { toast } from 'react-toastify';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faEllipsisV,
  faSync,
  faTrash,
  faCut,
  faEdit,
  faSearch,
  faFolder,
  faLink,
  faFolderPlus,
  faFile,
  faPlay,
  faEye,
} from '@fortawesome/free-solid-svg-icons';

export { action, loader };

export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: {
  formData: FormData | null;
  defaultShouldRevalidate: boolean;
}) {
  if (formData?.get('intent') === 'uploadChunk') {
    return false;
  }

  return defaultShouldRevalidate;
}

export function meta() {
  return [
    { title: 'File Manager' },
    { name: 'description', content: 'File Manager for apt-mirror2' },
  ];
}

function isChildPath(path: string, parentPath: string): boolean {
  const parentPathChunks = parentPath.split('/');
  const pathChunks = path.split('/');
  return (
    path.startsWith(parentPath) &&
    path !== parentPath &&
    pathChunks.length - 1 === parentPathChunks.length
  );
}

export default function FileManager() {
  const { isNpmProxyEnabled, hosts } = useRuntimeConfig();
  const filesHostAddress = hostOf(hosts, 'files');
  const data = useLoaderData<typeof loader & { __domain: string }>();
  const files = data?.files || [];
  const isLockFilePresent = data?.isLockFilePresent || false;
  const healthReport = data?.healthReport;
  const loaderError = data?.error;
  const page = data?.page ?? 1;
  const pageCount = data?.pageCount ?? 1;
  const totalFiles = data?.totalFiles ?? files.length;
  const isPublicRoute = data?.__domain === 'files';
  const [searchParams, setSearchParams] = useSearchParams();

  const revalidator = useRevalidator();

  const rootOfView = useCallback(
    (v: FileManagerView) => {
      if (v === 'mirrored-packages') {
        // The public host only shows the published mirror tree.
        return isPublicRoute ? appConfig.mirrorRoot : appConfig.mirroredPackagesDir;
      } else if (v === 'npm-packages') {
        return appConfig.npmPackagesDir;
      } else if (v === 'private-files') {
        return appConfig.privateFilesDir;
      }
      return appConfig.filesDir;
    },
    [isPublicRoute],
  );

  // The view follows the URL, so Back/Forward and links keep the selector in step.
  const pathParam = searchParams.get('path');
  const view = viewOfPath(pathParam, appConfig);
  const rootPath = rootOfView(view);
  const currentPath = pathParam ?? rootPath;
  const setView = (v: FileManagerView) => setSearchParams({ path: rootOfView(v) });

  const filesLinkHost = getHostAddress(filesHostAddress);
  const mirrorLinkHost = getHostAddress(hostOf(hosts, 'mirror'));
  const urlOf = useCallback(
    (p: string) => fileUrl(p, appConfig, { files: filesLinkHost, mirror: mirrorLinkHost }),
    [filesLinkHost, mirrorLinkHost],
  );

  const displayPath = useMemo(() => {
    return currentPath.replace(rootPath, '') || '/';
  }, [currentPath, rootPath]);

  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const searchFetcher = useFetcher<typeof action>();
  const [isDownloadImageModalOpen, setIsDownloadImageModalOpen] =
    useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  // null until the running search answers
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);

  useEffect(() => {
    setSearchQuery('');
    setIsSearching(false);
  }, [searchParams]);

  const [itemToRename, setItemToRename] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const [fileToCut, setFileToCut] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const [mediaPlayer, setMediaPlayer] = useState<{
    isOpen: boolean;
    fileUrl: string;
    fileName: string;
    mediaType: 'video' | 'audio';
  }>({
    isOpen: false,
    fileUrl: '',
    fileName: '',
    mediaType: 'video',
  });

  const isRootPath = useMemo(() => {
    return currentPath === rootPath;
  }, [currentPath, rootPath]);

  // Machine-managed: the server only allows deleting here.
  const isManagedView = view === 'mirrored-packages' || view === 'npm-packages';

  const shouldShowSyncPlaceholder = useMemo(() => {
    return view === 'mirrored-packages' && isLockFilePresent;
  }, [view, isLockFilePresent]);

  const isLoading = revalidator.state === 'loading';

  useEffect(() => {
    if (loaderError) {
      toast.error(loaderError);
      setSearchParams({ path: appConfig.filesDir }, { replace: true });
    }
  }, [loaderError, setSearchParams]);

  const currentPathFiles = useMemo(() => {
    if (isSearching) {
      // No matches is an empty list, not the folder's own contents.
      return searchResults ?? [];
    }
    return files.filter((file: any) => isChildPath(file.path, currentPath));
  }, [files, currentPath, isSearching, searchResults]);
  const isSearchPending = isSearching && searchResults === null;

  const handleDelete = (filePath: string, fileName: string) => {
    setDeleteTarget({ path: filePath, name: fileName });
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      await submit(
        { intent: 'deleteFile', filePath: deleteTarget.path },
        { action: '', method: 'post' },
      );
      setShowDeleteModal(false);
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const actionMessage = useMemo(() => {
    if (actionData?.success) {
      return actionData.message;
    } else if (actionData?.error) {
      return actionData.error;
    }
  }, [actionData?.success, actionData?.error, actionData?.message]);

  useEffect(() => {
    if (actionData?.success) {
      if (actionMessage) {
        toast.success(actionMessage);
      }
    } else {
      toast.error(actionMessage);
    }
  }, [actionMessage, actionData?.success]);

  useEffect(() => {
    if (actionData?.success) {
      revalidator.revalidate();
    }
  }, [actionData?.success, revalidator]);

  const handleRenameClick = (item: { path: string; name: string }) => {
    setItemToRename(item);
  };

  const handleRenameSuccess = () => {
    setItemToRename(null);
    revalidator.revalidate();
    refreshSearchRef.current();
  };

  const handleRenameCancel = () => {
    setItemToRename(null);
  };

  const handleCutClick = (item: { path: string; name: string }) => {
    setFileToCut(item);
  };

  const handlePasteClick = async () => {
    if (!fileToCut) return;

    try {
      await submit(
        {
          intent: 'moveFile',
          sourcePath: fileToCut.path,
          destinationPath: currentPath,
        },
        { action: '', method: 'post' },
      );
      setFileToCut(null);
    } catch (error) {
      toast.error('Failed to move item');
    }
  };

  const handleCutCancel = () => {
    setFileToCut(null);
  };

  const handleHealthCheck = async () => {
    try {
      await submit(
        { intent: 'runHealthCheck' },
        { action: '', method: 'post' },
      );
    } catch (error) {
      toast.error('Failed to run health check');
    }
  };

  const handleClearHealthCheck = async () => {
    try {
      await submit(
        { intent: 'clearHealthCheck' },
        { action: '', method: 'post' },
      );
    } catch (error) {
      toast.error('Failed to clear health check');
    }
  };

  const handleChunkUploaded = useCallback(
    (chunkIndex: number, totalChunks: number) => {
      if (chunkIndex === 0 || chunkIndex === totalChunks - 1) {
        revalidator.revalidate();
      }
    },
    [revalidator],
  );

  // The running search, so it can be run again after a change to one of its results.
  const lastSearchRef = useRef<{ query: string; rootPath: string } | null>(null);
  const runSearch = useCallback(
    (query: string, rootPath: string) => {
      lastSearchRef.current = { query, rootPath };
      const formData = new FormData();
      formData.append('intent', 'searchFiles');
      formData.append('searchQuery', query);
      formData.append('rootPath', rootPath);
      searchFetcher.submit(formData, { method: 'post' });
    },
    [searchFetcher],
  );

  const handleSearch = useCallback(() => {
    if (searchQuery.trim().length < 3) return;

    setIsSearching(true);
    setSearchResults(null);
    runSearch(searchQuery.trim(), currentPath);
  }, [searchQuery, currentPath, runSearch]);

  const handleClearSearch = useCallback(() => {
    setIsSearching(false);
    setSearchQuery('');
    setSearchResults(null);
    lastSearchRef.current = null;
  }, []);

  // Results are a snapshot: after a delete, rename or move from them, search again.
  const refreshSearch = useCallback(() => {
    const last = lastSearchRef.current;
    if (isSearching && last) runSearch(last.query, last.rootPath);
  }, [isSearching, runSearch]);
  const refreshSearchRef = useRef(refreshSearch);
  refreshSearchRef.current = refreshSearch;

  useEffect(() => {
    if (actionData?.success) refreshSearchRef.current();
  }, [actionData]);

  useEffect(() => {
    if (searchFetcher.data && searchFetcher.state === 'idle') {
      if (searchFetcher.data.success && searchFetcher.data.results) {
        setSearchResults(searchFetcher.data.results);
        setSearchTruncated(Boolean(searchFetcher.data.truncated));
      } else if (searchFetcher.data.error) {
        toast.error(searchFetcher.data.error);
        setIsSearching(false);
      }
    }
  }, [searchFetcher.data, searchFetcher.state]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isMediaFile = (fileName: string): 'video' | 'audio' | null => {
    const videoExtensions = [
      '.mp4',
      '.webm',
      '.ogg',
      '.mov',
      '.avi',
      '.mkv',
      '.m4v',
    ];
    const audioExtensions = [
      '.mp3',
      '.wav',
      '.ogg',
      '.m4a',
      '.flac',
      '.aac',
      '.wma',
    ];

    const lowerFileName = fileName.toLowerCase();

    if (videoExtensions.some((ext) => lowerFileName.endsWith(ext))) {
      return 'video';
    }
    if (audioExtensions.some((ext) => lowerFileName.endsWith(ext))) {
      return 'audio';
    }
    return null;
  };

  const getPreviewType = (
    fileName: string,
  ): 'image' | 'text' | 'pdf' | null => {
    const lower = fileName.toLowerCase();
    if (lower.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/)) return 'image';
    if (lower.endsWith('.txt')) return 'text';
    if (lower.endsWith('.pdf')) return 'pdf';
    return null;
  };

  // No per-type lists here: pass all currentPathFiles and let modals compute

  const handlePlayMedia = (item: any) => {
    const fileUrl = urlOf(item.path);
    const mediaType = isMediaFile(item.name);

    if (mediaType && fileUrl) {
      setMediaPlayer({
        isOpen: true,
        fileUrl,
        fileName: item.name,
        mediaType,
      });
    }
  };

  const handleSelectMediaFile = (file: {
    name: string;
    url: string;
    type: 'video' | 'audio';
  }) => {
    setMediaPlayer({
      isOpen: true,
      fileUrl: file.url,
      fileName: file.name,
      mediaType: file.type,
    });
  };

  const handleCloseMediaPlayer = () => {
    setMediaPlayer({
      isOpen: false,
      fileUrl: '',
      fileName: '',
      mediaType: 'video',
    });
  };

  const [filePreview, setFilePreview] = useState<{
    isOpen: boolean;
    fileUrl: string;
    fileName: string;
    previewType: 'image' | 'text' | 'pdf';
  }>({
    isOpen: false,
    fileUrl: '',
    fileName: '',
    previewType: 'image',
  });

  const handlePreviewFile = (item: any) => {
    const fileUrl = urlOf(item.path);
    const previewType = getPreviewType(item.name);
    if (!previewType || !fileUrl) return;
    setFilePreview({
      isOpen: true,
      fileUrl,
      fileName: item.name,
      previewType,
    });
  };

  const handleCloseFilePreview = () => {
    setFilePreview({
      isOpen: false,
      fileUrl: '',
      fileName: '',
      previewType: 'image',
    });
  };

  const hydrated = useHydrated();
  const formatDate = (date: Date): string => formatDateTime(date, hydrated);

  const parentDirName = useMemo(() => {
    return currentPath.split('/').slice(0, -1).join('/');
  }, [currentPath]);

  const isOperationInProgress = useMemo(() => {
    return false;
  }, []);

  return (
    <PageLayoutFull>
      <div className="flex items-center justify-between px-[12px]">
        <div className="flex items-center gap-4">
          <h1 className="font-heading text-2xl font-bold text-on-surface md:text-[30px]">
            {isPublicRoute ? 'Files' : 'File Manager'}
          </h1>
          {!isPublicRoute && (
            <div className="hidden md:block">
              <FormButton
                type="secondary"
                disabled={
                  isOperationInProgress ||
                  isLoading ||
                  (healthReport && healthReport.status === 'inProgress')
                }
                onClick={handleHealthCheck}
              >
                {healthReport && healthReport.status === 'inProgress' ? (
                  <>
                    <FontAwesomeIcon icon={faSearch} /> File System check in
                    progress
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faSearch} /> Health Check
                  </>
                )}
              </FormButton>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-on-surface-variant hidden md:block">
            View:
          </span>
          <FormSelect
            id="view-selector"
            label=""
            value={view}
            onChange={(value) =>
              setView(value as FileManagerView)
            }
            options={[
              { value: 'public-files', label: 'Public Files' },
              ...(!isPublicRoute
                ? [{ value: 'private-files', label: 'Private Files' }]
                : []),
              { value: 'mirrored-packages', label: 'Mirrored Packages' },
              ...(isNpmProxyEnabled && !isPublicRoute
                ? [{ value: 'npm-packages', label: 'Npm Packages' }]
                : []),
            ]}
            // Stays enabled while an item is cut, so it can be pasted in another storage.
            disabled={Boolean(itemToRename) || isLoading}
          />
        </div>
      </div>

      <ContentBlock>
        <div className="flex flex-col gap-4">
          {view === 'mirrored-packages' && (
            <FileManagerWarning
              type="warning"
              message="Manual changes can break mirror functionality. Only files inside the published mirror tree can be deleted here; the signing keys and the mirror folders are kept."
            />
          )}

          {view === 'npm-packages' && (
            <FileManagerWarning
              type="warning"
              message="Manual changes can break npm proxy functionality. Only deletion is available here."
            />
          )}

          {healthReport &&
            healthReport.status === 'done' &&
            healthReport.invalid_files &&
            healthReport.invalid_files.length > 0 && (
              <FileManagerWarning
                type="error"
                message={`${healthReport.invalid_files.length} broken files were found`}
                details={healthReport.invalid_files.map(
                  (file: any) =>
                    `${file.path} (${file.reason}) (${file.size} bytes)`,
                )}
                actionLabel="Clear"
                onAction={handleClearHealthCheck}
                actionIcon={<FontAwesomeIcon icon={faTrash} />}
              />
            )}

          {healthReport &&
            healthReport.status === 'done' &&
            (!healthReport.invalid_files ||
              healthReport.invalid_files.length === 0) && (
              <FileManagerWarning
                type="info"
                message="File system is valid - no broken files found"
                actionLabel="Clear"
                onAction={handleClearHealthCheck}
                actionIcon={<FontAwesomeIcon icon={faTrash} />}
              />
            )}

          {healthReport && healthReport.status === 'inProgress' && (
            <FileManagerWarning
              type="info"
              message="File system health check in progress..."
            />
          )}

          <div className="flex items-center gap-2 px-0">
            <span className="font-semibold text-on-surface-variant">
              {isSearching ? 'Searching inside:' : 'Current Path:'}
            </span>
            <span className="font-mono text-sm text-on-surface">
              {displayPath}
            </span>
          </div>

          <div className={classNames('flex flex-wrap gap-4 px-0')}>
            {!shouldShowSyncPlaceholder && (
              <>
                {!isRootPath && parentDirName && !isSearching && (
                  <div className="flex items-center gap-2">
                    <FormButton
                      onClick={() => setSearchParams({ path: parentDirName })}
                      disabled={isLoading}
                    >
                      ↑
                    </FormButton>
                  </div>
                )}
                {!isPublicRoute && (
                  <>
                    <div className="flex items-center gap-2">
                      <FormInput
                        value={searchQuery}
                        onChange={setSearchQuery}
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            searchQuery.trim().length >= 3
                          ) {
                            handleSearch();
                          }
                        }}
                        placeholder="Search files and folders..."
                        disabled={isLoading || isSearching}
                        width="220px"
                      />
                      {isSearching ? (
                        <FormButton
                          type="secondary"
                          onClick={handleClearSearch}
                          disabled={isLoading}
                        >
                          Clear
                        </FormButton>
                      ) : (
                        <FormButton
                          type="secondary"
                          onClick={handleSearch}
                          disabled={isLoading || searchQuery.trim().length < 3}
                        >
                          <FontAwesomeIcon icon={faSearch} />
                        </FormButton>
                      )}
                    </div>
                    {!isSearching && !isManagedView && (
                      <div className="flex items-center gap-2">
                        <FormButton
                          type="secondary"
                          onClick={() => setIsCreateFolderOpen(true)}
                          disabled={isLoading}
                        >
                          <FontAwesomeIcon icon={faFolderPlus} />
                        </FormButton>
                      </div>
                    )}
                  </>
                )}
                {!isPublicRoute && !isSearching && fileToCut ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-on-surface-variant">
                      Moving:{' '}
                      <span className="font-medium text-on-surface">
                        {fileToCut.name}
                      </span>
                    </span>
                    <FormButton
                      onClick={handlePasteClick}
                      disabled={isOperationInProgress || isLoading || isManagedView}
                    >
                      Paste
                    </FormButton>
                    <FormButton
                      type="secondary"
                      onClick={handleCutCancel}
                      disabled={isOperationInProgress || isLoading}
                    >
                      Cancel
                    </FormButton>
                  </div>
                ) : !isPublicRoute && !isSearching && !isManagedView ? (
                  <>
                    {
                      <ChunkedUpload
                        currentPath={currentPath}
                        onChunkUploaded={handleChunkUploaded}
                      />
                    }
                    {<DownloadFile currentPath={currentPath} />}
                    {view === 'public-files' && (
                      <Dropdown
                        disabled={isOperationInProgress || isLoading}
                        trigger={
                          <FormButton
                            type="secondary"
                            disabled={isOperationInProgress || isLoading}
                            onClick={() => {}}
                          >
                            <FontAwesomeIcon icon={faEllipsisV} />
                          </FormButton>
                        }
                      >
                        <DropdownItem
                          onClick={() => setIsDownloadImageModalOpen(true)}
                        >
                          Download Container Image
                        </DropdownItem>
                      </Dropdown>
                    )}
                  </>
                ) : null}
              </>
            )}
          </div>
          {isSearching && searchResults && searchTruncated && (
            <FileManagerWarning
              type="info"
              message={`Showing the first ${searchResults.length} matches; refine the search to see the rest`}
            />
          )}
          <div className="border border-outline-variant rounded-lg overflow-hidden">
            {shouldShowSyncPlaceholder ? (
              <div className="p-8 text-center">
                <div className="text-primary text-lg mb-2">
                  <FontAwesomeIcon icon={faSync} className="animate-spin" />
                </div>
                <div className="text-on-surface font-medium mb-2">
                  Automatic sync is performed
                </div>
                <div className="text-on-surface-variant text-sm">
                  Manual operations will be available after it's complete
                </div>
              </div>
            ) : isSearchPending ? (
              <div className="p-4 text-center text-on-surface-variant">
                Searching…
              </div>
            ) : currentPathFiles.length === 0 ? (
              <div className="p-4 text-center text-on-surface-variant">
                No files found
              </div>
            ) : (
              <TableWrapper>
                {currentPathFiles.map((item: any) => (
                  <TableRow
                    key={item.path}
                    icon={
                      <FontAwesomeIcon
                        icon={item.isDirectory ? faFolder : faFile}
                        className={
                          item.isDirectory
                            ? 'text-primary'
                            : 'text-on-surface-variant'
                        }
                      />
                    }
                    title={
                      <div
                        className={classNames(
                          'flex align-center w-[180px] md:w-[240px] max-w-[auto] lg:max-w-[360px] flex-shrink-0 lg:w-auto font-medium',
                          { 'italic': item.isSymlink, 'line-through opacity-60': item.isBrokenSymlink },
                        )}
                        title={item.isBrokenSymlink ? 'Broken symlink' : item.isSymlink ? 'Symlink' : undefined}
                      >
                        <Ellipsis>{item.name}</Ellipsis>
                        {item.isSymlink && (
                          <FontAwesomeIcon icon={faLink} className="ml-1.5 text-xs text-on-surface-variant self-center" />
                        )}
                      </div>
                    }
                    metadata={
                      <>
                        <div className="text-sm text-on-surface-variant text-right w-[96px] flex-shrink-0 font-mono">
                          {item.isDirectory
                            ? ''
                            : formatFileSize(item.size ?? 0)}
                        </div>
                        <div className="text-sm text-on-surface-variant w-[120px] flex-shrink-0">
                          {item.modified && formatDate(item.modified)}
                        </div>
                      </>
                    }
                    actions={
                      <div
                        className={classNames(
                          'flex items-center justify-end gap-2 flex-shrink-0',
                          {
                            'w-[224px]': !isPublicRoute,
                            'w-[96px]': isPublicRoute,
                          },
                        )}
                      >
                        {!item.isDirectory &&
                          isMediaFile(item.name) &&
                          view !== 'private-files' &&
                          urlOf(item.path) && (
                            <FormButton
                              type="secondary"
                              size="small"
                              disabled={
                                isOperationInProgress ||
                                Boolean(fileToCut) ||
                                isLoading
                              }
                              onClick={() => handlePlayMedia(item)}
                            >
                              <FontAwesomeIcon icon={faPlay} />
                            </FormButton>
                          )}
                        {!item.isDirectory &&
                          getPreviewType(item.name) &&
                          view !== 'private-files' &&
                          urlOf(item.path) && (
                            <FormButton
                              type="secondary"
                              size="small"
                              disabled={
                                isOperationInProgress ||
                                Boolean(fileToCut) ||
                                isLoading
                              }
                              onClick={() => handlePreviewFile(item)}
                            >
                              <FontAwesomeIcon icon={faEye} />
                            </FormButton>
                          )}
                        {!item.isDirectory && urlOf(item.path) && (
                          <FormButton
                            type="secondary"
                            size="small"
                            disabled={
                              isOperationInProgress ||
                              Boolean(fileToCut) ||
                              isLoading
                            }
                            onClick={() => {
                              const href = urlOf(item.path);
                              if (!href) return;
                              const link = document.createElement('a');
                              link.href = href;
                              link.target = '_blank';
                              link.rel = 'noopener noreferrer';
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            }}
                          >
                            ↓
                          </FormButton>
                        )}
                        {!isPublicRoute && !isManagedView && (
                          <>
                            <FormButton
                              type="secondary"
                              size="small"
                              disabled={
                                isOperationInProgress ||
                                Boolean(fileToCut) ||
                                isLoading
                              }
                              onClick={() =>
                                handleCutClick({
                                  path: item.path,
                                  name: item.name,
                                })
                              }
                            >
                              <FontAwesomeIcon icon={faCut} />
                            </FormButton>
                            <FormButton
                              type="secondary"
                              size="small"
                              disabled={
                                isOperationInProgress ||
                                Boolean(fileToCut) ||
                                isLoading
                              }
                              onClick={() =>
                                handleRenameClick({
                                  path: item.path,
                                  name: item.name,
                                })
                              }
                            >
                              <FontAwesomeIcon icon={faEdit} />
                            </FormButton>
                          </>
                        )}
                        {!isPublicRoute && canDelete(item.path, appConfig) && (
                          <FormButton
                            type="secondary"
                            size="small"
                            disabled={
                              isOperationInProgress ||
                              Boolean(fileToCut) ||
                              isLoading
                            }
                            onClick={() => handleDelete(item.path, item.name)}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </FormButton>
                        )}
                      </div>
                    }
                    onClick={() =>
                      item.isDirectory &&
                      !isOperationInProgress &&
                      !isLoading &&
                      setSearchParams({ path: item.path })
                    }
                    cursorClass={classNames({
                      'cursor-pointer': item.isDirectory && !isLoading,
                      'cursor-default': !item.isDirectory || isLoading,
                    })}
                  />
                ))}
              </TableWrapper>
            )}
          </div>
          {!isSearching && !shouldShowSyncPlaceholder && pageCount > 1 && (
            <nav
              className="flex items-center justify-center gap-3 text-sm text-on-surface-variant"
              aria-label="Pages"
            >
              <FormButton
                type="secondary"
                size="small"
                disabled={page <= 1 || isLoading}
                onClick={() => setSearchParams({ path: currentPath, page: String(page - 1) })}
              >
                ‹ Previous
              </FormButton>
              <span>
                Page {page} of {pageCount} ({totalFiles} items)
              </span>
              <FormButton
                type="secondary"
                size="small"
                disabled={page >= pageCount || isLoading}
                onClick={() => setSearchParams({ path: currentPath, page: String(page + 1) })}
              >
                Next ›
              </FormButton>
            </nav>
          )}
        </div>
      </ContentBlock>

      {itemToRename && (
        <Modal
          isOpen={Boolean(itemToRename)}
          onClose={handleRenameCancel}
          title="Rename Item"
        >
          <RenameForm
            item={itemToRename}
            onSuccess={handleRenameSuccess}
            onCancel={handleRenameCancel}
          />
        </Modal>
      )}

      {/* Create Folder Modal moved to dedicated component */}

      <DownloadImageModal
        isOpen={isDownloadImageModalOpen}
        onClose={() => setIsDownloadImageModalOpen(false)}
        currentPath={currentPath}
      />

      <CreateFolderModal
        isOpen={isCreateFolderOpen}
        onClose={() => setIsCreateFolderOpen(false)}
        currentPath={currentPath}
      />

      <MediaPlayerModal
        isOpen={mediaPlayer.isOpen}
        onClose={handleCloseMediaPlayer}
        fileUrl={mediaPlayer.fileUrl}
        fileName={mediaPlayer.fileName}
        mediaType={mediaPlayer.mediaType}
        onSelectMedia={handleSelectMediaFile}
        allFiles={currentPathFiles}
        urlOf={urlOf}
      />

      <FilePreviewModal
        isOpen={filePreview.isOpen}
        onClose={handleCloseFilePreview}
        fileUrl={filePreview.fileUrl}
        fileName={filePreview.fileName}
        previewType={filePreview.previewType}
        onSelectPreviewFile={(file) =>
          setFilePreview((prev) => ({
            ...prev,
            isOpen: true,
            fileUrl: file.url,
            fileName: file.name,
            previewType: getPreviewType(file.name) || prev.previewType,
          }))
        }
        allFiles={currentPathFiles}
        urlOf={urlOf}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title="Confirm Deletion"
        itemName={deleteTarget?.name || ''}
        itemType="file/folder"
      />
    </PageLayoutFull>
  );
}
