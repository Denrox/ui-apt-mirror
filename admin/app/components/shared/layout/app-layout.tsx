import { Outlet } from 'react-router';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import MobileTopBar from './mobile-top-bar';
import BottomTabBar from './bottom-tab-bar';

/**
 * App shell: a fixed desktop sidebar + top bar, or a mobile top app bar +
 * bottom tab bar. The content area is the single scroll container, with the
 * sidebar/bars as flex siblings so nothing overlaps the content.
 */
export default function AppLayout() {
  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-background text-on-surface">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MobileTopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-gutter">
            <Outlet />
          </div>
        </main>
        <BottomTabBar />
      </div>
    </div>
  );
}
