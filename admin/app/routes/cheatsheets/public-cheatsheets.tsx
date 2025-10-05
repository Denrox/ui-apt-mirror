import Cheatsheets from './cheatsheets';

export { loader } from './cheatsheets';

export function meta() {
  return [
    { title: 'Cheatsheets' },
    { name: 'description', content: 'Public developer cheatsheets and command references' },
  ];
}

export default function PublicCheatsheets() {
  return (
    <div className="container mx-auto px-4 pt-8">
      <Cheatsheets />
    </div>
  );
}
