// SDK-backed source: otter-importer holding NO Otter cookie of its own.
// It connects to an OAuth3 instance (the user approves the app there), gets a
// scoped token, and reads notes/transcripts through the instance. Drop-in for
// OtterClient — same user()/listAllSpeeches()/exportTxt() surface the CLI uses.

import { oauth3, type Oauth3Client } from "oauth3-sdk";
import type { OtterSpeech } from "./otter.ts";

export interface OtterSource {
  user(): Promise<Record<string, unknown>>;
  listAllSpeeches(): Promise<OtterSpeech[]>;
  exportTxt(otid: string): Promise<string>;
}

export class OtterViaOauth3 implements OtterSource {
  private readonly oa: Oauth3Client;
  private connected = false;

  constructor(node: string, private readonly opts: { token?: string; subject?: string } = {}) {
    this.oa = oauth3({ node, token: opts.token });
  }

  // Ensure a scoped token: use a provided one, else run the connect handshake.
  private async ensure(): Promise<void> {
    if (this.oa.currentToken || this.connected) return;
    await this.oa.connect({
      plugin: "otter",
      app: "otter-importer",
      subject: this.opts.subject,
      onApproveUrl: (u) => console.log(`\n  approve otter-importer on your OAuth3 instance:\n  ${u}\n`),
    });
    this.connected = true;
  }

  async user(): Promise<Record<string, unknown>> {
    await this.ensure();
    return { via: "oauth3", note: "scoped token; no Otter cookie held by this app" };
  }

  async listAllSpeeches(): Promise<OtterSpeech[]> {
    await this.ensure();
    const items = await this.oa.plugin("otter").list();
    return items.map((it): OtterSpeech => ({
      otid: it.id,
      title: it.title,
      start_time: it.date ? Math.floor(Date.parse(it.date) / 1000) : null,
      hasPhotos: (it.meta?.hasPhotos as number) ?? null,
      live_status: (it.meta?.live as string) ?? null,
    }));
  }

  async exportTxt(otid: string): Promise<string> {
    await this.ensure();
    const r = await this.oa.plugin("otter").fetch(otid) as { transcript?: string };
    if (typeof r?.transcript !== "string") throw new Error(`otter fetch ${otid}: no transcript`);
    return r.transcript;
  }
}
