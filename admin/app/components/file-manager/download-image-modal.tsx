import { useState } from 'react';
import { useSubmit } from 'react-router';
import FormButton from '~/components/shared/form/form-button';
import FormInput from '~/components/shared/form/form-input';
import Modal from '~/components/shared/modal/modal';
import FormSelect from '~/components/shared/form/form-select';

interface DownloadImageModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly currentPath: string;
}

export default function DownloadImageModal({
  isOpen,
  onClose,
  currentPath,
}: DownloadImageModalProps) {
  const [imageUrl, setImageUrl] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [architecture, setArchitecture] = useState('amd64');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = useSubmit();

  const architectureOptions = [
    { value: 'amd64', label: 'AMD64 (x86_64)' },
    { value: 'arm64', label: 'ARM64 (aarch64)' },
  ];

  const handleSubmit = async () => {
    if (!imageUrl.trim()) return;

    setIsSubmitting(true);

    try {
      await submit(
        {
          intent: 'downloadImage',
          imageUrl: imageUrl.trim(),
          imageTag: imageTag.trim() || 'latest',
          architecture: architecture,
          currentPath: currentPath,
        },
        { action: '', method: 'post' },
      );

      setImageUrl('');
      setImageTag('latest');
      setArchitecture('amd64');

      onClose();
    } catch (error) {
      console.error('Failed to download image:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setImageUrl('');
    setImageTag('latest');
    setArchitecture('amd64');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Download Container Image"
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="image-url"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Image URL
          </label>
          <FormInput
            id="image-url"
            value={imageUrl}
            onChange={setImageUrl}
            placeholder="e.g., nginx, repo/image, docker.io/repo/image, gcr.io/project/image"
          />
          <p className="text-xs text-gray-500 mt-1">
            Supports Docker Hub and Google Container Registry (GCR). Single
            words (e.g., "nginx") will use docker.io/library/. Uses skopeo for
            downloading images.
          </p>
        </div>

        <div>
          <label
            htmlFor="image-tag"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Tag
          </label>
          <FormInput
            id="image-tag"
            value={imageTag}
            onChange={setImageTag}
            placeholder="latest"
          />
        </div>

        <FormSelect
          id="architecture-select"
          label="Architecture"
          value={architecture}
          onChange={setArchitecture}
          options={architectureOptions}
        />

        <div className="flex justify-end gap-2 pt-4">
          <FormButton
            type="secondary"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </FormButton>
          <FormButton
            onClick={handleSubmit}
            disabled={!imageUrl.trim() || isSubmitting}
          >
            {isSubmitting ? 'Downloading...' : 'Download'}
          </FormButton>
        </div>
      </div>
    </Modal>
  );
}
