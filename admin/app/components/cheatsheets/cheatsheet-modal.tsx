import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileAlt, faTags } from '@fortawesome/free-solid-svg-icons';
import Modal from '~/components/shared/modal/modal';
import Tag from '~/components/shared/tag/tag';
import ReactMarkdown from 'react-markdown';

interface FileItem {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  categories: string[];
}

interface CheatsheetModalProps {
  file: FileItem;
  isOpen: boolean;
  onClose: () => void;
}

export default function CheatsheetModal({ file, isOpen, onClose }: CheatsheetModalProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && file) {
      loadCheatsheetContent();
    }
  }, [isOpen, file]);

  const loadCheatsheetContent = async () => {
    setLoading(true);
    setError(null);
    
    try {
              const response = await fetch(`/api/cheatsheet/${file.name}`);
      if (!response.ok) {
        throw new Error('Failed to load cheatsheet');
      }
      const text = await response.text();
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cheatsheet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      title={file.name.replace('.md', '')}
      maxWidth="4xl"
    >
      {/* Custom header with file info and categories */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200">
        <FontAwesomeIcon icon={faFileAlt} className="text-gray-600" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faTags} className="text-gray-400 text-xs" />
            <div className="flex flex-wrap gap-1">
              {file.categories.map((category) => (
                <Tag
                  key={category}
                  label={category}
                  size="small"
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl max-h-[calc(90vh-200px)] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">Loading cheatsheet...</span>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-100 text-red-700 rounded-md">
            <p className="font-medium">Error loading cheatsheet</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : (
          <div className="prose max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </Modal>
  );
}
