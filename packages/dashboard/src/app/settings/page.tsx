"use client";

import { useLoclynData } from "@/lib/LoclynDataContext";
import type { ServicesSource, ValueSource } from "@loclyn/core";

const VALUE_SOURCE_LABEL: Record<ValueSource, string> = {
  flag: "command-line flag",
  "config-file": ".loclyn.json",
  default: "default",
};

const SERVICES_SOURCE_LABEL: Record<ServicesSource, string> = {
  flags: "command-line flags (--frontend / --backend)",
  "config-file": ".loclyn.json",
  detection: "auto-detection from package.json",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">{label}</div>
      <div className="settings-value">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings } = useLoclynData();

  if (!settings) {
    return (
      <section className="panel">
        <h2>Settings</h2>
        <p className="empty-state">Waiting for Loclyn to report its settings…</p>
      </section>
    );
  }

  return (
    <div>
      <section className="panel">
        <h2>Ports</h2>
        <Row label="Proxy port">
          <span className="mono">{settings.proxyPort}</span>
          <span className="source-chip">{VALUE_SOURCE_LABEL[settings.proxyPortSource]}</span>
        </Row>
        <Row label="Dashboard data server port">
          <span className="mono">{settings.dashboardPort}</span>
          <span className="source-chip">{VALUE_SOURCE_LABEL[settings.dashboardPortSource]}</span>
        </Row>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Configuration</h2>
        <Row label="Services came from">{SERVICES_SOURCE_LABEL[settings.servicesSource]}</Row>
        <Row label="Config file">
          {settings.configFile ? (
            <span className="mono">{settings.configFile}</span>
          ) : (
            <span className="dim">none found in the working directory</span>
          )}
        </Row>
        <Row label="Working directory">
          <span className="mono">{settings.workingDirectory}</span>
        </Row>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Environment</h2>
        <Row label="Started">{new Date(settings.startedAt).toLocaleString()}</Row>
        <Row label="Node.js">
          <span className="mono">{settings.nodeVersion}</span>
        </Row>
        <Row label="Platform">
          <span className="mono">{settings.platform}</span>
        </Row>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Changing these settings</h2>
        <p className="about-text">
          These values are read-only: Loclyn is configured when it starts, so changing one means
          editing your <span className="mono">.loclyn.json</span> or flags and restarting. A
          command-line flag overrides the config file, and the config file overrides the defaults.
        </p>
      </section>
    </div>
  );
}