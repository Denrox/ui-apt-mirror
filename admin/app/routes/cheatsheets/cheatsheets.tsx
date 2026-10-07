import { useState, useEffect, useMemo, useRef } from 'react';
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useRevalidator,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileAlt,
  faTags,
  faEye,
  faTimes,
  faBook,
  faChevronDown,
  faChevronUp,
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
import { fetchSearch } from '~/lib/search-fetch';
import { onlySheetChanged, parseSheetParam, plural, sheetSearch, SHEET_PARAM } from '~/lib/cheatsheets';
import { useHydrated } from '~/utils/use-hydrated';

export { loader, action };

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return !formMethod && onlySheetChanged(currentUrl, nextUrl) ? false : defaultShouldRevalidate;
}

// History state of a popup entry: the page as the results list knew it, and
// how many popup entries this one is deep.
interface SheetState {
  sheet?: CheatsheetRef;
  depth?: number;
  fromLink?: boolean;
}

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(sources.length === 0);
  const [urlParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // The browser keeps history state across a reload, but the server never
  // sees it: read it only once hydrated, or the popup renders differently (#418).
  const hydrated = useHydrated();
  const sheetState = ((hydrated && location.state) || {}) as SheetState;
  const depth = sheetState.depth ?? 0;
  const sheet = parseSheetParam(urlParams.get(SHEET_PARAM));
  const openPage: CheatsheetRef | null = !sheet
    ? null
    : sheetState.sheet?.source === sheet.source && sheetState.sheet.path === sheet.path
      ? sheetState.sheet
      : {
          ...sheet,
          sourceName: sources.find((s) => s.id === sheet.source)?.name ?? '',
          title: '',
          categories: [],
        };

  const showPage = (page: CheatsheetRef) => {
    navigate(
      { search: sheetSearch(urlParams, page) },
      {
        state: {
          sheet: page,
          depth: depth + 1,
          fromLink: depth === 0 ? !!sheet : sheetState.fromLink,
        } satisfies SheetState,
        preventScrollReset: true,
      },
    );
  };

  // Back to the entry before the popup; a page opened from a shared link has none.
  const closePage = () => {
    if (depth > 0 && !sheetState.fromLink) {
      navigate(-depth);
      return;
    }
    navigate({ search: sheetSearch(urlParams, null) }, { replace: true, preventScrollReset: true });
  };

  const browsable = sources.filter((s) => s.fileCount > 0);
  const totalPages = browsable.reduce((n, s) => n + s.fileCount, 0);
  const activeSource =
    selectedSource ?? (browsable.length === 1 ? browsable[0].id : null);
  const categories = useMemo(
    () => browsable.find((s) => s.id === activeSource)?.categories ?? [],
    [browsable, activeSource],
  );

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

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearchTerm) params.set('q', debouncedSearchTerm);
    if (activeSource) params.set('source', activeSource);
    if (selectedCategory) params.set('category', selectedCategory);
    return params.toString();
  }, [debouncedSearchTerm, activeSource, selectedCategory]);
  // Bumped per new search so "Show more" responses for an older one are dropped.
  const searchGenRef = useRef(0);

  useEffect(() => {
    searchGenRef.current++;
    setLoadingMore(false);
    if (!debouncedSearchTerm && !selectedCategory) {
      setResults([]);
      setTotal(0);
      return;
    }
    const controller = new AbortController();
    const params = searchParams;
    setSearching(true);
    setSearchError(null);
    fetchSearch(`/api/cheatsheets/search?${params}`, controller.signal)
      .then((body) => {
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
  }, [searchParams]);

  const loadMore = () => {
    const gen = searchGenRef.current;
    setLoadingMore(true);
    fetchSearch(`/api/cheatsheets/search?${searchParams}&offset=${results.length}`)
      .then((body) => {
        if (searchGenRef.current !== gen) return;
        setResults((prev) => [...prev, ...body.results]);
        setTotal(body.total);
      })
      .catch((err) => {
        if (searchGenRef.current !== gen) return;
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      })
      .finally(() => {
        if (searchGenRef.current === gen) setLoadingMore(false);
      });
  };

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
          {/* Collapsed on phones, where it would push the search box screens down. */}
          <button
            type="button"
            className="w-full text-left text-sm font-medium text-on-surface-variant flex items-center gap-2 md:pointer-events-none"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            <FontAwesomeIcon icon={faBook} /> Sources ({sources.length})
            <FontAwesomeIcon
              icon={sourcesOpen ? faChevronUp : faChevronDown}
              className="ml-auto md:hidden"
            />
          </button>
          <div className={`mt-3 ${sourcesOpen ? '' : 'hidden md:block'}`}>
            <SourcesPanel sources={sources} />
          </div>
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
                      label="All"
                      count={totalPages}
                      size="medium"
                      variant={selectedSource === null ? 'selected' : 'default'}
                      onClick={() => selectSource(null)}
                    />
                    {browsable.map((s) => (
                      <Tag
                        key={s.id}
                        label={s.name}
                        count={s.fileCount}
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
                        label={c.name}
                        count={c.count}
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
                    ? `Showing ${results.length} of ${plural(total, 'cheatsheet')}`
                    : plural(total, 'cheatsheet')}
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
                      <p>
                        Search all {plural(totalPages, 'page')}
                        {categories.length > 0
                          ? ' or pick a category'
                          : browsable.length > 1
                            ? ' or pick a source to see its categories'
                            : ''}
                      </p>
                    )}
                  </div>
                ) : (
                  <TableWrapper>
                    {results.map((r) => (
                      <TableRow
                        key={`${r.source}/${r.path}`}
                        onClick={() => showPage(r)}
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
                            onClick={() => showPage(r)}
                            ariaLabel={`Open ${r.title}`}
                          >
                            <FontAwesomeIcon icon={faEye} />
                          </FormButton>
                        }
                      />
                    ))}
                  </TableWrapper>
                )}
              </div>

              {!searching && results.length > 0 && results.length < total && (
                <div className="flex justify-center">
                  <FormButton type="secondary" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : `Show more (${total - results.length} left)`}
                  </FormButton>
                </div>
              )}
            </>
          )}
        </div>
      </ContentBlock>

      {openPage && (
        <CheatsheetModal
          page={openPage}
          onClose={closePage}
          onOpenLinked={showPage}
          // The entry before is a popup page too: depth 1 is the first page from
          // the results, but from a shared link it is the page after that link.
          onBack={depth > (sheetState.fromLink ? 0 : 1) ? () => navigate(-1) : undefined}
        />
      )}
    </PageLayoutFull>
  );
}
