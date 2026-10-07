import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCodeBranch,
  faExclamationTriangle,
  faPlus,
  faSync,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import FormInput from '~/components/shared/form/form-input';
import FormButton from '~/components/shared/form/form-button';
import FormField from '~/components/shared/form/form-field';
import TableRow from '~/components/shared/table-row/table-row';
import TableWrapper from '~/components/shared/table-wrapper/table-wrapper';
import ConfirmationModal from '~/components/shared/confirmation-modal/confirmation-modal';
import type { SourceView } from '~/routes/cheatsheets/loader';
import { formatDateTime, useHydrated } from '~/utils/use-hydrated';

type ActionResult = { success: boolean; intent: string; message?: string; error?: string };

export default function SourcesPanel({ sources }: { sources: SourceView[] }) {
  const fetcher = useFetcher<ActionResult>();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [toRemove, setToRemove] = useState<SourceView | null>(null);
  const busy = fetcher.state !== 'idle';
  const result = fetcher.data;
  const hydrated = useHydrated();

  useEffect(() => {
    if (fetcher.state === 'idle' && result?.success && result.intent === 'addSource') {
      setUrl('');
      setName('');
    }
    if (fetcher.state === 'idle' && result?.intent === 'removeSource') {
      setToRemove(null);
    }
  }, [fetcher.state, result]);

  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: 'post', action: '/cheatsheets' });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-end">
        <div className="flex-[2]">
          <FormField label="GitHub URL">
            <FormInput
              value={url}
              onChange={setUrl}
              placeholder="https://github.com/tldr-pages/tldr/tree/main/pages"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim()) submit({ intent: 'addSource', url, name });
              }}
            />
          </FormField>
        </div>
        <div className="flex-1">
          <FormField label="Name (optional)">
            <FormInput value={name} onChange={setName} placeholder="e.g. Linux commands" />
          </FormField>
        </div>
        <FormButton
          disabled={busy || !url.trim()}
          onClick={() => submit({ intent: 'addSource', url, name })}
        >
          <FontAwesomeIcon icon={faPlus} className="mr-2" />
          Add source
        </FormButton>
      </div>
      <p className="text-xs text-on-surface-variant">
        Paste a public repository URL, or a folder URL to import only part of it. Every
        <code className="mx-1">.md</code> file in that location becomes a cheatsheet. Sub-folders
        become categories unless the folder has a <code className="mx-1">categories.json</code>.
        Downloading needs internet access; afterwards everything works offline.
      </p>

      {result && !result.success && result.error && (
        <div className="p-3 bg-error/10 text-error rounded-md text-sm">{result.error}</div>
      )}
      {result?.success && result.message && (
        <div className="p-3 bg-primary/10 text-primary rounded-md text-sm">{result.message}</div>
      )}

      {sources.length > 0 && (
        <div className="border border-outline-variant rounded-md">
          <TableWrapper>
            {sources.map((s) => (
              <TableRow
                key={s.id}
                icon={
                  <FontAwesomeIcon
                    icon={s.status === 'error' ? faExclamationTriangle : faCodeBranch}
                    className={s.status === 'error' ? 'text-error' : 'text-on-surface-variant'}
                  />
                }
                title={
                  <div className="flex flex-col min-w-0">
                    {/* Isolated (bdi, dir="ltr") so a name, URL or date in another
                        direction can't reorder the rest of the line; the name, URL
                        and error are clipped so stacked accents can't draw over the
                        rows above. */}
                    <div className="font-medium text-on-surface break-words overflow-hidden">
                      <bdi>{s.name}</bdi>
                    </div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                      className="text-xs text-primary break-all text-left overflow-hidden"
                    >
                      {s.url}
                    </a>
                    <div className="text-xs text-on-surface-variant mt-1">
                      {s.status === 'downloading' ? (
                        <span>
                          <FontAwesomeIcon icon={faSync} className="animate-spin mr-1" />
                          Downloading…
                        </span>
                      ) : (
                        <span>
                          {s.fileCount} pages · updated{' '}
                          <bdi>{s.updatedAt ? formatDateTime(s.updatedAt, hydrated) : 'never'}</bdi>
                          {s.revision && (
                            <>
                              {' · '}
                              <bdi dir="ltr">{s.revision}</bdi>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    {s.status === 'error' && s.error && (
                      <div className="text-xs text-error mt-1 break-words overflow-hidden">
                        <bdi>{s.error}</bdi>
                        {s.fileCount > 0 ? ' (previous copy is still available)' : ''}
                      </div>
                    )}
                  </div>
                }
                actions={
                  <div className="flex items-center gap-2">
                    <FormButton
                      type="secondary"
                      size="small"
                      disabled={busy || s.status === 'downloading'}
                      onClick={() => submit({ intent: 'refreshSource', id: s.id })}
                    >
                      <FontAwesomeIcon icon={faSync} /> Update
                    </FormButton>
                    <FormButton
                      type="secondary"
                      size="small"
                      disabled={busy || s.status === 'downloading'}
                      onClick={() => setToRemove(s)}
                      ariaLabel={`Remove ${s.name}`}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </FormButton>
                  </div>
                }
              />
            ))}
          </TableWrapper>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && submit({ intent: 'removeSource', id: toRemove.id })}
        title="Remove source"
        message={`Remove "${toRemove?.name}" and its ${toRemove?.fileCount ?? 0} downloaded pages?`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
        isLoading={busy}
      />
    </div>
  );
}
