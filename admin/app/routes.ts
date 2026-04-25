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
  ]),
  route('api/cheatsheet/:filename', 'routes/api.cheatsheet.$filename.tsx'),
  route('api/cheatsheets/update', 'routes/api.cheatsheets.update.tsx'),
  route('api/download-private', 'routes/api.download-private.tsx'),
  route('npm/*', 'routes/npm/npm.tsx'),
] satisfies RouteConfig;
