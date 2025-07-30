import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  layout(
    "components/shared/layout/app-layout.tsx",
    [
      index("routes/home/home.tsx"),
      route("logs/:log", "routes/logs/logs.tsx"),
      route("documentation/:section", "routes/documentation/documentation.tsx"),
      route("file-manager", "routes/file-manager/file-manager.tsx"),
      route("api/resources", "routes/api.resources.tsx")
    ]
  ),
] satisfies RouteConfig;
