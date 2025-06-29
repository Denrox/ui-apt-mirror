import { useState, useEffect } from "react";
import fs from "fs/promises";
import path from "path";
import Title from "~/components/shared/title/title";
import ContentBlock from "~/components/shared/content-block/content-block";
import PageLayoutFull from "~/components/shared/layout/page-layout-full";
import FormButton from "~/components/shared/form/form-button";
import FormInput from "~/components/shared/form/form-input";

export function meta() {
  return [
    { title: "File Manager" },
    { name: "description", content: "File Manager for apt-mirror" },
  ];
}

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

interface FileTreeNode extends FileItem {
  children?: FileTreeNode[];
  expanded?: boolean;
}

// Validation functions
function isValidFileName(name: string): boolean {
  // Check for forbidden patterns
  const forbiddenPatterns = [
    /^\.\/$/,      // "./"
    /^\.\.\/$/,    // "../"
    /^\.\.$/,      // ".."
    /^\.$/,        // "."
    /\/\.\.\//,    // "/../"
    /\/\.\//,      // "/./"
    /\.\./,        // ".." anywhere in the name
    /\/\//,        // "//" (double slash)
  ];
  
  return !forbiddenPatterns.some(pattern => pattern.test(name));
}

function getValidationError(name: string): string | null {
  if (!name.trim()) {
    return "Name cannot be empty";
  }
  
  if (!isValidFileName(name)) {
    return "Name cannot contain './', '../', or other path traversal characters";
  }
  
  // Check for other invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return "Name contains invalid characters";
  }
  
  return null;
}

// Server Actions
async function getFileList(dirPath: string = "/var/www/files.mirror.intra"): Promise<FileItem[]> {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const fileList: FileItem[] = [];
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const stats = await fs.stat(fullPath);
      
      fileList.push({
        name: item.name,
        path: fullPath,
        isDirectory: item.isDirectory(),
        size: stats.size,
        modified: stats.mtime
      });
    }
    
    return fileList.sort((a, b) => {
      // Directories first, then files
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error("Error reading directory:", error);
    return [];
  }
}

async function createDirectory(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    console.error("Error creating directory:", error);
    return false;
  }
}

async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rmdir(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
    return true;
  } catch (error) {
    console.error("Error deleting file:", error);
    return false;
  }
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

async function createFolderAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const folderName = formData.get('folderName') as string;
  const currentPath = formData.get('currentPath') as string;
  
  // Validate folder name
  const validationError = getValidationError(folderName);
  if (validationError) {
    return { success: false, error: validationError };
  }
  
  const newPath = path.join(currentPath, folderName);
  const success = await createDirectory(newPath);
  
  if (success) {
    return { success: true };
  } else {
    return { success: false, error: "Failed to create folder" };
  }
}

export default function FileManager() {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [currentPath, setCurrentPath] = useState("/var/www/files.mirror.intra");
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = async (dirPath: string = currentPath) => {
    setLoading(true);
    try {
      const files = await getFileList(dirPath);
      const treeNodes: FileTreeNode[] = files.map(file => ({
        ...file,
        expanded: false,
        children: []
      }));
      setFileTree(treeNodes);
    } catch (error) {
      console.error("Error loading files:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleCreateFolder = async () => {
    // Clear previous error
    setError(null);
    
    const formData = new FormData();
    formData.append('folderName', newFolderName);
    formData.append('currentPath', currentPath);
    
    const result = await createFolderAction(formData);
    
    if (result.success) {
      setNewFolderName("");
      loadFiles();
    } else {
      setError(result.error || "Failed to create folder");
    }
  };

  const handleDelete = async (filePath: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    
    const success = await deleteFile(filePath);
    if (success) {
      loadFiles();
    } else {
      setError("Failed to delete item");
    }
  };

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
                  <FormButton onClick={handleUpload}>
                    Upload
                  </FormButton>
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
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : fileTree.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No files found</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {fileTree.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 hover:bg-gray-50">
                    <div className="flex items-center gap-2">
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