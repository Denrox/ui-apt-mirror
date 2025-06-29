import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  layout(
    "components/shared/layout/app-layout.tsx",
    [
      index("routes/home.tsx"),
      route("logs/:log", "routes/logs.tsx"),
      route("documentation/:section", "routes/documentation.tsx"),
      route("file-manager", "routes/file-manager.tsx")
    ]
  ),
] satisfies RouteConfig;
