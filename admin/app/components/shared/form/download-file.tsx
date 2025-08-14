import { useState, useCallback, useEffect } from "react";
import { useSubmit } from "react-router";
import FormButton from "~/components/shared/form/form-button";
import FormInput from "~/components/shared/form/form-input";
import { toast } from "react-toastify";

interface DownloadFileProps {
  onError: (error: string) => void;
  onDownloadInput: (isDownloading: boolean) => void;
  currentPath: string;
}

export default function DownloadFile({ onError, currentPath, onDownloadInput }: DownloadFileProps) {
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const submit = useSubmit();

  const extractFileNameFromUrl = useCallback((url: string) => {
    if (!url.trim()) return;
    
    try {
      const urlObj = new URL(url.trim());
      const pathname = urlObj.pathname;
      const extractedName = pathname.split('/').pop() || 'downloaded-file';
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
      onError("URL is required");
      return;
    }

    setDownloading(true);

    try {
      await submit(
        { 
          intent: 'downloadFile', 
          url: url.trim(), 
          fileName: fileName || 'downloaded-file',
          currentPath: currentPath 
        },
        { action: '', method: 'post' }
      );

      setUrl("");
      setFileName("");
      setShowUrlInput(false);
      toast.success("File downloaded successfully!");
    } catch (error) {
      onError("Failed to download file");
    } finally {
      setDownloading(false);
    }
  }, [url, fileName, currentPath, onError, submit]);

  const handleCancel = useCallback(() => {
    setShowUrlInput(false);
    setUrl("");
    setFileName("");
  }, []);

  if (!showUrlInput) {
    return (
      <FormButton
        onClick={handleDownloadClick}
        disabled={downloading}
      >
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
        {downloading ? "Downloading..." : "Download"}
      </FormButton>
      <FormButton
        type="secondary"
        onClick={handleCancel}
        disabled={downloading}
      >
        Cancel
      </FormButton>
    </div>
  );
} 