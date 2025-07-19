import { Link, useLocation } from "react-router";
import classNames from "classnames";
import { useState } from "react";

export default function Header() {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const navItems = [
    { to: "/", label: "Status", isActive: location.pathname === "/" },
    { to: "/logs/mirror", label: "Logs", isActive: location.pathname.startsWith("/logs") },
    { to: "/documentation/file-structure", label: "Documentation", isActive: location.pathname.startsWith("/documentation") },
    { to: "/file-manager", label: "File Manager", isActive: location.pathname === "/file-manager" }
  ];

  const navLinkClasses = "text-[16px] hover:border-b-2 hover:border-blue-600 flex h-full items-center justify-center block px-[16px] min-w-[152px] hover:bg-blue-200 hover:text-blue-600 text-center font-semibold";
  const activeLinkClasses = "border-b-2 border-blue-600 text-blue-600 bg-blue-200";

  return (
    <div className="flex size-full bg-gradient-to-r from-blue-400 to-blue-600 border-b border-gray-100 shadow-sm justify-center items-center h-[72px]">
      <div className="container gap-[2px] h-full mx-auto text-white flex flex-row items-center justify-between relative">
        <div className="text-[16px] font-semibold px-[8px]">Apt Mirror Admin Utility</div>
        {/* Desktop Navigation - Hidden on screens below 1024px */}
        <div className="hidden h-full lg:flex flex-row items-center justify-center">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={classNames(navLinkClasses, {
                [activeLinkClasses]: item.isActive
              })}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* Mobile Menu Button - Visible on screens below 1024px */}
        <div className="lg:hidden flex items-center justify-end">
          <button
            onClick={toggleMenu}
            className="text-white hover:text-blue-200 focus:outline-none focus:text-blue-200 p-[8px]"
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
                  "block px-[16px] py-[12px] text-[16px] font-semibold border-b border-gray-100 last:border-b-0",
                  {
                    "text-blue-600 bg-blue-50": item.isActive,
                    "text-gray-700 hover:text-blue-600 hover:bg-blue-50": !item.isActive
                  }
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}