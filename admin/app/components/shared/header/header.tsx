import { Link, useLocation, useSubmit } from 'react-router';
import classNames from 'classnames';
import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSignOutAlt, faUser } from '@fortawesome/free-solid-svg-icons';

export default function Header() {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const submit = useSubmit();

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const handleLogout = () => {
    submit(null, { action: '/logout', method: 'post' });
  };

  const navItems = [
    { to: '/', label: 'Status', isActive: location.pathname === '/' },
    {
      to: '/logs/mirror',
      label: 'Logs',
      isActive: location.pathname.startsWith('/logs'),
    },
    {
      to: '/documentation/file-structure',
      label: 'Documentation',
      isActive: location.pathname.startsWith('/documentation'),
    },
    {
      to: '/file-manager',
      label: 'File Manager',
      isActive: location.pathname === '/file-manager',
    },
    {
      to: '/users',
      label: 'Settings',
      isActive: location.pathname === '/users',
    },
  ];

  const navLinkClasses =
    'text-[16px] hover:border-b-2 hover:border-gray-300 flex h-full items-center justify-center block px-[16px] hover:bg-gray-200 hover:text-gray-800 text-center font-semibold';
  const navLinkClassesWithMinWidth =
    'text-[16px] hover:border-b-2 hover:border-gray-300 flex h-full items-center justify-center block px-[16px] min-w-[152px] hover:bg-gray-200 hover:text-gray-800 text-center font-semibold';
  const activeLinkClasses =
    'border-b-2 border-gray-300 text-gray-800 bg-gray-200';

  return (
    <div className="flex size-full bg-gradient-to-r from-gray-600 to-gray-700 border-b border-gray-300 shadow-sm justify-center items-center h-[72px]">
      <div className="container gap-[2px] h-full mx-auto text-white flex flex-row items-center justify-between relative">
        <div className="text-[16px] font-semibold px-[8px]">
          Apt Mirror Admin Utility
        </div>
        {/* Desktop Navigation - Hidden on screens below 1024px */}
        <div className="hidden h-full lg:flex flex-row items-center justify-center">
          {navItems.map((item) => {
            // Show icon for users/settings, text for others
            const isUserSettings = item.to === '/users';

            return (
              <Link
                key={item.to}
                to={item.to}
                className={classNames(
                  isUserSettings ? navLinkClasses : navLinkClassesWithMinWidth,
                  {
                    [activeLinkClasses]: item.isActive,
                  },
                )}
                title={item.label}
              >
                {isUserSettings ? (
                  <FontAwesomeIcon icon={faUser} className="text-[18px]" />
                ) : (
                  item.label
                )}
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="text-[16px] hover:border-b-2 hover:border-gray-300 flex h-full items-center justify-center block px-[16px] hover:bg-gray-200 hover:text-gray-800 text-center font-semibold cursor-pointer"
            title="Logout"
          >
            <FontAwesomeIcon icon={faSignOutAlt} className="text-[18px]" />
          </button>
        </div>

        {/* Mobile Menu Button - Visible on screens below 1024px */}
        <div className="lg:hidden flex items-center justify-end">
          <button
            onClick={toggleMenu}
            className="text-white hover:text-gray-200 focus:outline-none focus:text-gray-200 p-[8px]"
            aria-label="Toggle menu"
          >
            <svg
              className="w-[24px] h-[24px]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {isMenuOpen && (
          <div className="lg:hidden absolute top-full left-0 right-0 bg-white shadow-lg border border-gray-200 z-50">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={closeMenu}
                className={classNames(
                  'block px-[16px] py-[12px] text-[16px] font-semibold border-b border-gray-100',
                  {
                    'text-gray-800 bg-gray-200': item.isActive,
                    'text-gray-700 hover:text-gray-800 hover:bg-gray-100':
                      !item.isActive,
                  },
                )}
              >
                {item.label}
              </Link>
            ))}
            <button
              onClick={() => {
                closeMenu();
                handleLogout();
              }}
              className="block px-[16px] py-[12px] text-[16px] font-semibold text-gray-700 hover:text-gray-800 hover:bg-gray-100 w-full text-left cursor-pointer"
            >
              <FontAwesomeIcon icon={faSignOutAlt} className="mr-2" />
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
