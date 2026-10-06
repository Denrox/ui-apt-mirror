import {
  type RouteConfig,
  index,
  route,
  layout,
} from '@react-router/dev/routes';

export default [
  index('routes/index.tsx'),
  route('login', 'routes/login/login.tsx'),
  route('logout', 'routes/logout.tsx'),
  layout('components/shared/layout/app-layout.tsx', [
    route('home', 'routes/home/home.tsx'),
    route('logs', 'routes/logs/logs.tsx'),
    route('documentation/:section', 'routes/documentation/documentation.tsx'),
    route('file-manager', 'routes/file-manager/file-manager.tsx'),
    route('cheatsheets', 'routes/cheatsheets/cheatsheets.tsx'),
    route('users', 'routes/users/users.tsx'),
    route('api/resources', 'routes/api.resources.tsx'),
    route('api/resolve-deps', 'routes/api.resolve-deps.tsx'),
  ]),
  route('api/cheatsheets/search', 'routes/api.cheatsheets.search.tsx'),
  route('api/cheatsheets/page', 'routes/api.cheatsheets.page.tsx'),
  route('api/download-private', 'routes/api.download-private.tsx'),
  route('api/pubkey/:host', 'routes/api.pubkey.$host.tsx'),
  route('npm/*', 'routes/npm/npm.tsx'),
] satisfies RouteConfig;
