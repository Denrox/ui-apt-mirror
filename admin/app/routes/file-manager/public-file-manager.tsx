import FileManager from './file-manager';

export { loader } from './file-manager';

export function meta() {
  return [
    { title: 'Files' },
    { name: 'description', content: 'Public file browser and downloads' },
  ];
}

export default function PublicFileManager() {
  return (
    <div className="container mx-auto px-4 pt-8">
      <FileManager />
    </div>
  );
}
