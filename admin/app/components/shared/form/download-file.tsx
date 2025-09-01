import { useState, useCallback, useEffect, useRef } from 'react';
import { useSubmit } from 'react-router';
import FormButton from '~/components/shared/form/form-button';
import FormInput from '~/components/shared/form/form-input';
import { toast } from 'react-toastify';

interface DownloadFileProps {
  readonly onDownloadInput: (isDownloading: boolean) => void;
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
    onDownloadInput(showUrlInput);
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
        toast.success('File downloaded successfully');
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

  if (!showUrlInput) {
    return (
      <FormButton onClick={handleDownloadClick} disabled={downloading}>
        Download File
      </FormButton>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <FormInput
        value={url}
        onChange={setUrl}
        placeholder="File URL"
        disabled={downloading}
      />
      <FormButton
        onClick={handleDownload}
        disabled={downloading || !url.trim()}
      >
        {downloading ? 'Downloading...' : 'Download'}
      </FormButton>
      <FormButton type="secondary" onClick={handleCancel}>
        Cancel
      </FormButton>
    </div>
  );
}
