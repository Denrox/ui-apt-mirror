import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Title from '~/components/shared/title/title';
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
import { loader } from './loader';
import { action } from './action';
import classNames from 'classnames';
import ChunkedUpload from '~/components/shared/form/chunked-upload';
import DownloadFile from '~/components/shared/form/download-file';
import { getHostAddress } from '~/utils/url';
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
  const data = useLoaderData<typeof loader & { __domain: string }>();
  const files = data?.files || [];
  const isLockFilePresent = data?.isLockFilePresent || false;
  const healthReport = data?.healthReport;
  const loaderError = data?.error;
  const isPublicRoute = data?.__domain === 'files';
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<
    'user-uploads' | 'mirrored-packages' | 'npm-packages'
  >('user-uploads');
  const revalidator = useRevalidator();
  const previousViewRef = useRef(view);

  const rootPath = useMemo(() => {
    if (view === 'mirrored-packages') {
      return appConfig.mirroredPackagesDir;
    } else if (view === 'npm-packages') {
      return appConfig.npmPackagesDir;
    } else {
      return appConfig.filesDir;
    }
  }, [view]);

  useEffect(() => {
    if (previousViewRef.current !== view) {
      setSearchParams({ path: rootPath });
      previousViewRef.current = view;
    }
  }, [view, rootPath, setSearchParams]);

  const currentPath = searchParams.get('path') ?? rootPath;

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
  const [searchResults, setSearchResults] = useState<any[]>([]);

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

  const shouldShowSyncPlaceholder = useMemo(() => {
    return view === 'mirrored-packages' && isLockFilePresent;
  }, [view, isLockFilePresent]);

  const isLoading = revalidator.state === 'loading';

  useEffect(() => {
    if (loaderError) {
      toast.error(loaderError);
      setSearchParams({ path: rootPath });
    }
  }, [loaderError, rootPath, setSearchParams]);

  const currentPathFiles = useMemo(() => {
    if (isSearching && searchResults.length > 0) {
      return searchResults;
    }
    return files.filter((file: any) => isChildPath(file.path, currentPath));
  }, [files, currentPath, isSearching, searchResults]);

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

  const handleSearch = useCallback(() => {
    if (searchQuery.trim().length < 3) return;
    
    setIsSearching(true);
    const formData = new FormData();
    formData.append('intent', 'searchFiles');
    formData.append('searchQuery', searchQuery.trim());
    formData.append('rootPath', currentPath);
    
    searchFetcher.submit(formData, { method: 'post' });
  }, [searchQuery, currentPath, searchFetcher]);

  const handleClearSearch = useCallback(() => {
    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  useEffect(() => {
    if (searchFetcher.data && searchFetcher.state === 'idle') {
      if (searchFetcher.data.success && searchFetcher.data.results) {
        setSearchResults(searchFetcher.data.results);
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
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma'];
    
    const lowerFileName = fileName.toLowerCase();
    
    if (videoExtensions.some(ext => lowerFileName.endsWith(ext))) {
      return 'video';
    }
    if (audioExtensions.some(ext => lowerFileName.endsWith(ext))) {
      return 'audio';
    }
    return null;
  };

  const getPreviewType = (fileName: string): 'image' | 'text' | 'pdf' | null => {
    const lower = fileName.toLowerCase();
    if (lower.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/)) return 'image';
    if (lower.endsWith('.txt')) return 'text';
    if (lower.endsWith('.pdf')) return 'pdf';
    return null;
  };

  // No per-type lists here: pass all currentPathFiles and let modals compute

  const handlePlayMedia = (item: any) => {
    const basePath = view === 'mirrored-packages' ? rootPath : appConfig.filesDir;
    const fileUrl = `${getHostAddress(appConfig.hosts.find((host) => host.id === 'files')?.address ?? '')}/downloads${item.path.replace(basePath, '')}`;
    const mediaType = isMediaFile(item.name);
    
    if (mediaType) {
      setMediaPlayer({
        isOpen: true,
        fileUrl,
        fileName: item.name,
        mediaType,
      });
    }
  };

  const handleSelectMediaFile = (file: { name: string; url: string; type: 'video' | 'audio' }) => {
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
    const basePath = view === 'mirrored-packages' ? rootPath : appConfig.filesDir;
    const fileUrl = `${getHostAddress(appConfig.hosts.find((host) => host.id === 'files')?.address ?? '')}/downloads${item.path.replace(basePath, '')}`;
    const previewType = getPreviewType(item.name);
    if (!previewType) return;
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

  const formatDate = (date: Date): string => {
    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    );
  };

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
          <Title title={isPublicRoute ? "Files" : "File Manager"} />
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
          <span className="text-sm text-gray-600 hidden md:block">View:</span>
          <FormSelect
            id="view-selector"
            label=""
            value={view}
            onChange={(value) =>
              setView(
                value as 'user-uploads' | 'mirrored-packages' | 'npm-packages',
              )
            }
            options={[
              { value: 'user-uploads', label: 'User Uploads' },
              { value: 'mirrored-packages', label: 'Mirrored Packages' },
              ...(appConfig.isNpmProxyEnabled
                ? [{ value: 'npm-packages', label: 'Npm Packages' }]
                : []),
            ]}
            disabled={
              Boolean(itemToRename) ||
              Boolean(fileToCut) ||
              isLoading
            }
          />
        </div>
      </div>

      <ContentBlock>
        <div className="flex flex-col gap-4">
          {view === 'mirrored-packages' && (
            <FileManagerWarning
              type="warning"
              message="Manual changes can break mirror functionality"
            />
          )}

          {view === 'npm-packages' && (
            <FileManagerWarning
              type="warning"
              message="Manual changes can break npm proxy functionality"
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
            <span className="font-semibold">
              {isSearching ? 'Searching inside:' : 'Current Path:'}
            </span>
            <span className="font-mono text-sm">{displayPath}</span>
          </div>

          <div
            className={classNames(
              'flex flex-wrap gap-4 px-0',
            )}
          >
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
                          if (e.key === 'Enter' && searchQuery.trim().length >= 3) {
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
                    {!isSearching && (
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
                    <span className="text-sm text-gray-600">
                      Moving:{' '}
                      <span className="font-medium">{fileToCut.name}</span>
                    </span>
                    <FormButton
                      onClick={handlePasteClick}
                      disabled={isOperationInProgress || isLoading}
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
                ) : !isPublicRoute && !isSearching ? (
                  <>
                    {
                      <ChunkedUpload
                        currentPath={currentPath}
                        onChunkUploaded={handleChunkUploaded}
                      />
                    }
                    {
                      <DownloadFile
                        currentPath={currentPath}
                      />
                    }
                    {view === 'user-uploads' && (
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
          <div className="border border-gray-200 rounded-md">
            {shouldShowSyncPlaceholder ? (
              <div className="p-8 text-center">
                <div className="text-gray-500 text-lg mb-2">
                  <FontAwesomeIcon icon={faSync} className="animate-spin" />
                </div>
                <div className="text-gray-700 font-medium mb-2">
                  Automatic sync is performed
                </div>
                <div className="text-gray-500 text-sm">
                  Manual operations will be available after it's complete
                </div>
              </div>
            ) : currentPathFiles.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
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
                          item.isDirectory ? 'text-gray-600' : 'text-gray-500'
                        }
                      />
                    }
                    title={
                      <div className="flex align-center w-[180px] md:w-[240px] max-w-[auto] lg:max-w-[360px] flex-shrink-0 lg:w-auto font-medium">
                        <Ellipsis>{item.name}</Ellipsis>
                      </div>
                    }
                    metadata={
                      <>
                        <div className="text-sm text-gray-500 text-right w-[96px] flex-shrink-0">
                          {item.isDirectory
                            ? ''
                            : formatFileSize(item.size ?? 0)}
                        </div>
                        <div className="text-sm text-gray-500 w-[120px] flex-shrink-0">
                          {item.modified && formatDate(item.modified)}
                        </div>
                      </>
                    }
                    actions={
                      <div className={classNames("flex items-center justify-end gap-2 flex-shrink-0", {
                        "w-[224px]": !isPublicRoute,
                        "w-[96px]": isPublicRoute
                      })}>
                        {!item.isDirectory && isMediaFile(item.name) && (
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
                        {!item.isDirectory && getPreviewType(item.name) && (
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
                        {!item.isDirectory && (
                          <FormButton
                            type="secondary"
                            size="small"
                            disabled={
                              isOperationInProgress ||
                              Boolean(fileToCut) ||
                              isLoading
                            }
                            onClick={() => {
                              const link = document.createElement('a');
                              const basePath =
                                view === 'mirrored-packages'
                                  ? rootPath
                                  : appConfig.filesDir;
                              link.href = `${getHostAddress(appConfig.hosts.find((host) => host.id === 'files')?.address ?? '')}/downloads${item.path.replace(basePath, '')}`;
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
                        {!isPublicRoute && (
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
                                handleCutClick({ path: item.path, name: item.name })
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
                          </>
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
        basePath={view === 'mirrored-packages' ? rootPath : appConfig.filesDir}
        filesHost={getHostAddress(appConfig.hosts.find((host) => host.id === 'files')?.address ?? '')}
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
        basePath={view === 'mirrored-packages' ? rootPath : appConfig.filesDir}
        filesHost={getHostAddress(appConfig.hosts.find((host) => host.id === 'files')?.address ?? '')}
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
