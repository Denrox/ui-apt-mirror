import { Link } from "react-router";
import classNames from "classnames";

interface NavLinkProps {
  to: string;
  isActive: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}

export default function NavLink({ to, isActive, children, onClick }: NavLinkProps) {
  return (
    <Link 
      to={to}
      className={classNames(
        "text-[16px] block leading-[48px] min-h-[48px] flex-0 bg-blue-200 border-white hover:border-blue-600 px-[16px] w-[200px] hover:text-blue-600 text-center font-semibold cursor-pointer lg:mb-0", 
        {
          "border-blue-600 text-blue-600": isActive
        }
      )}
      onClick={onClick}
    >
      {children}
    </Link>
  );
} 