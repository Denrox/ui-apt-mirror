import { redirect } from 'react-router';
import PublicCheatsheets from './cheatsheets/public-cheatsheets';
import { loader as cheatsheetsLoader, meta as cheatsheetsMeta } from './cheatsheets/cheatsheets';

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  
  if (url.hostname.startsWith('cheatsheets')) {
    return await cheatsheetsLoader({ request });
  }
  
  throw redirect('/home');
}

export { cheatsheetsMeta as meta };

export default function Index() {
  return <PublicCheatsheets />;
}
