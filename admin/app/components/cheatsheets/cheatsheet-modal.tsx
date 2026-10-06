import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBook, faTags } from '@fortawesome/free-solid-svg-icons';
import Modal from '~/components/shared/modal/modal';
import Tag from '~/components/shared/tag/tag';
import ReactMarkdown from 'react-markdown';

export interface CheatsheetRef {
  source: string;
  sourceName: string;
  path: string;
  title: string;
  categories: string[];
}

interface CheatsheetModalProps {
  page: CheatsheetRef;
  isOpen: boolean;
  onClose: () => void;
}

export default function CheatsheetModal({
  page,
  isOpen,
  onClose,
}: CheatsheetModalProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ source: page.source, path: page.path });
    fetch(`/api/cheatsheets/page?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load cheatsheet');
        setContent(await response.text());
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load cheatsheet');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [isOpen, page.source, page.path]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={page.title} maxWidth="4xl">
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-outline-variant">
        <FontAwesomeIcon icon={faBook} className="text-on-surface-variant" />
        <div className="flex-1 flex flex-wrap items-center gap-2">
          <span className="text-sm text-on-surface-variant">{page.sourceName}</span>
          <FontAwesomeIcon
            icon={faTags}
            className="text-on-surface-variant/60 text-xs"
          />
          <div className="flex flex-wrap gap-1">
            {page.categories.map((category) => (
              <Tag key={category} label={category} size="small" />
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl max-h-[calc(90vh-200px)] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-on-surface-variant">
              Loading cheatsheet...
            </span>
          </div>
        ) : error ? (
          <div className="p-4 bg-error/10 text-error rounded-md">
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
