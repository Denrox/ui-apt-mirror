import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Title from "~/components/shared/title/title";
import ContentBlock from "~/components/shared/content-block/content-block";
import PageLayoutFull from "~/components/shared/layout/page-layout-full";
import FormButton from "~/components/shared/form/form-button";
import FormInput from "~/components/shared/form/form-input";
import FormSelect from "~/components/shared/form/form-select";
import Modal from "~/components/shared/modal/modal";
import RenameForm from "~/components/file-manager/rename-form";
import Ellipsis from "~/components/shared/ellipsis/ellipsis";
import Dropdown from "~/components/shared/dropdown/dropdown";
import DropdownItem from "~/components/shared/dropdown/dropdown-item";
import DownloadImageModal from "~/components/file-manager/download-image-modal";
import FileManagerWarning from "~/components/shared/filemanager-warning/filemanager-warning";
import { useActionData, useLoaderData, useSubmit, useRevalidator, useSearchParams } from "react-router";
import appConfig from "~/config/config.json";
import { loader } from "./loader";
import { action } from "./action";
import classNames from "classnames";
import ChunkedUpload from "~/components/shared/form/chunked-upload";
import DownloadFile from "~/components/shared/form/download-file";
import { getHostAddress } from "~/utils/url";
import { toast } from "react-toastify";

export { action, loader };

export function shouldRevalidate({ 
  formData, 
  defaultShouldRevalidate 
}: {
  formData: FormData | null;
  defaultShouldRevalidate: boolean;
}) {
  if (formData?.get('intent') === 'uploadChunk') {
    return false;
  }
  
  return defaultShouldRevalidate;
}

export function meta({}: any) {
  return [
    { title: "File Manager" },
    { name: "description", content: "File Manager for apt-mirror2" },
  ];
}

function isChildPath(path: string, parentPath: string): boolean {
  const parentPathChunks = parentPath.split('/');
  const pathChunks = path.split('/');
  return path.startsWith(parentPath) && path !== parentPath && pathChunks.length - 1 === parentPathChunks.length;
}

export default function FileManager() {
  const { files, isLockFilePresent, healthReport, error: loaderError } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"user-uploads" | "mirrored-packages">("user-uploads");
  const revalidator = useRevalidator();
  const previousViewRef = useRef(view);
  
  const rootPath = useMemo(() => {
    if (view === "mirrored-packages") {
      return appConfig.mirroredPackagesDir;
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
  
  const currentPath = searchParams.get('path') || rootPath;
  
  const actionData = useActionData<typeof action>();
  const [newFolderName, setNewFolderName] = useState("");
  const submit = useSubmit();
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadImageModalOpen, setIsDownloadImageModalOpen] = useState(false);
  
  const [itemToRename, setItemToRename] = useState<{ path: string; name: string } | null>(null);
  
  const [fileToCut, setFileToCut] = useState<{ path: string; name: string } | null>(null);
  
  const isRootPath = useMemo(() => {
    return currentPath === rootPath;
  }, [currentPath, rootPath]);
  
  const shouldShowSyncPlaceholder = useMemo(() => {
    return view === "mirrored-packages" && isLockFilePresent;
  }, [view, isLockFilePresent]);
  
  const isLoading = revalidator.state === "loading";
  
  useEffect(() => {
    if (loaderError) {
      toast.error(loaderError);
      setSearchParams({ path: rootPath });
    }
  }, [loaderError, rootPath, setSearchParams]);

  const currentPathFiles = useMemo(() => {
    return files.filter((file) => isChildPath(file.path, currentPath));
  }, [files, currentPath]);

  const handleDelete = async (filePath: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;

    try {
      await submit(
        { intent: 'deleteFile', filePath: filePath },
        { action: '', method: 'post' },
      );
    } catch (error) {
      console.error(error);
    }
  };

  const actionMessage = useMemo(() => {
    if (actionData?.success) {
      return actionData.message;
    } else if (actionData?.error) {
      return actionData.error;
    }
  }, [actionData?.success, actionData?.error, actionData?.message]);

  useEffect(() => {
    if (!!actionData?.success) {
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

  const handleCreateFolder = async () => {
    try {
      await submit(
        { intent: 'createFolder', folderName: newFolderName, currentPath: currentPath },
        { action: '', method: 'post' },
      )
      setNewFolderName('');
    } catch (error) {
      toast.error("Failed to create folder");
    }
  };

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

  const handleRenameError = (error: string) => {
    toast.error(error);
  };

  const handleCutClick = (item: { path: string; name: string }) => {
    setFileToCut(item);
  };

  const handlePasteClick = async () => {
    if (!fileToCut) return;

    
    try {
      await submit(
        { intent: 'moveFile', sourcePath: fileToCut.path, destinationPath: currentPath },
        { action: '', method: 'post' },
      );
      setFileToCut(null);
    } catch (error) {
      toast.error("Failed to move item");
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
      toast.error("Failed to run health check");
    }
  };

  const handleClearHealthCheck = async () => {
    try {
      await submit(
        { intent: 'clearHealthCheck' },
        { action: '', method: 'post' },
      );
    } catch (error) {
      toast.error("Failed to clear health check");
    }
  };

  const handleChunkUploaded = useCallback((chunkIndex: number, totalChunks: number) => {
    if (chunkIndex === 0 || chunkIndex === totalChunks - 1) {
      revalidator.revalidate();
    }
  }, [revalidator]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString() + " " + date.toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  const parentDirName = useMemo(() => {
    return currentPath.split('/').slice(0, -1).join('/');
  }, [currentPath]);

  const isOperationInProgress = useMemo(() => {
    return isUploading || isDownloading;
  }, [isUploading, isDownloading]);

  return (
    <PageLayoutFull>
      <div className="flex items-center justify-between mb-4 px-[12px]">
        <div className="flex items-center gap-4">
          <Title title="File Manager" />
          <FormButton
            type="secondary"
            disabled={isOperationInProgress || isLoading}
            onClick={handleHealthCheck}
          >
            🔍 Health Check
          </FormButton>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 hidden md:block">View:</span>
          <FormSelect
            id="view-selector"
            label=""
            value={view}
            onChange={(value) => setView(value as "user-uploads" | "mirrored-packages")}
            options={[
              { value: "user-uploads", label: "User Uploads" },
              { value: "mirrored-packages", label: "Mirrored Packages" }
            ]}
            disabled={isUploading || isDownloading || !!itemToRename || !!fileToCut || !!newFolderName.trim() || isLoading}
          />
        </div>
      </div>
      
      <ContentBlock>
        <div className="flex flex-col gap-4">
          {view === "mirrored-packages" && (
            <FileManagerWarning
              type="warning"
              message="Manual changes can break mirror functionality"
            />
          )}
          
          {healthReport && healthReport.invalid_files && healthReport.invalid_files.length > 0 && (
            <FileManagerWarning
              type="error"
              message={`${healthReport.invalid_files.length} broken files were found`}
              details={healthReport.invalid_files.map((file: any) => `${file.path} (${file.reason})`)}
              actionLabel="Clear"
              onAction={handleClearHealthCheck}
              actionIcon="🗑️"
            />
          )}
          
          {healthReport && (!healthReport.invalid_files || healthReport.invalid_files.length === 0) && (
            <FileManagerWarning
              type="info"
              message="File system is valid - no broken files found"
              actionLabel="Clear"
              onAction={handleClearHealthCheck}
              actionIcon="🗑️"
            />
          )}
          
          <div className="flex items-center gap-2 px-0 bg-gray-50 rounded-md">
            <span className="font-semibold">Current Path:</span>
            <span className="font-mono text-sm">{currentPath}</span>
          </div>

          <div className={classNames("flex flex-wrap gap-4 px-0 bg-gray-50 rounded-md")}>
            {!shouldShowSyncPlaceholder && (
              <>
                {!isRootPath && parentDirName && (
                  <div className="flex items-center gap-2">
                    <FormButton onClick={() => setSearchParams({ path: parentDirName })} disabled={isLoading}>
                    ↑
                    </FormButton>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <FormInput
                    value={newFolderName}
                    onChange={setNewFolderName}
                    placeholder="New folder name"
                    disabled={isLoading}
                  />
                  <FormButton onClick={handleCreateFolder} disabled={!newFolderName.trim() || isOperationInProgress || isLoading}>
                    Create Folder
                  </FormButton>
                </div>
                {fileToCut ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">
                      Moving: <span className="font-medium">{fileToCut.name}</span>
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
                ) : (
                  <>
                    {!isDownloading && (
                      <ChunkedUpload
                        onSelectedFile={setIsUploading}
                        currentPath={currentPath}
                        onChunkUploaded={handleChunkUploaded}
                      />
                    )}
                    {!isUploading && (
                      <DownloadFile
                        onDownloadInput={setIsDownloading}
                        currentPath={currentPath}
                      />
                    )}
                    {!isUploading && !isDownloading && view === "user-uploads" && (
                      <Dropdown
                        disabled={isOperationInProgress || isLoading}
                        trigger={
                          <FormButton
                            type="secondary"
                            disabled={isOperationInProgress || isLoading}
                            onClick={() => {}} // Empty handler to satisfy FormButton requirements
                          >
                            ⋮
                          </FormButton>
                        }
                      >
                        <DropdownItem onClick={() => setIsDownloadImageModalOpen(true)}>
                          Download Container Image
                        </DropdownItem>
                      </Dropdown>
                    )}

                  </>
                )}
              </>
            )}
          </div>
          <div className="border border-gray-200 rounded-md">
            {shouldShowSyncPlaceholder ? (
              <div className="p-8 text-center">
                <div className="text-gray-500 text-lg mb-2">🔄</div>
                <div className="text-gray-700 font-medium mb-2">Automatic sync is performed</div>
                <div className="text-gray-500 text-sm">Manual operations will be available after it's complete</div>
              </div>
            ) : currentPathFiles.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No files found</div>
            ) : (
              <div className="divide-y divide-gray-200 w-full overflow-x-auto">
                {currentPathFiles.map((item, index) => (
                  <div key={index} className="flex w-auto items-center justify-between p-3 hover:bg-gray-50">
                    <div onClick={() => item.isDirectory && !isOperationInProgress && !isLoading && setSearchParams({ path: item.path })} className={classNames("flex items-center gap-2", {
                      "cursor-pointer": item.isDirectory && !isLoading,
                      "cursor-default": !item.isDirectory || isLoading,
                    })}>
                      <span className="text-lg">
                        {item.isDirectory ? "📁" : "📄"}
                      </span>
                      <div className="flex align-center w-[180px] md:w-[240px] max-w-[auto] lg:max-w-[360px] flex-shrink-0 lg:w-auto font-medium">
                        <Ellipsis>
                          {item.name}
                        </Ellipsis>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-gray-500 text-right w-[96px] flex-shrink-0">
                        {item.isDirectory ? '' : formatFileSize(item.size || 0)}
                      </div>
                      <div className="text-sm text-gray-500 w-[120px] flex-shrink-0">
                        {item.modified && formatDate(item.modified)}
                      </div>
                      <div className="flex items-center justify-end gap-2 w-[176px] flex-shrink-0">
                        {!item.isDirectory && (
                          <FormButton
                            type="secondary"
                            size="small"
                            disabled={isOperationInProgress || !!fileToCut || isLoading}
                            onClick={() => {
                              const link = document.createElement('a');
                              // Determine the base path to replace based on the current view
                              const basePath = view === "mirrored-packages" ? rootPath : appConfig.filesDir;
                              link.href = `${getHostAddress(appConfig.hosts.find(host => host.id === 'files')?.address || '')}${item.path.replace(basePath, '')}`;
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
                        <FormButton
                          type="secondary"
                          size="small"
                          disabled={isOperationInProgress || !!fileToCut || isLoading}
                          onClick={() => handleCutClick({ path: item.path, name: item.name })}
                        >
                          ✂️
                        </FormButton>
                        <FormButton
                          type="secondary"
                          size="small"
                          disabled={isOperationInProgress || !!fileToCut || isLoading}
                          onClick={() => handleRenameClick({ path: item.path, name: item.name })}
                        >
                          ✏️
                        </FormButton>
                        <FormButton
                          type="secondary"
                          size="small"
                          disabled={isOperationInProgress || !!fileToCut || isLoading}
                          onClick={() => handleDelete(item.path)}
                        >
                          🗑️
                        </FormButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ContentBlock>
      
      {itemToRename && (
        <Modal
          isOpen={!!itemToRename}
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
      
      <DownloadImageModal
        isOpen={isDownloadImageModalOpen}
        onClose={() => setIsDownloadImageModalOpen(false)}
        currentPath={currentPath}
      />
    </PageLayoutFull>
  );
}