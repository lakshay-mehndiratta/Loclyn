import { Box } from "lucide-react";
import { FrameworkIcon } from "@/components/Badges";
import type { ServiceState } from "@loclyn/core";

function formatServiceLabel(name: string, framework?: string): string {
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  return framework ? `${capitalized} (${framework})` : capitalized;
}

export function ServiceCell({
  serviceName,
  services,
}: {
  serviceName: string;
  services: Record<string, ServiceState>;
}) {
  const framework = services[serviceName]?.framework;

  return (
    <span className="service-cell">
      {framework ? <FrameworkIcon framework={framework} /> : <Box size={14} color="#7a7f8c" />}
      {formatServiceLabel(serviceName, framework)}
    </span>
  );
}