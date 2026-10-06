import { useState, useEffect, useMemo } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileAlt,
  faTags,
  faEye,
  faTimes,
  faBook,
} from '@fortawesome/free-solid-svg-icons';
import Title from '~/components/shared/title/title';
import ContentBlock from '~/components/shared/content-block/content-block';
import PageLayoutFull from '~/components/shared/layout/page-layout-full';
import TableRow from '~/components/shared/table-row/table-row';
import TableWrapper from '~/components/shared/table-wrapper/table-wrapper';
import FormInput from '~/components/shared/form/form-input';
import FormButton from '~/components/shared/form/form-button';
import Tag from '~/components/shared/tag/tag';
import { loader } from './loader';
import { action } from './actions';
import CheatsheetModal, {
  type CheatsheetRef,
} from '~/components/cheatsheets/cheatsheet-modal';
import SourcesPanel from '~/components/cheatsheets/sources-panel';
import type { SearchResult } from '~/routes/api.cheatsheets.search';

export { loader, action };

export function meta() {
  return [
    { title: 'Cheatsheets' },
    {
      name: 'description',
      content: 'Offline cheatsheets and reference guides',
    },
  ];
}

export default function Cheatsheets() {
  const data = useLoaderData<typeof loader>();
  const sources = data?.sources ?? [];
  const isPublic = data?.isPublic ?? true;
  const revalidator = useRevalidator();

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<CheatsheetRef | null>(null);

  const browsable = sources.filter((s) => s.fileCount > 0);
  const totalPages = browsable.reduce((n, s) => n + s.fileCount, 0);
  // With a single source there is nothing to pick, so treat it as selected.
  const activeSource =
    selectedSource ?? (browsable.length === 1 ? browsable[0].id : null);
  const categories = useMemo(
    () => browsable.find((s) => s.id === activeSource)?.categories ?? [],
    [browsable, activeSource],
  );

  // Poll while a download runs so status and page counts update by themselves.
  const downloading = sources.some((s) => s.status === 'downloading');
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [downloading, revalidator]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (!debouncedSearchTerm && !selectedCategory) {
      setResults([]);
      setTotal(0);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (debouncedSearchTerm) params.set('q', debouncedSearchTerm);
    if (activeSource) params.set('source', activeSource);
    if (selectedCategory) params.set('category', selectedCategory);
    setSearching(true);
    setSearchError(null);
    fetch(`/api/cheatsheets/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Search failed');
        const body = (await response.json()) as { total: number; results: SearchResult[] };
        setResults(body.results);
        setTotal(body.total);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [debouncedSearchTerm, activeSource, selectedCategory]);

  const selectSource = (id: string | null) => {
    setSelectedSource(id);
    setSelectedCategory(null);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setSelectedCategory(null);
  };

  const hasQuery = !!(debouncedSearchTerm || selectedCategory);

  return (
    <PageLayoutFull>
      <div className="flex items-center gap-4 px-[12px]">
        <Title title={'Cheatsheets'} />
      </div>

      {!isPublic && (
        <ContentBlock className="flex-none mb-4">
          <h3 className="text-sm font-medium text-on-surface-variant mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faBook} /> Sources
          </h3>
          <SourcesPanel sources={sources} />
        </ContentBlock>
      )}

      <ContentBlock>
        <div className="flex flex-col gap-4">
          {data?.error && (
            <div className="p-4 bg-error/10 text-error rounded-md">{data.error}</div>
          )}

          {browsable.length === 0 ? (
            <div className="p-8 text-center text-on-surface-variant">
              <FontAwesomeIcon
                icon={faFileAlt}
                className="text-4xl mb-4 text-on-surface-variant/40"
              />
              <p>No cheatsheets yet</p>
              {!isPublic && (
                <p className="text-sm mt-2">
                  Add a GitHub repository above to download cheatsheets from it
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <FormInput
                    placeholder="Search cheatsheets..."
                    value={searchTerm}
                    onChange={setSearchTerm}
                  />
                </div>
                {hasQuery && (
                  <FormButton type="secondary" onClick={clearFilters}>
                    <FontAwesomeIcon icon={faTimes} className="mr-2" />
                    Clear Filters
                  </FormButton>
                )}
              </div>

              {browsable.length > 1 && (
                <div>
                  <h3 className="text-sm font-medium text-on-surface-variant mb-2 flex items-center gap-2">
                    <FontAwesomeIcon icon={faBook} />
                    Sources
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <Tag
                      label={`All (${totalPages})`}
                      size="medium"
                      variant={selectedSource === null ? 'selected' : 'default'}
                      onClick={() => selectSource(null)}
                    />
                    {browsable.map((s) => (
                      <Tag
                        key={s.id}
                        label={`${s.name} (${s.fileCount})`}
                        size="medium"
                        variant={selectedSource === s.id ? 'selected' : 'default'}
                        onClick={() => selectSource(selectedSource === s.id ? null : s.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {categories.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-on-surface-variant mb-2 flex items-center gap-2">
                    <FontAwesomeIcon icon={faTags} />
                    Categories
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => (
                      <Tag
                        key={c.name}
                        label={`${c.name} (${c.count})`}
                        variant={selectedCategory === c.name ? 'selected' : 'default'}
                        onClick={() =>
                          setSelectedCategory(selectedCategory === c.name ? null : c.name)
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {hasQuery && !searching && !searchError && (
                <div className="text-sm text-on-surface-variant">
                  {total > results.length
                    ? `Showing ${results.length} of ${total} cheatsheets`
                    : `${total} cheatsheets`}
                  {selectedCategory && (
                    <span>
                      {' '}
                      in <strong>{selectedCategory}</strong>
                    </span>
                  )}
                  {debouncedSearchTerm && (
                    <span>
                      {' '}
                      matching "<strong>{debouncedSearchTerm}</strong>"
                    </span>
                  )}
                </div>
              )}

              {searchError && (
                <div className="p-4 bg-error/10 text-error rounded-md">{searchError}</div>
              )}

              <div className="border border-outline-variant rounded-md">
                {results.length === 0 ? (
                  <div className="p-8 text-center text-on-surface-variant">
                    <FontAwesomeIcon
                      icon={faFileAlt}
                      className="text-4xl mb-4 text-on-surface-variant/40"
                    />
                    {searching ? (
                      <p>Searching…</p>
                    ) : hasQuery ? (
                      <>
                        <p>No cheatsheets found</p>
                        <p className="text-sm mt-2">Try adjusting your search or filters</p>
                      </>
                    ) : (
                      <p>Search all {totalPages} pages or pick a category</p>
                    )}
                  </div>
                ) : (
                  <TableWrapper>
                    {results.map((r) => (
                      <TableRow
                        key={`${r.source}/${r.path}`}
                        onClick={() => setOpenPage(r)}
                        cursorClass="cursor-pointer min-w-0"
                        icon={
                          <FontAwesomeIcon
                            icon={faFileAlt}
                            className="text-on-surface-variant"
                          />
                        }
                        title={
                          <div className="flex flex-col min-w-0">
                            <div className="font-medium text-on-surface">{r.title}</div>
                            {r.snippet && (
                              <div className="text-xs text-on-surface-variant mt-1 line-clamp-2">
                                {r.snippet}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {!activeSource && <Tag label={r.sourceName} size="small" />}
                              {r.categories.slice(0, 3).map((category) => (
                                <Tag key={category} label={category} size="small" />
                              ))}
                            </div>
                          </div>
                        }
                        actions={
                          <FormButton
                            type="secondary"
                            size="small"
                            onClick={() => setOpenPage(r)}
                          >
                            <FontAwesomeIcon icon={faEye} />
                          </FormButton>
                        }
                      />
                    ))}
                  </TableWrapper>
                )}
              </div>
            </>
          )}
        </div>
      </ContentBlock>

      {openPage && (
        <CheatsheetModal
          page={openPage}
          isOpen={!!openPage}
          onClose={() => setOpenPage(null)}
        />
      )}
    </PageLayoutFull>
  );
}
