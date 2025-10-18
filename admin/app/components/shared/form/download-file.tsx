import { useState, useCallback, useEffect, useRef } from 'react';
import { useSubmit } from 'react-router';
import FormButton from '~/components/shared/form/form-button';
import FormInput from '~/components/shared/form/form-input';
import Modal from '~/components/shared/modal/modal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { toast } from 'react-toastify';

interface DownloadFileProps {
  readonly onDownloadInput?: (isDownloading: boolean) => void;
  readonly currentPath: string;
}

export default function DownloadFile({
  currentPath,
  onDownloadInput,
}: DownloadFileProps) {
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const submit = useSubmit();
  const abortControllerRef = useRef<AbortController | null>(null);

  const extractFileNameFromUrl = useCallback((url: string) => {
    if (!url.trim()) return;

    try {
      const urlObj = new URL(url.trim());
      const pathname = urlObj.pathname;
      const extractedName = pathname.split('/').pop() ?? 'downloaded-file';
      setFileName(extractedName);
    } catch (error) {
      setFileName('downloaded-file');
    }
  }, []);

  useEffect(() => {
    extractFileNameFromUrl(url);
  }, [url, extractFileNameFromUrl]);

  const handleDownloadClick = useCallback(() => {
    setShowUrlInput(true);
  }, []);

  useEffect(() => {
    if (onDownloadInput) {
      onDownloadInput(showUrlInput);
    }
  }, [showUrlInput, onDownloadInput]);

  const handleDownload = useCallback(async () => {
    if (!url.trim()) {
      toast.error('URL is required');
      return;
    }

    abortControllerRef.current = new AbortController();
    setDownloading(true);

    try {
      await submit(
        {
          intent: 'downloadFile',
          url: url.trim(),
          fileName: fileName ?? 'downloaded-file',
          currentPath: currentPath,
        },
        { action: '', method: 'post' },
      );

      if (!abortControllerRef.current.signal.aborted) {
        setUrl('');
        setFileName('');
        setShowUrlInput(false);
      }
    } catch (error) {
      if (!abortControllerRef.current.signal.aborted) {
        toast.error('Failed to download file');
      }
    } finally {
      setDownloading(false);
      abortControllerRef.current = null;
    }
  }, [url, fileName, currentPath, submit]);

  const cleanupPartialDownload = useCallback(async () => {
    if (fileName) {
      try {
        await submit(
          {
            intent: 'cleanupDownload',
            filePath: currentPath,
            fileName: fileName,
          },
          { action: '', method: 'post' },
        );
      } catch (error) {
        console.error('Failed to clean up partial download:', error);
      }
    }
  }, [fileName, currentPath, submit]);

  const handleCancel = useCallback(async () => {
    if (downloading && abortControllerRef.current) {
      abortControllerRef.current.abort();
      await cleanupPartialDownload();
    }

    setShowUrlInput(false);
    setUrl('');
    setFileName('');
    setDownloading(false);
  }, [downloading, cleanupPartialDownload]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <>
      <FormButton type="secondary" onClick={handleDownloadClick} disabled={downloading}>
        <FontAwesomeIcon icon={faDownload} />
      </FormButton>
      {showUrlInput && (
        <Modal
          isOpen={true}
          onClose={() => {
            if (downloading) return; // prevent closing while downloading
            handleCancel();
          }}
          title="Download File"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="download-url"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                File URL
              </label>
              <FormInput
                id="download-url"
                value={url}
                onChange={setUrl}
                placeholder="https://example.com/file.zip"
                disabled={downloading}
              />
              <p className="text-xs text-gray-500 mt-1">
                Filename is auto-detected from URL. You can rename after download.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              {downloading ? (
                <FormButton type="secondary" onClick={handleCancel}>
                  Cancel Download
                </FormButton>
              ) : (
                <>
                  <FormButton type="secondary" onClick={handleCancel}>
                    Cancel
                  </FormButton>
                  <FormButton onClick={handleDownload} disabled={!url.trim()}>
                    Download
                  </FormButton>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
