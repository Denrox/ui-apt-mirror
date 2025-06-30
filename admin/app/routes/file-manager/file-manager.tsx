import { useState, useEffect } from "react";
import fs from "fs/promises";
import Title from "~/components/shared/title/title";
import ContentBlock from "~/components/shared/content-block/content-block";
import PageLayoutFull from "~/components/shared/layout/page-layout-full";
import FormButton from "~/components/shared/form/form-button";
import FormInput from "~/components/shared/form/form-input";
import { useLoaderData, useSubmit } from "react-router";
import appConfig from "~/config/config.json";
import { loader } from "./loader";
import { action, getValidationError } from "./action";

export { action, loader };

export function meta() {
  return [
    { title: "File Manager" },
    { name: "description", content: "File Manager for apt-mirror" },
  ];
}

async function uploadFile(filePath: string, file: File): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));
    return true;
  } catch (error) {
    console.error("Error uploading file:", error);
    return false;
  }
}

export default function FileManager() {
  const { fileTree } = useLoaderData<typeof loader>();
  const [currentPath, setCurrentPath] = useState(appConfig.filesDir);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = useSubmit()

  const loadFiles = async (dirPath: string = currentPath) => {
    console.log('loading');
  };

  const handleDelete = async (filePath: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;

    try {
      await submit(
        { intent: 'deleteFile', filePath: filePath },
        { action: '', method: 'post' },
      );
    } catch (error) {
      setError("Failed to delete item");
    }
  };

  /**
  const handleUpload = async () => {
    if (!selectedFile) return;
    
    // Clear previous error
    setError(null);
    
    // Validate file name
    const validationError = getValidationError(selectedFile.name);
    if (validationError) {
      setError(validationError);
      return;
    }
    
    const uploadPath = path.join(currentPath, selectedFile.name);
    const success = await uploadFile(uploadPath, selectedFile);
    
    if (success) {
      setSelectedFile(null);
      loadFiles();
    } else {
      setError("Failed to upload file");
    }
  };
  */

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Clear previous error
      setError(null);
      
      // Validate file name
      const validationError = getValidationError(file.name);
      if (validationError) {
        setError(validationError);
        event.target.value = ""; // Clear the file input
        return;
      }
      
      setSelectedFile(file);
    }
  };

  const handleCreateFolder = async () => {
    setError(null);
        
    try {
      await submit(
        { intent: 'createFolder', folderName: newFolderName, currentPath: currentPath },
        { action: '', method: 'post' },
      )
      setNewFolderName('');
      loadFiles();
    } catch (error) {
      setError("Failed to create folder");
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  return (
    <PageLayoutFull>
      <Title title="File Manager" />
      
      <ContentBlock>
        <div className="flex flex-col gap-4">
          {/* Current Path */}
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md">
            <span className="font-semibold">Current Path:</span>
            <span className="font-mono text-sm">{currentPath}</span>
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-center gap-2">
                <span className="text-red-600">⚠️</span>
                <span className="text-red-700 text-sm">{error}</span>
                <FormButton
                  type="secondary"
                  size="small"
                  onClick={() => setError(null)}
                >
                  ✕
                </FormButton>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-md">
            {/* Create Folder */}
            <div className="flex items-center gap-2">
              <FormInput
                value={newFolderName}
                onChange={setNewFolderName}
                placeholder="New folder name"
              />
              <FormButton onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                Create Folder
              </FormButton>
            </div>

            {/* Upload File */}
            <div className="flex items-center gap-2">
              <input
                type="file"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload">
                <FormButton type="secondary" onClick={() => document.getElementById('file-upload')?.click()}>
                  Select File
                </FormButton>
              </label>
              {selectedFile && (
                <>
                  <span className="text-sm">{selectedFile.name}</span>
                  {/* <FormButton onClick={handleUpload}>
                    Upload
                  </FormButton> */}
                </>
              )}
            </div>

            {/* Refresh */}
            <FormButton type="secondary" onClick={() => loadFiles()}>
              Refresh
            </FormButton>
          </div>

          {/* File List */}
          <div className="border border-gray-200 rounded-md">
            {fileTree.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No files found</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {fileTree.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 hover:bg-gray-50">
                    <div onClick={() => item.isDirectory && setCurrentPath(item.path)} className="flex items-center gap-2">
                      <span className="text-lg">
                        {item.isDirectory ? "📁" : "📄"}
                      </span>
                      <span className="font-medium">{item.name}</span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-gray-500">
                        {item.isDirectory ? "Directory" : formatFileSize(item.size || 0)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {item.modified && formatDate(item.modified)}
                      </div>
                      <FormButton
                        type="danger"
                        size="small"
                        onClick={() => handleDelete(item.path)}
                      >
                        Delete
                      </FormButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ContentBlock>
    </PageLayoutFull>
  );
} 