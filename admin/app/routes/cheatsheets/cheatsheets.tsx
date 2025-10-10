import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLoaderData, useSubmit, useRevalidator } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileAlt, faTags, faSearch, faEye, faTrash, faSync, faTimes } from '@fortawesome/free-solid-svg-icons';
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
import CheatsheetModal from '~/components/cheatsheets/cheatsheet-modal';
import ConfirmationModal from '~/components/shared/confirmation-modal/confirmation-modal';

interface FileItem {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  categories: string[];
}

export { loader, action };

export function meta() {
  return [
    { title: 'Cheatsheets' },
    { name: 'description', content: 'Developer cheatsheets and reference guides' },
  ];
}

export default function Cheatsheets() {
  const data = useLoaderData<typeof loader>();
  const files = data?.files || [];
  const categories = data?.categories || [];
  const error = data?.error;
  const isPublicRoute = data?.__domain === 'cheatsheets';
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    filename: string | null;
    isLoading: boolean;
  }>({
    isOpen: false,
    filename: null,
    isLoading: false,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filteredFiles = useMemo(() => {
    if (!debouncedSearchTerm && !selectedCategory) {
      return [];
    }

    let filtered = files;

    if (selectedCategory) {
      filtered = filtered.filter((file: FileItem) => file.categories.includes(selectedCategory));
    }

            if (debouncedSearchTerm) {
              const term = debouncedSearchTerm.toLowerCase();
              filtered = filtered.filter((file: FileItem) => 
                file.name.toLowerCase().includes(term) ||
                file.categories.some((cat: string) => cat.toLowerCase().includes(term))
              );
            }

    return filtered.sort((a: FileItem, b: FileItem) => a.name.localeCompare(b.name));
  }, [files, selectedCategory, debouncedSearchTerm]);

  const handleFileClick = (file: FileItem) => {
    setSelectedFile(file);
  };

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(selectedCategory === category ? null : category);
    setHasUserInteracted(true);
  };

  const handleDeleteClick = (filename: string) => {
    setDeleteModal({
      isOpen: true,
      filename,
      isLoading: false,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.filename) return;

    setDeleteModal(prev => ({ ...prev, isLoading: true }));
    
    try {
      await submit(
        { 
          intent: 'deleteCheatsheet',
          filename: deleteModal.filename 
        },
        { action: '/cheatsheets', method: 'post' },
      );
      
      setDeleteModal({
        isOpen: false,
        filename: null,
        isLoading: false,
      });
      
      revalidator.revalidate();
    } catch (error) {
      console.error('Error deleting cheatsheet:', error);
      setDeleteModal(prev => ({ ...prev, isLoading: false }));
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModal({
      isOpen: false,
      filename: null,
      isLoading: false,
    });
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setHasUserInteracted(true);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setSelectedCategory(null);
    setHasUserInteracted(false);
  };

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await submit(
        { intent: 'updateCheatsheets' },
        { action: '/api/cheatsheets/update', method: 'post' },
      );
      revalidator.revalidate();
    } catch (error) {
      console.error('Failed to update cheatsheets:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <PageLayoutFull>
      <div className="flex items-center gap-4 mb-4 px-[12px]">
        <Title title={isPublicRoute ? "Public Cheatsheets" : "Cheatsheets"} />
        {!isPublicRoute && (
          <FormButton
            type="secondary"
            size="small"
            disabled={isUpdating}
            onClick={handleUpdate}
          >
            {isUpdating ? (
              <>
                <FontAwesomeIcon icon={faSync} className="animate-spin" /> Updating...
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faSync} /> Update
              </>
            )}
          </FormButton>
        )}
      </div>

      <ContentBlock>
        <div className="flex flex-col gap-4">
          {error && (
            <div className="p-4 bg-red-100 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="flex-1">
              <FormInput
                placeholder="Search cheatsheets..."
                value={searchTerm}
                onChange={handleSearchChange}
              />
            </div>
            {(debouncedSearchTerm || selectedCategory) && (
              <FormButton
                type="secondary"
                onClick={clearFilters}
              >
                <FontAwesomeIcon icon={faTimes} className="mr-2" />
                Clear Filters
              </FormButton>
            )}
          </div>

          {/* Categories */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
              <FontAwesomeIcon icon={faTags} className="text-gray-500" />
              Categories
            </h3>
            <div className="flex flex-wrap gap-2">
              {categories.map((category: string) => (
                <Tag
                  key={category}
                  label={category}
                  isSelected={selectedCategory === category}
                  onClick={() => handleCategoryClick(category)}
                  variant={selectedCategory === category ? 'selected' : 'default'}
                />
              ))}
            </div>
          </div>

          {/* Results Summary */}
          {(debouncedSearchTerm || selectedCategory) && (
            <div className="text-sm text-gray-600 mb-4">
              {filteredFiles.length} of {files.length} cheatsheets
              {selectedCategory && (
                <span> in <strong>{selectedCategory}</strong></span>
              )}
              {debouncedSearchTerm && (
                <span> matching "<strong>{debouncedSearchTerm}</strong>"</span>
              )}
            </div>
          )}

          {/* Files List */}
          <div className="border border-gray-200 rounded-md">
            {filteredFiles.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <FontAwesomeIcon icon={faFileAlt} className="text-4xl mb-4 text-gray-300" />
                {hasUserInteracted ? (
                  <>
                    <p>No cheatsheets found</p>
                    <p className="text-sm mt-2">Try adjusting your search or filters</p>
                  </>
                ) : (
                  <p>Search command or select category</p>
                )}
              </div>
            ) : (
              <TableWrapper>
                {filteredFiles.map((file: FileItem) => (
                  <TableRow
                    key={file.name}
                    icon={
                      <FontAwesomeIcon
                        icon={faFileAlt}
                        className="text-gray-600"
                      />
                    }
                    title={
                      <div className="flex flex-col">
                        <div className="font-medium text-gray-900">
                          {file.name.replace('.md', '')}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {file.categories.slice(0, 3).map((category: string) => (
                            <Tag
                              key={category}
                              label={category}
                              size="small"
                              onClick={() => handleCategoryClick(category)}
                            />
                          ))}
                          {file.categories.length > 3 && (
                            <Tag
                              label={`+${file.categories.length - 3} more`}
                              size="small"
                            />
                          )}
                        </div>
                      </div>
                    }
                    actions={
                      <div className="flex items-center gap-2">
                        {!isPublicRoute && (
                          <FormButton
                            type="secondary"
                            size="small"
                            onClick={() => handleDeleteClick(file.name)}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </FormButton>
                        )}
                        <FormButton
                          type="secondary"
                          size="small"
                          onClick={() => handleFileClick(file)}
                        >
                          <FontAwesomeIcon icon={faEye} />
                        </FormButton>
                      </div>
                    }
                  />
                ))}
              </TableWrapper>
            )}
          </div>
        </div>
      </ContentBlock>

      {selectedFile && (
        <CheatsheetModal
          file={selectedFile}
          isOpen={!!selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}

      {!isPublicRoute && (
        <ConfirmationModal
          isOpen={deleteModal.isOpen}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          title="Delete Cheatsheet"
          message={`Are you sure you want to delete "${deleteModal.filename}"? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          variant="danger"
          isLoading={deleteModal.isLoading}
        />
      )}
    </PageLayoutFull>
  );
}
