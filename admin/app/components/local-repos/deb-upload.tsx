import { useCallback, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import FormButton from '~/components/shared/form/form-button';
import Modal from '~/components/shared/modal/modal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload } from '@fortawesome/free-solid-svg-icons';

interface DebUploadProps {
  readonly host: string;
  readonly component: string;
  readonly disabled?: boolean;
  readonly onUploaded?: () => void;
}

const CHUNK_SIZE = 10240 * 1024;

export default function DebUpload({
  host,
  component,
  disabled = false,
  onUploaded,
}: DebUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const inputRef = useRef<HTMLInputElement>(null);

  const inputId = `deb-upload-${host}-${component}`;

  const uploadChunk = useCallback(
    async (
      chunk: Blob,
      index: number,
      total: number,
      name: string,
      fileId: string,
    ): Promise<boolean> => {
      const formData = new FormData();
      formData.append('intent', 'uploadChunk');
      formData.append('host', host);
      formData.append('component', component);
      formData.append('chunk', chunk);
      formData.append('chunkIndex', index.toString());
      formData.append('totalChunks', total.toString());
      formData.append('fileName', name);
      formData.append('fileId', fileId);

      await fetcher.submit(formData, {
        method: 'POST',
        action: '',
        encType: 'multipart/form-data',
      });
      return true;
    },
    [host, component, fetcher],
  );

  const handleFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (inputRef.current) inputRef.current.value = '';
      if (!file) return;

      if (!file.name.toLowerCase().endsWith('.deb')) {
        setError('Only .deb files can be uploaded to a local repository');
        return;
      }

      setError(null);
      setUploading(true);
      setFileName(file.name);
      setProgress(0);

      const fileId =
        Math.random().toString(36).substring(2) + Date.now().toString(36);
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      try {
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const chunk = file.slice(
            start,
            Math.min(start + CHUNK_SIZE, file.size),
          );
          await uploadChunk(chunk, i, totalChunks, file.name, fileId);
          setProgress(Math.round(((i + 1) / totalChunks) * 100));
        }
        onUploaded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
        setTimeout(() => setFileName(''), 1500);
      }
    },
    [uploadChunk, onUploaded],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".deb"
        onChange={handleFile}
        className="hidden"
        id={inputId}
        disabled={disabled || uploading}
      />
      <label htmlFor={inputId}>
        <FormButton
          onClick={() => document.getElementById(inputId)?.click()}
          type="secondary"
          size="small"
          disabled={disabled || uploading}
        >
          <FontAwesomeIcon icon={faUpload} /> {component}
        </FormButton>
      </label>

      {(uploading || error) && (
        <Modal
          isOpen={true}
          onClose={() => {
            if (uploading) return;
            setError(null);
          }}
          title={error ? 'Upload Failed' : 'Uploading Package'}
        >
          <div className="space-y-4">
            {error ? (
              <div className="text-sm text-error">{error}</div>
            ) : (
              <>
                <div className="text-sm text-on-surface-variant truncate">
                  {fileName}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-full bg-surface-container-high rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-on-surface-variant w-10 text-right">
                    {progress}%
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant/60">
                  Generating repository metadata after upload…
                </div>
              </>
            )}
            {error && (
              <div className="flex justify-end">
                <FormButton
                  type="secondary"
                  size="small"
                  onClick={() => setError(null)}
                >
                  Close
                </FormButton>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
