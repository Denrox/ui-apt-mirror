import { useEffect, useRef } from 'react';
import Modal from '~/components/shared/modal/modal';

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
  mediaFiles?: MediaFile[];
  onSelectMedia?: (file: MediaFile) => void;
}

export default function MediaPlayerModal({
  isOpen,
  onClose,
  fileUrl,
  fileName,
  mediaType,
  mediaFiles = [],
  onSelectMedia,
}: MediaPlayerModalProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  useEffect(() => {
    if (!isOpen && mediaRef.current) {
      mediaRef.current.pause();
      mediaRef.current.currentTime = 0;
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && mediaRef.current) {
      mediaRef.current.load();
      mediaRef.current.play().catch(() => {
        // Autoplay failed, user interaction needed
      });
    }
  }, [isOpen, fileUrl]);

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={fileName} maxWidth="custom-1000">
      <div className="flex flex-col gap-6">
        {mediaType === 'video' ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={fileUrl}
            controls
            className="w-full max-h-[60vh] bg-black rounded"
            preload="metadata"
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
            >
              Your browser does not support the audio tag.
            </audio>
          </div>
        )}

        {mediaFiles.length > 0 && (
          <div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {mediaFiles.map((file, index) => (
                <button
                  key={index}
                  onClick={() => onSelectMedia?.(file)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:shadow-md flex-shrink-0 w-[140px] ${
                    file.name === fileName
                      ? 'border-gray-500 bg-gray-200'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                  }`}
                >
                  <div className="text-xs font-medium text-gray-700 text-center break-words w-full line-clamp-2">
                    {file.name}
                  </div>
                  {file.size && (
                    <div className="text-xs text-gray-500">
                      {formatFileSize(file.size)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

