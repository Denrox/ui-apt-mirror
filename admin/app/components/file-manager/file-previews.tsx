interface PreviewFile {
  name: string;
  url: string;
  type?: string;
  size?: number;
}

interface FilePreviewsProps {
  readonly mediaFiles: PreviewFile[];
  readonly currentFileName: string;
  readonly onSelectMedia?: (file: any) => void;
}

export default function FilePreviews({
  mediaFiles,
  currentFileName,
  onSelectMedia,
}: FilePreviewsProps) {
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {mediaFiles.map((file, index) => (
          <button
            key={index}
            onClick={() => onSelectMedia?.(file)}
            className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:shadow-md flex-shrink-0 w-[140px] cursor-pointer ${
              file.name === currentFileName
                ? 'border-outline bg-surface-container-high'
                : 'border-outline-variant hover:border-outline-variant bg-surface-container'
            }`}
          >
            <div className="text-xs font-medium text-on-surface-variant text-center break-words w-full line-clamp-2">
              {file.name}
            </div>
            {file.size && (
              <div className="text-xs text-on-surface-variant">
                {formatFileSize(file.size)}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
