import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  NexusInstallPreview,
  NexusInstallTargetKind,
  NexusModFile,
  NexusModSummary,
  ServerDashboardCard,
  ServerModInventory,
  ServerModInventoryItem,
  ServerModKind,
  ServerModRequest,
  Ue4ssStatus,
} from '@palwarden/shared';
import { AuthService } from '../../core/authentication/auth.service';
import { ServerInstancesService } from './server-instances.service';
import { selectServerFromRoute } from './selected-server';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (server(); as selected) {
      <details class="panel collapsible-panel mods-header-panel" open>
        <summary class="collapsible-summary">
          <div>
            <h2>{{ selected.displayName }} Mods</h2>
            <p class="muted">Manage locally installed Pak, LogicMods, and UE4SS mods for this server.</p>
          </div>
        </summary>
        <div class="collapsible-body">
          <div class="control-row">
            <button type="button" class="secondary-button" (click)="loadInventory(selected.id)">Rescan</button>
          </div>
          <div class="stat-grid">
            <div><span>Total Mods</span><strong>{{ inventory()?.items?.length ?? 0 }}</strong></div>
            <div><span>Pak Mods</span><strong>{{ countByKind('pak') }}</strong></div>
            <div><span>Logic Mods</span><strong>{{ countByKind('logic') }}</strong></div>
            <div><span>UE4SS Mods</span><strong>{{ countByKind('ue4ss') }}</strong></div>
            <div><span>Enabled</span><strong>{{ countByStatus('enabled') }}</strong></div>
            <div><span>Disabled</span><strong>{{ countByStatus('disabled') }}</strong></div>
            <div><span>Total Size</span><strong>{{ formatBytes(totalSize()) }}</strong></div>
            <div><span>Last Scan</span><strong>{{ scanTime() }}</strong></div>
          </div>
        </div>
      </details>

      <details class="panel collapsible-panel mods-inventory-panel" open>
        <summary class="collapsible-summary">
          <div>
            <h2>Local Inventory</h2>
            <p class="muted">Enable, disable, remove, and set load order for mods already present on disk.</p>
          </div>
        </summary>

        <div class="collapsible-body">
          <div class="mods-toolbar">
            <label>
              Search
              <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Filter by name, path, or file" />
            </label>
            <label>
              Type
              <select [ngModel]="kind()" (ngModelChange)="kind.set($event)">
                <option value="">All types</option>
                <option value="pak">Pak</option>
                <option value="logic">Logic</option>
                <option value="ue4ss">UE4SS</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label>
              Status
              <select [ngModel]="status()" (ngModelChange)="status.set($event)">
                <option value="">All statuses</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
                <option value="partial">Partial</option>
                <option value="folder">Folder</option>
                <option value="missing">Missing</option>
              </select>
            </label>
            <div class="mods-toolbar-actions">
              <button type="button" class="primary-button" (click)="openNexusCatalog()">Browse Nexus Mods</button>
              <button type="button" class="secondary-button" (click)="openNexusSearch()">Search all mods</button>
            </div>
          </div>

          <div class="table-wrap">
            <table class="data-table mods-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Order</th>
                <th>Size</th>
                <th>Updated</th>
                <th>Nexus</th>
                <th>Location</th>
                <th>Files</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (mod of filteredItems(); track mod.id) {
                <tr>
                  <td>
                    <strong>{{ mod.name }}</strong>
                    @if (mod.notes.length) {
                      @for (note of mod.notes; track note) {
                        <span class="table-details warning-text">{{ note }}</span>
                      }
                    }
                    @if (mod.dependencies.length) {
                      <details class="mod-dependencies">
                        <summary>{{ mod.dependencies.length }} dependenc{{ mod.dependencies.length === 1 ? 'y' : 'ies' }}</summary>
                        @for (dependency of mod.dependencies; track dependency.name + dependency.nexusModId) {
                          <span>
                            @if (dependency.nexusUrl) {
                              <a [href]="dependency.nexusUrl" target="_blank" rel="noreferrer">{{ dependency.name }}</a>
                            } @else {
                              {{ dependency.name }}
                            }
                            @if (dependency.required === true) {
                              <em>required</em>
                            } @else if (dependency.required === false) {
                              <em>optional</em>
                            }
                            @if (dependency.notes) {
                              <small>{{ dependency.notes }}</small>
                            }
                          </span>
                        }
                      </details>
                    }
                  </td>
                  <td>{{ kindLabel(mod.kind) }}</td>
                  <td>
                    <span class="state-badge" [class.online]="mod.status === 'enabled'" [class.danger]="mod.status === 'disabled' || mod.status === 'missing'">
                      {{ statusLabel(mod.status) }}
                    </span>
                  </td>
                  <td>{{ mod.loadPriority + 1 }}</td>
                  <td>{{ formatBytes(mod.sizeBytes) }}</td>
                  <td>{{ formatDate(mod.updatedAt) }}</td>
                  <td>
                    @if (mod.sourceModId) {
                      <div class="mod-nexus-status">
                        <a [href]="nexusUrl(mod.sourceModId)" target="_blank" rel="noreferrer">#{{ mod.sourceModId }}</a>
                        <span>Installed: {{ mod.version || 'unknown' }}</span>
                        <span>Latest: {{ mod.latestVersion || 'unknown' }}</span>
                        @if (mod.updateAvailable) {
                          <strong>Update available</strong>
                        } @else if (mod.updateCheckedAt && !mod.updateCheckError) {
                          <span>Current</span>
                        }
                        @if (mod.updateCheckError) {
                          <small class="warning-text">{{ mod.updateCheckError }}</small>
                        }
                      </div>
                    } @else {
                      <span class="muted">Local only</span>
                    }
                  </td>
                  <td class="path-cell">{{ mod.relativePath }}</td>
                  <td>
                    <details class="mod-files">
                      <summary>{{ mod.files.length }} file{{ mod.files.length === 1 ? '' : 's' }}</summary>
                      @for (file of mod.files; track file) {
                        <span>{{ file }}</span>
                      }
                    </details>
                  </td>
                  <td>
                    <div class="table-actions mod-actions">
                      <button type="button" class="secondary-button compact" [disabled]="actionBusy() === mod.id" (click)="moveMod(mod, -1)">Up</button>
                      <button type="button" class="secondary-button compact" [disabled]="actionBusy() === mod.id" (click)="moveMod(mod, 1)">Down</button>
                      <button type="button" class="secondary-button compact" [disabled]="actionBusy() === mod.id" (click)="toggleMod(mod)">
                        {{ mod.status === 'disabled' ? 'Enable' : 'Disable' }}
                      </button>
                      @if (isOwner() && mod.sourceModId) {
                        <button type="button" class="secondary-button compact" [class.update-action]="mod.updateAvailable" [disabled]="actionBusy() === mod.id" (click)="updateMod(mod)">
                          {{ mod.updateAvailable ? 'Update' : 'Reinstall' }}
                        </button>
                      }
                      <button type="button" class="danger-button compact" [disabled]="actionBusy() === mod.id" (click)="removeMod(mod)">Remove</button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="10" class="muted">No mods match the current filters.</td>
                </tr>
              }
            </tbody>
            </table>
          </div>
        </div>
      </details>

      <details class="panel collapsible-panel mods-foundation-group" open>
        <summary class="collapsible-summary">
          <div>
            <h2>Mod folders and UE4SS Loader</h2>
            <p class="muted">Review Palworld mod paths and manage the UE4SS loader for this server.</p>
          </div>
          <span class="state-badge" [class.online]="ue4ss()?.installed">{{ ue4ss()?.installed ? 'UE4SS installed' : 'UE4SS not installed' }}</span>
        </summary>

        <div class="mods-foundation-row collapsible-body">
          <section class="mods-foundation-subcard mods-roots-panel">
            <h2>Mod folders</h2>
            <p class="muted">Common Palworld mod paths for this selected server.</p>
            <div class="mods-root-grid">
              @for (root of inventory()?.roots ?? []; track root.path) {
                <article class="mods-root-card">
                  <div>
                    <strong>{{ root.label }}</strong>
                    <p class="path-cell">{{ root.path }}</p>
                  </div>
                  <span class="state-badge" [class.online]="root.exists">{{ root.exists ? 'found' : 'missing' }}</span>
                </article>
              }
            </div>
          </section>

          <section class="mods-foundation-subcard ue4ss-panel">
            <div class="panel-header">
              <div>
                <h2>UE4SS Loader</h2>
                <p class="muted">Install or update the UE4SS mod loader into this server's Win64 folder.</p>
              </div>
              <span class="state-badge" [class.online]="ue4ss()?.installed">{{ ue4ss()?.installed ? 'installed' : 'not installed' }}</span>
            </div>
            <div class="ue4ss-grid">
              <div>
                <span>Installed version</span>
                <strong>{{ ue4ss()?.installedVersion || 'None' }}</strong>
              </div>
              <div>
                <span>Latest release</span>
                <strong>{{ ue4ss()?.latestVersion || 'Unknown' }}</strong>
              </div>
              <div>
                <span>Release asset</span>
                <strong>{{ ue4ss()?.latestAssetName || 'Unavailable' }}</strong>
              </div>
              <div>
                <span>Installed at</span>
                <strong>{{ ue4ss()?.installedAt ? formatDate(ue4ss()!.installedAt) : 'Never' }}</strong>
              </div>
            </div>
            <div class="control-row">
              <button type="button" class="secondary-button" (click)="loadUe4ss(selected.id)">Refresh status</button>
              @if (isOwner()) {
                <button type="button" class="primary-button" [disabled]="actionBusy() === 'ue4ss'" (click)="installUe4ss()">
                  {{ ue4ss()?.installed ? 'Update UE4SS' : 'Install UE4SS' }}
                </button>
                <button type="button" class="danger-button" [disabled]="!ue4ss()?.installed || actionBusy() === 'ue4ss'" (click)="uninstallUe4ss()">Uninstall UE4SS</button>
              }
            </div>
            @if (ue4ssMessage()) {
              <div class="inline-message selectable-message">
                <pre>{{ ue4ssMessage() }}</pre>
              </div>
            }
          </section>
        </div>
      </details>

      @if (inventory()?.warnings?.length) {
        <section class="panel warning-panel">
          <h2>Review</h2>
          @for (warning of inventory()?.warnings; track warning) {
            <p>{{ warning }}</p>
          }
        </section>
      }

      <details class="panel collapsible-panel mods-requests-panel" open>
        <summary class="collapsible-summary">
          <div>
            <h2>Install Requests</h2>
            <p class="muted">Admins can request Nexus mods; owners approve installs for this selected server.</p>
          </div>
        </summary>
        <div class="table-wrap collapsible-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mod</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (request of modRequests(); track request.id) {
                <tr>
                  <td>
                    <strong>{{ request.name }}</strong>
                    <span class="table-details">{{ request.author }}</span>
                  </td>
                  <td><span class="state-badge" [class.online]="request.status === 'approved'" [class.danger]="request.status === 'denied'">{{ request.status }}</span></td>
                  <td>{{ request.requestedByUsername || 'Unknown' }}</td>
                  <td>{{ formatDate(request.createdAt) }}</td>
                  <td class="table-actions">
                    @if (isOwner() && request.status === 'pending') {
                      <button type="button" class="primary-button compact" (click)="approveRequest(request)">Approve</button>
                      <button type="button" class="danger-button compact" (click)="denyRequest(request)">Deny</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="muted">No mod install requests for this server.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </details>

      @if (nexusCatalogOpen()) {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Browse Nexus Mods">
          <div class="modal-panel nexus-catalog-modal">
            <header>
              <div>
                <h2>Nexus Mods</h2>
                <p class="muted">Browse Palworld mods, request installs, or install directly as owner when a Premium key is connected.</p>
              </div>
              <button type="button" class="icon-button" aria-label="Close Nexus catalog" (click)="closeNexusCatalog()">x</button>
            </header>
          <div class="control-row">
            <select [ngModel]="nexusList()" (ngModelChange)="changeNexusList($event)">
              <option value="trending">Trending</option>
              <option value="latest_added">Latest added</option>
              <option value="latest_updated">Latest updated</option>
            </select>
            <select [ngModel]="nexusPageSize()" (ngModelChange)="changeNexusPageSize($event)">
              <option [ngValue]="5">5 per page</option>
              <option [ngValue]="10">10 per page</option>
              <option [ngValue]="15">15 per page</option>
              <option [ngValue]="20">20 per page</option>
            </select>
            <input
              type="search"
              class="nexus-filter-input"
              placeholder="Filter this list"
              [ngModel]="nexusFilter()"
              (ngModelChange)="updateNexusFilter($event)"
            />
            <button type="button" class="secondary-button" (click)="openNexusSearch()">Search all Palworld mods</button>
            <button type="button" class="secondary-button" (click)="loadNexusCatalog()">Refresh</button>
          </div>

          @if (nexusMessage()) {
            <div class="inline-message selectable-message">
              <pre>{{ nexusMessage() }}</pre>
            </div>
          }

          <div class="nexus-catalog-grid">
            @for (mod of pagedNexusCatalog(); track mod.modId) {
              <article class="nexus-mod-card">
                <div class="nexus-mod-media">
                  @if (mod.pictureUrl) {
                    <img [src]="mod.pictureUrl" alt="" />
                  } @else {
                    <div class="nexus-mod-placeholder">No image</div>
                  }
                  <div class="nexus-mod-meta nexus-card-meta">
                    <span><strong>{{ mod.downloads }}</strong><small>downloads</small></span>
                    <span><strong>{{ mod.endorsements }}</strong><small>endorsements</small></span>
                  </div>
                  <div class="table-actions mod-actions nexus-card-actions">
                    <a class="secondary-button compact button-link" [href]="mod.nexusUrl" target="_blank" rel="noreferrer">Open Nexus</a>
                    <button type="button" class="secondary-button compact" (click)="requestMod(mod)">Request</button>
                    @if (isOwner()) {
                      <button type="button" class="primary-button compact" [disabled]="actionBusy() === 'nexus-' + mod.modId || actionBusy() === 'files-' + mod.modId" (click)="prepareInstallMod(mod)">Install</button>
                    }
                  </div>
                </div>
                <div class="nexus-mod-body">
                  <div>
                    <h3>{{ mod.name }}</h3>
                    <p class="muted">by {{ mod.author }} · {{ mod.categoryName }}</p>
                  </div>
                  <p>{{ mod.summary || 'No summary provided by Nexus Mods.' }}</p>
                </div>
              </article>
            } @empty {
              <p class="muted">Nexus catalog is not loaded yet.</p>
            }
          </div>
          @if (filteredNexusCatalog().length > nexusPageSize()) {
            <div class="pager-row">
              <button type="button" class="secondary-button compact" [disabled]="nexusPage() <= 1" (click)="changeNexusPage(-1)">Previous</button>
              <span class="muted">Page {{ nexusPage() }} of {{ nexusPageCount() }} · {{ filteredNexusCatalog().length }} mods shown</span>
              <button type="button" class="secondary-button compact" [disabled]="nexusPage() >= nexusPageCount()" (click)="changeNexusPage(1)">Next</button>
            </div>
          }

          </div>
        </section>
      }
      @if (nexusSearchOpen()) {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Search Nexus Mods">
          <div class="modal-panel nexus-search-modal">
            <header>
              <div>
                <h2>Search Nexus Mods</h2>
                <p class="muted">Search across Palworld mods on Nexus, then request or install the selected mod.</p>
              </div>
              <button type="button" class="icon-button" aria-label="Close search" (click)="closeNexusSearch()">x</button>
            </header>
            <div class="nexus-search-bar">
              <input
                type="search"
                placeholder="Search by mod name, author, or Nexus ID"
                [ngModel]="nexusSearchQuery()"
                (ngModelChange)="nexusSearchQuery.set($event)"
                (keyup.enter)="searchAllNexusMods()"
              />
              <button type="button" class="primary-button" [disabled]="actionBusy() === 'nexus-search'" (click)="searchAllNexusMods()">Search</button>
            </div>
            @if (nexusSearchMessage()) {
              <div class="inline-message selectable-message">
                <pre>{{ nexusSearchMessage() }}</pre>
              </div>
            }
            <div class="nexus-search-results">
              @for (mod of nexusSearchResults(); track mod.modId) {
                <article class="nexus-search-result">
                  @if (mod.pictureUrl) {
                    <img [src]="mod.pictureUrl" alt="" />
                  }
                  <div>
                    <h3>{{ mod.name }}</h3>
                    <p class="muted">by {{ mod.author }} · {{ mod.categoryName }}</p>
                    <p>{{ mod.summary || 'No summary provided by Nexus Mods.' }}</p>
                    <div class="nexus-mod-meta">
                      <span>{{ mod.downloads }} downloads</span>
                      <span>{{ mod.endorsements }} endorsements</span>
                    </div>
                  </div>
                  <div class="table-actions mod-actions">
                    <a class="secondary-button compact button-link" [href]="mod.nexusUrl" target="_blank" rel="noreferrer">Open Nexus</a>
                    <button type="button" class="secondary-button compact" (click)="requestMod(mod)">Request</button>
                    @if (isOwner()) {
                      <button type="button" class="primary-button compact" [disabled]="actionBusy() === 'nexus-' + mod.modId || actionBusy() === 'files-' + mod.modId" (click)="prepareInstallMod(mod)">Install</button>
                    }
                  </div>
                </article>
              } @empty {
                <p class="muted">{{ nexusSearchRan() ? 'No matching Palworld mods were found.' : 'Enter a search term to find Palworld mods.' }}</p>
              }
            </div>
          </div>
        </section>
      }

      @if (filePickerMod(); as pickerMod) {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose Nexus file">
          <div class="modal-panel nexus-file-picker-modal">
            <header>
              <div>
                <h2>Choose File</h2>
                <p class="muted">{{ pickerMod.name }}</p>
              </div>
              <button type="button" class="icon-button" aria-label="Close file picker" (click)="closeFilePicker()">x</button>
            </header>
            <div class="nexus-file-list modal-file-list">
              @for (file of visibleFilePickerFiles(); track file.fileId) {
                <button type="button" class="nexus-file-row" [class.main-file]="file.isMain" (click)="previewInstallMod(pickerMod, file)">
                  <strong>{{ file.name }}</strong>
                  <span>{{ file.category }} · {{ file.version || 'version unknown' }} · {{ file.sizeKb ? formatBytes(file.sizeKb * 1024) : 'size unknown' }}</span>
                  <small>{{ file.description || 'No file description provided by Nexus Mods.' }}</small>
                </button>
              } @empty {
                <p class="muted">No main install files were returned for this mod.</p>
              }
            </div>
          </div>
        </section>
      }

      @if (installPreview(); as preview) {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm Nexus install target">
          <div class="modal-panel nexus-install-preview-modal">
            <header>
              <div>
                <h2>Install Target</h2>
                <p class="muted">{{ preview.modName }} · {{ preview.fileName }}</p>
              </div>
              <button type="button" class="icon-button" aria-label="Close install preview" (click)="closeInstallPreview()">x</button>
            </header>

            <div class="install-preview-summary">
              <div>
                <span>Detected as</span>
                <strong>{{ installTargetLabel(preview.detectedTargetKind) }}</strong>
              </div>
              <div>
                <span>Archive files</span>
                <strong>{{ preview.archiveFileCount }}</strong>
              </div>
              <div>
                <span>Pak files</span>
                <strong>{{ preview.pakFileCount }}</strong>
              </div>
            </div>

            <div class="modal-grid">
              <label>
                Install as
                <select [ngModel]="installTargetKind()" (ngModelChange)="changeInstallTargetKind($event)">
                  <option value="pak">Pak ~mods</option>
                  <option value="logic">LogicMods</option>
                  <option value="ue4ss">UE4SS Mods</option>
                </select>
              </label>
              <label>
                Folder name
                <input [ngModel]="installFolderName()" (ngModelChange)="changeInstallFolderName($event)" [disabled]="installTargetKind() === 'pak'" />
              </label>
              <label class="modal-wide">
                Destination
                <input [ngModel]="installPreviewPath()" readonly />
              </label>
            </div>

            @if (preview.warnings.length || installTargetKind() !== preview.detectedTargetKind) {
              <div class="warning-panel import-warning-panel">
                <h2>Review</h2>
                @if (installTargetKind() !== preview.detectedTargetKind) {
                  <p>Palwarden detected {{ installTargetLabel(preview.detectedTargetKind) }}, but will install as {{ installTargetLabel(installTargetKind()) }}.</p>
                }
                @for (warning of preview.warnings; track warning) {
                  <p>{{ warning }}</p>
                }
              </div>
            }

            <footer>
              <button type="button" class="secondary" (click)="closeInstallPreview()">Cancel</button>
              <button type="button" [disabled]="actionBusy() === 'nexus-' + preview.nexusModId" (click)="confirmInstallMod()">Install Mod</button>
            </footer>
          </div>
        </section>
      }

      @if (progressMessage()) {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Mod action in progress">
          <div class="modal-panel action-progress-modal">
            <h2>{{ progressMessage() }}</h2>
            <div class="indeterminate-bar"><span></span></div>
            <p class="muted">Large mod downloads can take a bit. Keep this tab open while Palwarden works.</p>
          </div>
        </section>
      }
    } @else {
      <section class="empty-state">Add or select a server before reviewing mods.</section>
    }
  `,
})
export class ModsPage {
  private readonly service = inject(ServerInstancesService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly server = signal<ServerDashboardCard | null>(null);
  readonly inventory = signal<ServerModInventory | null>(null);
  readonly ue4ss = signal<Ue4ssStatus | null>(null);
  readonly ue4ssMessage = signal('');
  readonly nexusCatalog = signal<NexusModSummary[]>([]);
  readonly modRequests = signal<ServerModRequest[]>([]);
  readonly nexusList = signal<'trending' | 'latest_added' | 'latest_updated'>('trending');
  readonly nexusPage = signal(1);
  readonly nexusPageSize = signal(10);
  readonly nexusFilter = signal('');
  readonly nexusCatalogOpen = signal(false);
  readonly nexusSearchOpen = signal(false);
  readonly nexusSearchQuery = signal('');
  readonly nexusSearchResults = signal<NexusModSummary[]>([]);
  readonly nexusSearchRan = signal(false);
  readonly nexusSearchMessage = signal('');
  readonly filePickerMod = signal<NexusModSummary | null>(null);
  readonly filePickerFiles = signal<NexusModFile[]>([]);
  readonly visibleFilePickerFiles = computed(() => {
    const files = this.filePickerFiles();
    const mainFiles = files.filter((file) => file.isMain);
    return mainFiles.length ? mainFiles : files;
  });
  readonly installPreview = signal<NexusInstallPreview | null>(null);
  readonly installPreviewMod = signal<NexusModSummary | null>(null);
  readonly installTargetKind = signal<NexusInstallTargetKind>('pak');
  readonly installFolderName = signal('');
  readonly nexusMessage = signal('');
  readonly query = signal('');
  readonly kind = signal('');
  readonly status = signal('');
  readonly actionBusy = signal<string | null>(null);
  readonly progressMessage = signal('');
  readonly filteredItems = computed(() => this.filterItems());
  readonly filteredNexusCatalog = computed(() => this.filterNexusCatalog());
  readonly pagedNexusCatalog = computed(() => {
    const start = (this.nexusPage() - 1) * this.nexusPageSize();
    return this.filteredNexusCatalog().slice(start, start + this.nexusPageSize());
  });
  readonly nexusPageCount = computed(() => Math.max(1, Math.ceil(this.filteredNexusCatalog().length / this.nexusPageSize())));
  readonly totalSize = computed(() => (this.inventory()?.items ?? []).reduce((sum, item) => sum + item.sizeBytes, 0));
  readonly installPreviewPath = computed(() => {
    const folderName = this.installFolderName().trim();
    const kind = this.installTargetKind();
    if (kind === 'pak') return 'Pal\\Content\\Paks\\~mods';
    if (kind === 'logic') return `Pal\\Content\\Paks\\LogicMods\\${folderName || '{folder name}'}`;
    return `Pal\\Binaries\\Win64\\Mods\\${folderName || '{folder name}'}`;
  });

  constructor() {
    this.service.dashboard().subscribe((servers) => {
      const selected = selectServerFromRoute(servers, this.route, this.router);
      this.server.set(selected);
      if (selected) {
        this.loadInventory(selected.id);
        this.loadUe4ss(selected.id);
        this.loadRequests(selected.id);
        this.loadNexusCatalog();
      }
    });
  }

  loadInventory(id: string): void {
    this.service.mods(id).subscribe({
      next: (inventory) => this.inventory.set(inventory),
      error: () =>
        this.inventory.set({
          serverInstanceId: id,
          scannedAt: new Date().toISOString(),
          roots: [],
          items: [],
          warnings: ['Palwarden could not scan the mod folders for this server.'],
        }),
    });
  }

  countByKind(kind: ServerModKind): number {
    return (this.inventory()?.items ?? []).filter((item) => item.kind === kind).length;
  }

  countByStatus(status: ServerModInventoryItem['status']): number {
    return (this.inventory()?.items ?? []).filter((item) => item.status === status).length;
  }

  loadUe4ss(id: string): void {
    this.service.ue4ssStatus(id).subscribe({
      next: (status) => {
        this.ue4ss.set(status);
        this.ue4ssMessage.set('');
      },
      error: (error: { error?: { message?: string } }) => this.ue4ssMessage.set(error.error?.message ?? 'Could not load UE4SS status.'),
    });
  }

  installUe4ss(): void {
    const selected = this.server();
    if (!selected) return;
    this.actionBusy.set('ue4ss');
    this.progressMessage.set('Installing UE4SS');
    this.ue4ssMessage.set('Installing UE4SS...');
    this.service.installUe4ss(selected.id).subscribe({
      next: (status) => {
        this.ue4ss.set(status);
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.ue4ssMessage.set('UE4SS installed. Restart the server before using UE4SS mods.');
        this.loadInventory(selected.id);
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.ue4ssMessage.set(error.error?.message ?? 'Could not install UE4SS.');
      },
    });
  }

  uninstallUe4ss(): void {
    const selected = this.server();
    if (!selected) return;
    const confirmed = window.confirm('Uninstall the UE4SS files Palwarden installed? Existing unrelated mods are preserved.');
    if (!confirmed) return;
    this.actionBusy.set('ue4ss');
    this.progressMessage.set('Uninstalling UE4SS');
    this.ue4ssMessage.set('Uninstalling UE4SS...');
    this.service.uninstallUe4ss(selected.id).subscribe({
      next: (status) => {
        this.ue4ss.set(status);
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.ue4ssMessage.set('UE4SS uninstalled.');
        this.loadInventory(selected.id);
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.ue4ssMessage.set(error.error?.message ?? 'Could not uninstall UE4SS.');
      },
    });
  }

  isOwner(): boolean {
    return this.auth.user()?.role === 'OWNER';
  }

  changeNexusList(value: string): void {
    if (value === 'trending' || value === 'latest_added' || value === 'latest_updated') {
      this.nexusList.set(value);
      this.nexusPage.set(1);
      this.loadNexusCatalog();
    }
  }

  changeNexusPageSize(value: number | string): void {
    const parsed = Number(value);
    this.nexusPageSize.set(parsed >= 5 && parsed <= 20 && parsed % 5 === 0 ? parsed : 10);
    this.nexusPage.set(1);
  }

  updateNexusFilter(value: string): void {
    this.nexusFilter.set(value);
    this.nexusPage.set(1);
  }

  changeNexusPage(direction: -1 | 1): void {
    const next = Math.min(Math.max(this.nexusPage() + direction, 1), this.nexusPageCount());
    this.nexusPage.set(next);
  }

  loadNexusCatalog(): void {
    this.service.nexusMods(this.nexusList()).subscribe({
      next: (mods) => {
        this.nexusCatalog.set(mods);
        this.nexusPage.set(1);
        this.nexusMessage.set('');
      },
      error: (error: { error?: { message?: string } }) => this.nexusMessage.set(error.error?.message ?? 'Could not load Nexus Mods catalog.'),
    });
  }

  openNexusCatalog(): void {
    this.nexusCatalogOpen.set(true);
    if (!this.nexusCatalog().length) {
      this.loadNexusCatalog();
    }
  }

  closeNexusCatalog(): void {
    this.nexusCatalogOpen.set(false);
  }

  openNexusSearch(): void {
    this.nexusSearchOpen.set(true);
  }

  closeNexusSearch(): void {
    this.nexusSearchOpen.set(false);
  }

  searchAllNexusMods(): void {
    const query = this.nexusSearchQuery().trim();
    if (query.length < 2) {
      this.nexusSearchMessage.set('Enter at least 2 characters to search Nexus Mods.');
      return;
    }
    this.actionBusy.set('nexus-search');
    this.nexusSearchMessage.set('Searching Nexus Mods...');
    this.service.searchNexusMods(query).subscribe({
      next: (mods) => {
        this.nexusSearchResults.set(mods);
        this.nexusSearchRan.set(true);
        this.actionBusy.set(null);
        this.nexusSearchMessage.set('');
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.nexusSearchRan.set(true);
        this.nexusSearchMessage.set(error.error?.message ?? 'Could not search Nexus Mods.');
      },
    });
  }

  loadRequests(id: string): void {
    this.service.modRequests(id).subscribe({
      next: (requests) => this.modRequests.set(requests),
      error: () => this.modRequests.set([]),
    });
  }

  requestMod(mod: NexusModSummary): void {
    const selected = this.server();
    if (!selected) return;
    this.actionBusy.set(`request-${mod.modId}`);
    this.service.requestNexusMod(selected.id, mod).subscribe({
      next: (requests) => {
        this.modRequests.set(requests);
        this.actionBusy.set(null);
        this.nexusMessage.set(`${mod.name} requested for ${selected.displayName}.`);
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.nexusMessage.set(error.error?.message ?? 'Could not request that mod.');
      },
    });
  }

  prepareInstallMod(mod: NexusModSummary): void {
    const selected = this.server();
    if (!selected) return;
    this.actionBusy.set(`files-${mod.modId}`);
    this.service.nexusModFiles(selected.id, mod.modId).subscribe({
      next: (files) => {
        this.actionBusy.set(null);
        if (files.length > 1) {
          this.filePickerMod.set(mod);
          this.filePickerFiles.set(files);
          return;
        }
        if (files.length === 1) {
          this.previewInstallMod(mod, files[0]);
          return;
        }
        this.nexusMessage.set('Nexus returned no installable files for that mod.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.nexusMessage.set(error.error?.message ?? 'Could not load Nexus files for that mod.');
      },
    });
  }

  closeFilePicker(): void {
    this.filePickerMod.set(null);
    this.filePickerFiles.set([]);
  }

  previewInstallMod(mod: NexusModSummary, file?: NexusModFile): void {
    const selected = this.server();
    if (!selected) return;
    this.actionBusy.set(`preview-${mod.modId}`);
    this.progressMessage.set(`Inspecting ${mod.name}`);
    this.service.previewNexusModInstall(selected.id, mod.modId, file?.fileId).subscribe({
      next: (preview) => {
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.closeFilePicker();
        this.installPreviewMod.set(mod);
        this.installPreview.set(preview);
        this.installTargetKind.set(preview.targetKind);
        this.installFolderName.set(preview.folderName);
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.nexusMessage.set(error.error?.message ?? 'Could not inspect that mod archive.');
      },
    });
  }

  closeInstallPreview(): void {
    this.installPreview.set(null);
    this.installPreviewMod.set(null);
    this.installTargetKind.set('pak');
    this.installFolderName.set('');
  }

  changeInstallTargetKind(value: string): void {
    if (value === 'pak' || value === 'logic' || value === 'ue4ss') {
      this.installTargetKind.set(value);
    }
  }

  changeInstallFolderName(value: string): void {
    this.installFolderName.set(value);
  }

  installTargetLabel(kind: NexusInstallTargetKind): string {
    if (kind === 'pak') return 'Pak ~mods';
    if (kind === 'logic') return 'LogicMods';
    return 'UE4SS Mods';
  }

  confirmInstallMod(): void {
    const selected = this.server();
    const preview = this.installPreview();
    const mod = this.installPreviewMod();
    if (!selected || !preview || !mod) return;
    this.actionBusy.set(`nexus-${mod.modId}`);
    this.progressMessage.set(`Installing ${mod.name}`);
    this.nexusMessage.set(`Installing ${mod.name}...`);
    this.service.installNexusMod(selected.id, mod.modId, preview.fileId, this.installTargetKind(), this.installFolderName()).subscribe({
      next: (inventory) => {
        this.inventory.set(inventory);
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.closeInstallPreview();
        this.nexusMessage.set(`${mod.name} installed. Restart the server before expecting it to load.`);
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.nexusMessage.set(error.error?.message ?? 'Could not install that mod.');
      },
    });
  }

  approveRequest(request: ServerModRequest): void {
    const selected = this.server();
    if (!selected) return;
    this.actionBusy.set(request.id);
    this.progressMessage.set(`Installing ${request.name}`);
    this.nexusMessage.set(`Installing ${request.name}...`);
    this.service.approveModRequest(selected.id, request.id).subscribe({
      next: (inventory) => {
        this.inventory.set(inventory);
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.loadRequests(selected.id);
        this.nexusMessage.set(`${request.name} approved and installed.`);
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.nexusMessage.set(error.error?.message ?? 'Could not approve that request.');
      },
    });
  }

  denyRequest(request: ServerModRequest): void {
    const selected = this.server();
    if (!selected) return;
    this.service.denyModRequest(selected.id, request.id).subscribe({
      next: (requests) => this.modRequests.set(requests),
      error: (error: { error?: { message?: string } }) => this.nexusMessage.set(error.error?.message ?? 'Could not deny that request.'),
    });
  }

  scanTime(): string {
    const value = this.inventory()?.scannedAt;
    return value ? new Date(value).toLocaleTimeString() : 'not scanned';
  }

  formatBytes(value: number): string {
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  formatDate(value: string | null): string {
    return value ? new Date(value).toLocaleString() : 'n/a';
  }

  kindLabel(kind: ServerModKind): string {
    if (kind === 'pak') return 'Pak';
    if (kind === 'logic') return 'Logic';
    if (kind === 'ue4ss') return 'UE4SS';
    return 'Unknown';
  }

  statusLabel(status: ServerModInventoryItem['status']): string {
    if (status === 'enabled') return 'Enabled';
    if (status === 'disabled') return 'Disabled';
    if (status === 'partial') return 'Needs review';
    if (status === 'missing') return 'Missing';
    return 'Folder';
  }

  nexusUrl(modId: number): string {
    return `https://www.nexusmods.com/palworld/mods/${modId}`;
  }

  toggleMod(mod: ServerModInventoryItem): void {
    const selected = this.server();
    if (!selected) return;
    this.actionBusy.set(mod.id);
    const request = mod.status === 'disabled' ? this.service.enableMod(selected.id, mod.id) : this.service.disableMod(selected.id, mod.id);
    request.subscribe({
      next: (inventory) => {
        this.inventory.set(inventory);
        this.actionBusy.set(null);
      },
      error: () => this.actionBusy.set(null),
    });
  }

  removeMod(mod: ServerModInventoryItem): void {
    const selected = this.server();
    if (!selected) return;
    const confirmed = window.confirm(`Remove ${mod.name} from this server? This deletes the managed mod files from disk.`);
    if (!confirmed) return;
    this.actionBusy.set(mod.id);
    this.service.removeMod(selected.id, mod.id).subscribe({
      next: (inventory) => {
        this.inventory.set(inventory);
        this.actionBusy.set(null);
      },
      error: () => this.actionBusy.set(null),
    });
  }

  moveMod(mod: ServerModInventoryItem, direction: -1 | 1): void {
    const selected = this.server();
    const inventory = this.inventory();
    if (!selected || !inventory) return;
    const ordered = [...inventory.items].sort((a, b) => a.loadPriority - b.loadPriority || a.name.localeCompare(b.name));
    const index = ordered.findIndex((item) => item.id === mod.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const current = ordered[index];
    const next = ordered[target];
    if (!current || !next) return;
    ordered[index] = next;
    ordered[target] = current;
    this.actionBusy.set(mod.id);
    this.service.reorderMods(selected.id, ordered.map((item) => item.id)).subscribe({
      next: (updated) => {
        this.inventory.set(updated);
        this.actionBusy.set(null);
      },
      error: () => this.actionBusy.set(null),
    });
  }

  updateMod(mod: ServerModInventoryItem): void {
    const selected = this.server();
    if (!selected || !mod.sourceModId) return;
    this.actionBusy.set(mod.id);
    this.progressMessage.set(`Updating ${mod.name}`);
    this.service.updateNexusMod(selected.id, mod.id).subscribe({
      next: (inventory) => {
        this.inventory.set(inventory);
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.nexusMessage.set(`${mod.name} updated from Nexus.`);
      },
      error: (error: { error?: { message?: string } }) => {
        this.actionBusy.set(null);
        this.progressMessage.set('');
        this.nexusMessage.set(error.error?.message ?? 'Could not update that mod.');
      },
    });
  }

  private filterItems(): ServerModInventoryItem[] {
    const q = this.query().trim().toLowerCase();
    const kind = this.kind();
    const status = this.status();
    return (this.inventory()?.items ?? [])
      .filter((item) => {
        if (kind && item.kind !== kind) return false;
        if (status && item.status !== status) return false;
        if (!q) return true;
        return [item.name, item.relativePath, item.path, ...item.files].some((value) => value.toLowerCase().includes(q));
      })
      .sort((a, b) => a.loadPriority - b.loadPriority || a.name.localeCompare(b.name));
  }

  private filterNexusCatalog(): NexusModSummary[] {
    const q = this.nexusFilter().trim().toLowerCase();
    const mods = this.nexusCatalog();
    if (!q) return mods;
    return mods.filter((mod) =>
      [mod.name, mod.author, mod.categoryName, mod.summary, String(mod.modId)].some((value) => value.toLowerCase().includes(q)),
    );
  }
}
