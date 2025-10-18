import React, { useEffect, useMemo, useState } from 'react';
import Modal from '~/components/shared/modal/modal';
import FileManagerWarning from '~/components/shared/filemanager-warning/filemanager-warning';
import FilePreviews from '~/components/file-manager/file-previews';

type PreviewType = 'image' | 'text' | 'pdf';

interface FilePreviewModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly fileUrl: string;
  readonly fileName: string;
  readonly previewType: PreviewType;
  readonly onSelectPreviewFile?: (file: { name: string; url: string; size?: number }) => void;
  readonly allFiles?: { name: string; path: string; size?: number; isDirectory?: boolean }[];
  readonly basePath?: string;
  readonly filesHost?: string;
}

export default function FilePreviewModal({
  isOpen,
  onClose,
  fileUrl,
  fileName,
  previewType,
  onSelectPreviewFile,
  allFiles = [],
  basePath = '',
  filesHost = '',
}: FilePreviewModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const isText = useMemo(() => previewType === 'text', [previewType]);

  const sameTypeFiles = useMemo(() => {
    if (!allFiles || !filesHost || !basePath) return [] as { name: string; url: string; size?: number }[];
    const matchesType = (name: string) => {
      const lower = name.toLowerCase();
      if (previewType === 'image') return Boolean(lower.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/));
      if (previewType === 'text') return lower.endsWith('.txt');
      if (previewType === 'pdf') return lower.endsWith('.pdf');
      return false;
    };
    return allFiles
      .filter((f: any) => !f.isDirectory && matchesType(f.name))
      .map((f: any) => ({
        name: f.name,
        url: `${filesHost}/downloads${f.path.replace(basePath, '')}`,
        size: f.size,
      }));
  }, [allFiles, filesHost, basePath, previewType]);

  useEffect(() => {
    let isCancelled = false;
    if (isOpen && isText && fileUrl) {
      setIsLoading(true);
      setError(null);
      setTextContent('');
      fetch(fileUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!isCancelled) setTextContent(text);
        })
        .catch((e) => {
          if (!isCancelled) setError(`Failed to load text file: ${e.message}`);
        })
        .finally(() => {
          if (!isCancelled) setIsLoading(false);
        });
    }
    return () => {
      isCancelled = true;
    };
  }, [isOpen, isText, fileUrl]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={fileName} maxWidth="custom-1000">
      <div className="flex flex-col gap-6">
        {error && (
          <FileManagerWarning type="error" message={error} />
        )}

        {previewType === 'image' && (
          <div className="flex items-center justify-center">
            <img
              src={fileUrl}
              alt={fileName}
              className="max-h-[70vh] w-auto object-contain rounded shadow"
            />
          </div>
        )}

        {previewType === 'pdf' && (
          <div className="h-[70vh]">
            <iframe
              title="PDF Preview"
              src={fileUrl}
              className="w-full h-full border-0 rounded"
            />
          </div>
        )}

        {previewType === 'text' && (
          <div className="bg-gray-50 rounded border border-gray-200 p-3 max-h-[70vh] overflow-auto">
            {isLoading ? (
              <div className="text-sm text-gray-600">Loading...</div>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-sm text-gray-800">{textContent}</pre>
            )}
          </div>
        )}

        {sameTypeFiles.length > 0 && (
          <FilePreviews
            mediaFiles={sameTypeFiles}
            currentFileName={fileName}
            onSelectMedia={onSelectPreviewFile}
          />
        )}
      </div>
    </Modal>
  );
}


