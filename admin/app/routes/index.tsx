import { redirect, useLoaderData } from 'react-router';
import PublicCheatsheets from './cheatsheets/public-cheatsheets';
import PublicFileManager from './file-manager/public-file-manager';
import { loader as cheatsheetsLoader, meta as cheatsheetsMeta } from './cheatsheets/cheatsheets';
import { loader as fileManagerLoader } from './file-manager/loader';
import { meta as fileManagerMeta } from './file-manager/public-file-manager';

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  
  if (url.hostname.startsWith('cheatsheets')) {
    const data = await cheatsheetsLoader({ request });
    return { ...data, __domain: 'cheatsheets' };
  }
  
  if (url.hostname.startsWith('files')) {
    const data = await fileManagerLoader({ request });
    return { ...data, __domain: 'files' };
  }
  
  throw redirect('/home');
}

export function meta({ data }: { data: any }) {
  if (data?.__domain === 'files') {
    return fileManagerMeta();
  }
  
  return cheatsheetsMeta();
}

export default function Index() {
  const data = useLoaderData<{ __domain: string }>();
  
  if (data?.__domain === 'files') {
    return <PublicFileManager />;
  }
  
  return <PublicCheatsheets />;
}
