import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faBook, faTags } from '@fortawesome/free-solid-svg-icons';
import Modal from '~/components/shared/modal/modal';
import Tag from '~/components/shared/tag/tag';
import FormButton from '~/components/shared/form/form-button';
import ReactMarkdown from 'react-markdown';
import { extractTitle, resolvePageLink } from '~/lib/cheatsheets';

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
  page: initialPage,
  isOpen,
  onClose,
}: CheatsheetModalProps) {
  // Pages opened by following links inside the source; the last one is shown.
  const [history, setHistory] = useState<CheatsheetRef[]>([initialPage]);
  const page = history[history.length - 1];
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHistory([initialPage]);
  }, [initialPage]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ source: page.source, path: page.path });
    fetch(`/api/cheatsheets/page?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load cheatsheet');
        const text = await response.text();
        setContent(text);
        // Linked pages only know their file name until loaded.
        if (!page.title) {
          const title = extractTitle(text, page.path);
          setHistory((h) => [...h.slice(0, -1), { ...h[h.length - 1], title }]);
        }
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

  const openLinked = (path: string) => {
    setHistory((h) => [
      ...h,
      { source: page.source, sourceName: page.sourceName, path, title: '', categories: [] },
    ]);
  };

  const fallbackTitle = (page.path.split('/').pop() ?? '').replace(/\.md$/i, '');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={page.title || fallbackTitle}
      maxWidth="4xl"
    >
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-outline-variant">
        {history.length > 1 && (
          <FormButton
            type="secondary"
            size="small"
            onClick={() => setHistory((h) => h.slice(0, -1))}
          >
            <FontAwesomeIcon icon={faArrowLeft} className="mr-1" />
            Back
          </FormButton>
        )}
        <FontAwesomeIcon icon={faBook} className="text-on-surface-variant" />
        <div className="flex-1 flex flex-wrap items-center gap-2">
          <span className="text-sm text-on-surface-variant">{page.sourceName}</span>
          {page.categories.length > 0 && (
            <>
              <FontAwesomeIcon
                icon={faTags}
                className="text-on-surface-variant/60 text-xs"
              />
              <div className="flex flex-wrap gap-1">
                {page.categories.map((category) => (
                  <Tag key={category} label={category} size="small" />
                ))}
              </div>
            </>
          )}
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
            <ReactMarkdown
              components={{
                a: ({ href, children }) => {
                  const target = href ? resolvePageLink(page.path, href) : null;
                  if (target) {
                    return (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          openLinked(target);
                        }}
                      >
                        {children}
                      </a>
                    );
                  }
                  // Web links never replace the app.
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </Modal>
  );
}
