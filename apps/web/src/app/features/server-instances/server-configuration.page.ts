import { Component, computed, inject, signal } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { AlertController, LoadingController } from '@ionic/angular/standalone';
import type { ServerDashboardCard } from '@palwarden/shared';
import { filter, firstValueFrom, Subscription } from 'rxjs';
import type { ServerConfigEntry } from './server-instances.service';
import { ServerInstancesService } from './server-instances.service';
import { selectServerFromRoute } from './selected-server';

type ConfigValue = string | number | boolean;
const MASKED_SECRET_VALUE = 'configured';

const GROUP_ORDER = [
  'Identity and Access',
  'World Rules',
  'Combat',
  'Progression',
  'Time and Survival',
  'World Density',
  'Bases and Work',
  'Saving and Backups',
  'Performance Limits',
  'Mods and Compatibility',
  'Local API',
  'Other',
];

@Component({
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    @if (server(); as item) {
      <section class="world-settings-page">
        <article class="world-settings-panel">
          <div class="panel-header">
            <div>
              <h2>Popular Settings</h2>
              <p class="muted">Frequently adjusted server rules from {{ item.displayName }}'s PalWorldSettings.ini.</p>
            </div>
            <button type="button" class="secondary-button" (click)="reload()">Reload file</button>
          </div>
          <ng-container *ngTemplateOutlet="fieldGroups; context: { groups: popularGroups() }" />
        </article>

        <article class="world-settings-panel">
          <div class="panel-header">
            <div>
              <h2>Advanced Settings</h2>
              <p class="muted">Remaining settings read directly from this server's current config file.</p>
            </div>
            <button type="button" class="secondary-button" (click)="showAdvanced.update(toggle)">
              {{ showAdvanced() ? 'Hide' : 'Show All (' + advancedEntries().length + ')' }}
            </button>
          </div>
          @if (showAdvanced()) {
            <ng-container *ngTemplateOutlet="fieldGroups; context: { groups: advancedGroups() }" />
          } @else {
            <p class="muted">{{ advancedEntries().length }} more settings are available from PalWorldSettings.ini.</p>
          }
        </article>
      </section>

      <footer class="config-savebar">
        <span [class.error-text]="message()">
          {{ message() || (dirtyCount() ? dirtyCount() + ' unsaved change(s), applies next server start.' : 'All changes saved.') }}
        </span>
        <button type="button" [disabled]="!dirtyCount() || saving()" (click)="save()">
          {{ saving() ? 'Saving...' : 'Save Changes' }}
        </button>
      </footer>
    } @else {
      <section class="empty-state">Add a server before editing configuration.</section>
    }

    <ng-template #fieldGroups let-groups="groups">
      <div class="world-group-stack">
        @for (group of groups; track group.name) {
          <section class="world-setting-group">
            <h3>{{ group.name }}</h3>
            <div class="world-field-grid">
              @for (entry of group.entries; track entry.key) {
                <label class="world-field" [class.toggle-field]="entry.type === 'bool'">
                  <span class="field-title">
                    <span>{{ entry.label }}</span>
                    <button type="button" class="field-help" [title]="entry.help">i</button>
                  </span>

                  @if (entry.type === 'bool') {
                    <button
                      type="button"
                      class="config-toggle"
                      [class.enabled]="valueFor(entry) === true"
                      [class.disabled]="valueFor(entry) !== true"
                      (click)="toggleBoolean(entry)"
                    >
                      {{ valueFor(entry) === true ? 'Enabled' : 'Disabled' }}
                    </button>
                  } @else if (entry.options?.length) {
                    <select [value]="valueFor(entry)" (change)="setValue(entry, $event)">
                      @if (!optionExists(entry)) {
                        <option [value]="valueFor(entry)" [selected]="true">{{ valueFor(entry) }} (current)</option>
                      }
                      @for (option of entry.options; track option.value) {
                        <option [value]="option.value" [selected]="isSelectedOption(entry, option.value)">{{ option.label }}</option>
                      }
                    </select>
                  } @else {
                    <input
                      [type]="entry.type === 'int' || entry.type === 'float' ? 'number' : entry.sensitive ? 'password' : 'text'"
                      [step]="entry.type === 'float' ? '0.01' : null"
                      [value]="displayValueFor(entry)"
                      [placeholder]="entry.sensitive && entry.configured ? 'Password is set; type a new value to replace it' : ''"
                      (focus)="selectSensitiveValue(entry, $event)"
                      (input)="setValue(entry, $event)"
                    />
                  }

                  @if (entry.description) {
                    <small>{{ entry.description }}</small>
                  } @else {
                    <small>{{ entry.key }}</small>
                  }
                </label>
              }
            </div>
          </section>
        }
      </div>
    </ng-template>
  `,
})
export class ServerConfigurationPage implements OnInit, OnDestroy {
  private readonly service = inject(ServerInstancesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly loading = inject(LoadingController);
  private readonly alerts = inject(AlertController);
  private readonly subscriptions = new Subscription();
  readonly server = signal<ServerDashboardCard | null>(null);
  readonly entries = signal<ServerConfigEntry[]>([]);
  readonly draft = signal<Record<string, ConfigValue>>({});
  readonly dirty = signal<Set<string>>(new Set());
  readonly showAdvanced = signal(false);
  readonly saving = signal(false);
  readonly message = signal('');
  readonly toggle = (value: boolean) => !value;
  readonly dirtyCount = computed(() => this.dirty().size);
  readonly popularEntries = computed(() => this.entries().filter((entry) => entry.popular && entry.group !== 'Local API'));
  readonly advancedEntries = computed(() => this.entries().filter((entry) => !entry.popular && entry.group !== 'Local API'));
  readonly popularGroups = computed(() => this.groupEntries(this.popularEntries()));
  readonly advancedGroups = computed(() => this.groupEntries(this.advancedEntries()));

  ngOnInit(): void {
    this.refreshServer();
    this.subscriptions.add(
      this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
        if (event.urlAfterRedirects.startsWith('/server-configuration')) {
          this.refreshServer();
        }
      }),
    );
    this.subscriptions.add(this.route.queryParamMap.subscribe(() => this.refreshServer()));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refreshServer(): void {
    this.service.dashboard().subscribe((servers) => {
      const selected = selectServerFromRoute(servers, this.route, this.router);
      this.server.set(selected);
      if (selected) this.loadConfig(selected.id);
    });
  }

  reload(): void {
    const server = this.server();
    if (server) this.loadConfig(server.id);
  }

  valueFor(entry: ServerConfigEntry): ConfigValue {
    return this.draft()[entry.key] ?? entry.value ?? '';
  }

  displayValueFor(entry: ServerConfigEntry): ConfigValue {
    if (entry.sensitive && entry.configured && !this.dirty().has(entry.key) && !this.valueFor(entry)) {
      return MASKED_SECRET_VALUE;
    }
    return this.valueFor(entry);
  }

  optionExists(entry: ServerConfigEntry): boolean {
    const value = String(this.valueFor(entry));
    return !entry.options?.length || entry.options.some((option) => option.value === value);
  }

  isSelectedOption(entry: ServerConfigEntry, value: string): boolean {
    return String(this.valueFor(entry)) === value;
  }

  toggleBoolean(entry: ServerConfigEntry): void {
    this.setDraftValue(entry, this.valueFor(entry) !== true);
  }

  selectSensitiveValue(entry: ServerConfigEntry, event: Event): void {
    if (!entry.sensitive || !entry.configured || this.dirty().has(entry.key)) return;
    const target = event.target as HTMLInputElement;
    target.select();
  }

  setValue(entry: ServerConfigEntry, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (entry.sensitive && entry.configured && target.value === MASKED_SECRET_VALUE) return;
    let next: ConfigValue = target.value;
    if (entry.type === 'int') next = target.value === '' ? 0 : Number.parseInt(target.value, 10);
    if (entry.type === 'float') next = target.value === '' ? 0 : Number.parseFloat(target.value);
    this.setDraftValue(entry, next);
  }

  save(): void {
    void this.saveChanges();
  }

  private async saveChanges(): Promise<void> {
    const server = this.server();
    if (!server || !this.dirty().size) return;
    const values: Record<string, ConfigValue> = {};
    for (const key of this.dirty()) {
      const value = this.draft()[key];
      if (value !== undefined && value !== '') {
        values[key] = value;
      }
    }
    this.saving.set(true);
    const savingDialog = await this.loading.create({
      message: 'Saving server configuration...',
      spinner: 'dots',
      backdropDismiss: false,
    });
    await savingDialog.present();
    try {
      const result = await firstValueFrom(this.service.updateConfiguration(server.id, values));
      this.entries.set(result.entries);
      this.draft.set(Object.fromEntries(result.entries.map((entry) => [entry.key, entry.value])));
      this.dirty.set(new Set());
      this.message.set('');
      await savingDialog.dismiss();
      await this.promptForRestart(server.id);
    } catch (error) {
      this.message.set(this.saveErrorMessage(error));
      await savingDialog.dismiss();
    } finally {
      this.saving.set(false);
    }
  }

  private async promptForRestart(serverId: string): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Restart server?',
      message: 'Palworld usually applies configuration changes after a restart.',
      buttons: [
        { text: 'Later', role: 'cancel' },
        {
          text: 'Restart now',
          role: 'confirm',
          handler: () => {
            this.service.restart(serverId).subscribe(() => this.refreshServer());
          },
        },
      ],
    });
    await alert.present();
  }

  private setDraftValue(entry: ServerConfigEntry, value: ConfigValue): void {
    this.draft.update((current) => ({ ...current, [entry.key]: value }));
    this.dirty.update((current) => new Set(current).add(entry.key));
  }

  private saveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = (error.error as { message?: string | string[] } | null)?.message;
      if (Array.isArray(message)) return message.join(' ');
      if (message) return message;
    }
    return 'Could not save settings.';
  }

  private loadConfig(id: string): void {
    this.service.configuration(id).subscribe((result) => {
      this.entries.set(result.entries);
      this.draft.set(Object.fromEntries(result.entries.map((entry) => [entry.key, entry.value])));
      this.dirty.set(new Set());
      this.message.set('');
    });
  }

  private groupEntries(entries: ServerConfigEntry[]): Array<{ name: string; entries: ServerConfigEntry[] }> {
    const groups = new Map<string, ServerConfigEntry[]>();
    for (const entry of entries) {
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => {
        const ai = GROUP_ORDER.indexOf(a);
        const bi = GROUP_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
      })
      .map(([name, groupedEntries]) => ({ name, entries: groupedEntries }));
  }
}
