import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '~/components/shared/modal/modal';
import FileManagerWarning from '~/components/shared/filemanager-warning/filemanager-warning';
import FilePreviews from '~/components/file-manager/file-previews';

interface MediaFile {
  name: string;
  url: string;
  type: 'video' | 'audio';
  size?: number;
}

interface MediaPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl: string;
  fileName: string;
  mediaType: 'video' | 'audio';
  onSelectMedia?: (file: MediaFile) => void;
  allFiles?: { name: string; path: string; size?: number; isDirectory?: boolean }[];
  basePath?: string;
  filesHost?: string;
}

export default function MediaPlayerModal({
  isOpen,
  onClose,
  fileUrl,
  fileName,
  mediaType,
  onSelectMedia,
  allFiles = [],
  basePath = '',
  filesHost = '',
}: MediaPlayerModalProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const isMediaFile = (fileName: string): 'video' | 'audio' | null => {
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma'];
    const lowerFileName = fileName.toLowerCase();
    if (videoExtensions.some(ext => lowerFileName.endsWith(ext))) return 'video';
    if (audioExtensions.some(ext => lowerFileName.endsWith(ext))) return 'audio';
    return null;
  };

  const computedMediaFiles: MediaFile[] = useMemo(() => {
    if (!allFiles || !filesHost || !basePath) return [];
    return allFiles
      .filter((file: any) => !file.isDirectory && isMediaFile(file.name))
      .map((file: any) => ({
        name: file.name,
        url: `${filesHost}/downloads${file.path.replace(basePath, '')}`,
        type: isMediaFile(file.name) as 'video' | 'audio',
        size: file.size,
      }));
  }, [allFiles, filesHost, basePath]);

  useEffect(() => {
    if (!isOpen && mediaRef.current) {
      mediaRef.current.pause();
      mediaRef.current.currentTime = 0;
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && mediaRef.current) {
      setMediaError(null);
      mediaRef.current.load();
      mediaRef.current.play().catch(() => {
        // Autoplay failed, user interaction needed
      });
    }
  }, [isOpen, fileUrl]);

  const handleEnded = () => {
    if (!computedMediaFiles || computedMediaFiles.length === 0) return;
    const currentIndex = computedMediaFiles.findIndex(file => file.name === fileName);
    if (currentIndex >= 0 && currentIndex < computedMediaFiles.length - 1) {
      const nextFile = computedMediaFiles[currentIndex + 1];
      onSelectMedia?.(nextFile);
    }
  };

  // removed unused audio track detection

  const handleError = () => {
    if (mediaRef.current && mediaRef.current.error) {
      const error = mediaRef.current.error;
      switch (error.code) {
        case error.MEDIA_ERR_ABORTED:
          setMediaError('Playback aborted');
          break;
        case error.MEDIA_ERR_NETWORK:
          setMediaError('Network error occurred');
          break;
        case error.MEDIA_ERR_DECODE:
          setMediaError('Audio/video codec not supported by your browser');
          break;
        case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
          setMediaError('Media format not supported');
          break;
        default:
          setMediaError('Unknown playback error');
      }
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={fileName} maxWidth="custom-1000">
      <div className="flex flex-col gap-6">
        {mediaError && (
          <FileManagerWarning
            type="error"
            message={`${mediaError}. Some media formats may have codec compatibility issues in web browsers. Download the file and use VLC Media Player or another desktop media player.`}
          />
        )}

        {mediaType === 'video' ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={fileUrl}
            controls
            className="w-full max-h-[60vh] bg-black rounded"
            preload="metadata"
            onError={handleError}
            onEnded={handleEnded}
          >
            Your browser does not support the video tag.
          </video>
        ) : (
          <div className="flex flex-col items-center gap-4 p-8 bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg">
            <div className="text-6xl">
              🎵
            </div>
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={fileUrl}
              controls
              className="w-full"
              preload="metadata"
              onError={handleError}
              onEnded={handleEnded}
            >
              Your browser does not support the audio tag.
            </audio>
          </div>
        )}

        {computedMediaFiles.length > 0 && (
          <FilePreviews
            mediaFiles={computedMediaFiles}
            currentFileName={fileName}
            onSelectMedia={onSelectMedia}
          />
        )}
      </div>
    </Modal>
  );
}

