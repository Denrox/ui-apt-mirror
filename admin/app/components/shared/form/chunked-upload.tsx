import { useState, useCallback } from "react";
import { useSubmit } from "react-router";
import FormButton from "~/components/shared/form/form-button";

interface ChunkedUploadProps {
  onError: (error: string) => void;
  currentPath: string;
}

interface UploadChunk {
  chunk: Blob;
  index: number;
  total: number;
  fileName: string;
  fileId: string;
}

const CHUNK_SIZE = 10240 * 1024; // 10MB chunks

export default function ChunkedUpload({ onError, currentPath }: ChunkedUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const submit = useSubmit();
  const generateFileId = () => {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  };

  const splitFileIntoChunks = (file: File): UploadChunk[] => {
    const chunks: UploadChunk[] = [];
    const fileId = generateFileId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      chunks.push({
        chunk,
        index: i,
        total: totalChunks,
        fileName: file.name,
        fileId
      });
    }

    return chunks;
  };

  const uploadChunk = async (chunkData: UploadChunk, retries = 3): Promise<boolean> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const formData = new FormData();
        formData.append('intent', 'uploadChunk');
        formData.append('filePath', currentPath);
        formData.append('chunk', chunkData.chunk);
        formData.append('chunkIndex', chunkData.index.toString());
        formData.append('totalChunks', chunkData.total.toString());
        formData.append('fileName', chunkData.fileName);
        formData.append('fileId', chunkData.fileId);

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        await submit(formData, {
          method: 'POST',
          action: '',
          encType: 'multipart/form-data',
        });

        clearTimeout(timeoutId);
        return true;
      } catch (error) {
        console.error(`Chunk upload attempt ${attempt} failed:`, error);
        if (attempt === retries) {
          return false;
        }
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    return false;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setUploading(true);
    setProgress(0);

    try {
      const chunks = splitFileIntoChunks(selectedFile);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const success = await uploadChunk(chunk);

        if (!success) {
          throw new Error(`Failed to upload chunk ${i + 1} of ${chunks.length} after retries`);
        }

        // Update progress
        const newProgress = Math.round(((i + 1) / chunks.length) * 100);
        setProgress(newProgress);
      }

      setSelectedFile(null);
      setProgress(0);

    } catch (error) {
      console.error('Upload failed:', error);
      onError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [selectedFile, currentPath, onError]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="file"
        onChange={handleFileSelect}
        className="hidden"
        id="chunked-file-upload"
        disabled={uploading}
      />
      <label htmlFor="chunked-file-upload">
        <FormButton 
          type="secondary" 
          onClick={() => document.getElementById('chunked-file-upload')?.click()}
          disabled={uploading}
        >
          Select File
        </FormButton>
      </label>
      
      {selectedFile && (
        <>
          <span className="text-sm">{selectedFile.name}</span>
          <FormButton 
            onClick={handleUpload}
            disabled={uploading}
          >
            Upload
          </FormButton>
        </>
      )}
      
      {uploading && (
        <div className="flex items-center gap-2">
          <div className="w-32 bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <span className="text-sm text-gray-600">{progress}%</span>
        </div>
      )}
    </div>
  );
} 