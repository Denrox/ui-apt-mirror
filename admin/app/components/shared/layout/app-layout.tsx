import { Outlet } from "react-router";
import Header from "../header/header";

export default function AppLayout() {
  return (
    <>
      <div className="absolute top-0 left-0 right-0">
        <Header />
      </div>
      <div className="container mx-auto relative">
        <div className="h-[calc(100vh-120px)] overflow-y-auto absolute top-[104px] left-0 right-0 bottom-0">
          <Outlet />
        </div>
      </div>
    </>
  );
}