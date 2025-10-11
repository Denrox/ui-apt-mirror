import { useState, useCallback, useRef, useEffect } from 'react';
import { useFetcher } from 'react-router';
import FormButton from '~/components/shared/form/form-button';

interface ChunkedUploadProps {
  readonly currentPath: string;
  readonly onSelectedFile: (isSelected: boolean) => void;
  readonly onChunkUploaded?: (chunkIndex: number, totalChunks: number) => void;
}

interface UploadChunk {
  readonly chunk: Blob;
  readonly index: number;
  readonly total: number;
  fileName: string;
  fileId: string;
}

interface FileUploadStatus {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

const CHUNK_SIZE = 10240 * 1024;

export default function ChunkedUpload({
  currentPath,
  onChunkUploaded,
  onSelectedFile,
}: ChunkedUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileUploadStatus[]>([]);
  const fetcher = useFetcher();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setUploading(false);
  }, []);

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
        fileId,
      });
    }

    return chunks;
  };

  const uploadChunk = useCallback(
    async (chunkData: UploadChunk, retries = 3): Promise<boolean> => {
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

          await fetcher.submit(formData, {
            method: 'POST',
            action: '',
            encType: 'multipart/form-data',
          });

          return true;
        } catch (error) {
          console.error(`Chunk upload attempt ${attempt} failed:`, error);
          if (attempt === retries) {
            return false;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
      return false;
    },
    [currentPath, fetcher],
  );

  useEffect(() => {
    onSelectedFile(selectedFiles.length > 0);
  }, [selectedFiles, onSelectedFile]);

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        const fileStatuses: FileUploadStatus[] = Array.from(files).map(file => ({
          file,
          progress: 0,
          status: 'pending' as const,
        }));
        setSelectedFiles(fileStatuses);
      }
    },
    [],
  );

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    abortControllerRef.current = new AbortController();

    try {
      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
        if (abortControllerRef.current?.signal.aborted) {
          break;
        }

        const fileStatus = selectedFiles[fileIndex];
        
        setSelectedFiles(prev => 
          prev.map((f, i) => 
            i === fileIndex ? { ...f, status: 'uploading' as const } : f
          )
        );

        const chunks = splitFileIntoChunks(fileStatus.file);

        try {
          for (let i = 0; i < chunks.length; i++) {
            if (abortControllerRef.current?.signal.aborted) {
              break;
            }

            const chunk = chunks[i];
            const success = await uploadChunk(chunk);

            if (!success) {
              throw new Error(
                `Failed to upload chunk ${i + 1} of ${chunks.length} after retries`,
              );
            }

            onChunkUploaded?.(chunk.index, chunk.total);

            const newProgress = Math.round(((i + 1) / chunks.length) * 100);
            setSelectedFiles(prev => 
              prev.map((f, idx) => 
                idx === fileIndex ? { ...f, progress: newProgress } : f
              )
            );
          }

          setSelectedFiles(prev => 
            prev.map((f, i) => 
              i === fileIndex ? { ...f, status: 'completed' as const, progress: 100 } : f
            )
          );
        } catch (error) {
          console.error('Upload failed for file:', fileStatus.file.name, error);
          setSelectedFiles(prev => 
            prev.map((f, i) => 
              i === fileIndex ? { 
                ...f, 
                status: 'error' as const, 
                error: error instanceof Error ? error.message : 'Upload failed' 
              } : f
            )
          );
        }
      }

      setTimeout(() => {
        setSelectedFiles([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }, 2000);
    } catch (error) {
      console.error('Upload process failed:', error);
    } finally {
      setUploading(false);
    }
  }, [selectedFiles, currentPath, uploadChunk, onChunkUploaded]);

  const getStatusIcon = (status: FileUploadStatus['status']) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'error':
        return '✗';
      case 'uploading':
        return '↻';
      default:
        return '⋯';
    }
  };

  const getStatusColor = (status: FileUploadStatus['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      case 'uploading':
        return 'text-blue-600';
      default:
        return 'text-gray-400';
    }
  };

  const completedCount = selectedFiles.filter(f => f.status === 'completed').length;
  const currentUploadingIndex = selectedFiles.findIndex(f => f.status === 'uploading');
  const currentProgress = currentUploadingIndex >= 0 ? selectedFiles[currentUploadingIndex].progress : 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        id="chunked-file-upload"
        disabled={uploading}
      />
      {selectedFiles.length === 0 && (
        <label htmlFor="chunked-file-upload">
          <FormButton
            onClick={() =>
              document.getElementById('chunked-file-upload')?.click()
            }
            disabled={uploading}
          >
            Upload Files
          </FormButton>
        </label>
      )}
      {selectedFiles.length > 0 && !uploading && (
        <>
          <FormButton onClick={handleUpload} disabled={uploading}>
            Upload All
          </FormButton>
          <span className="text-sm text-gray-600">
            {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
          </span>
          <FormButton type="secondary" onClick={() => cancelUpload()}>
            Cancel
          </FormButton>
        </>
      )}
      {uploading && (
        <>
          <span className="text-sm text-gray-600">
            Uploading ({completedCount + 1}/{selectedFiles.length})
          </span>
          <div className="flex items-center gap-2">
            <div className="w-32 bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${currentProgress}%` }}
              ></div>
            </div>
            <span className="text-xs text-gray-600 w-10 text-right">
              {currentProgress}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}
