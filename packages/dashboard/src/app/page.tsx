import { ConnectionPanel } from "@/components/ConnectionPanel";
import { ServicesPanel } from "@/components/ServicesPanel";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { RequestsPanel } from "@/components/RequestsPanel";

export default function OverviewPage() {
  return (
    <div className="overview-grid">
      <ConnectionPanel />
      <ServicesPanel />
      <DiagnosticsPanel />
      <RequestsPanel />
    </div>
  );
}