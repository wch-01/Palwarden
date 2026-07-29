import type { OnDestroy, OnInit} from '@angular/core';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonInput, IonItem, IonList, IonToggle } from '@ionic/angular/standalone';
import type { Subscription } from 'rxjs';
import { catchError, of } from 'rxjs';
import { deployProgressView } from './deploy-progress';
import { ServerInstancesService } from './server-instances.service';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonInput, IonItem, IonList, IonToggle],
  template: `
    <h1>{{ id ? 'Server settings' : 'New server' }}</h1>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <ion-list class="form-grid">
        <ion-item><ion-input label="Name" formControlName="displayName" /></ion-item>
        <ion-item><ion-input label="Description" formControlName="description" /></ion-item>
        <ion-item><ion-input label="Install directory" formControlName="installationDirectory" /></ion-item>
        @if (id) {
          <ion-item><ion-input label="Executable" formControlName="executablePath" /></ion-item>
          <ion-item><ion-input label="Working directory" formControlName="workingDirectory" /></ion-item>
          <ion-item><ion-input label="Config file" formControlName="configurationFilePath" /></ion-item>
          <ion-item><ion-input label="Save directory" formControlName="saveDirectory" /></ion-item>
          <ion-item><ion-input label="Backup directory" formControlName="backupDirectory" /></ion-item>
        }
        <ion-item><ion-input label="REST host" formControlName="restApiHost" /></ion-item>
        <ion-item><ion-input label="REST port" type="number" formControlName="restApiPort" /></ion-item>
        <ion-item><ion-input label="Game port" type="number" formControlName="gamePort" /></ion-item>
        <ion-item><ion-input label="Query port" type="number" formControlName="queryPort" /></ion-item>
        <ion-item><ion-input label="Max players" type="number" formControlName="maxPlayers" /></ion-item>
        <ion-item><ion-input label="Admin password" type="password" formControlName="adminPassword" /></ion-item>
        @if (!id) {
          <ion-item><ion-input label="Server password" type="password" formControlName="serverPassword" /></ion-item>
          <ion-item><ion-toggle formControlName="startAfterInstall">Start after install</ion-toggle></ion-item>
        }
        <ion-item><ion-input label="Launch args" formControlName="launchArgumentsText" /></ion-item>
        <ion-item><ion-toggle formControlName="autoStart">Auto-start</ion-toggle></ion-item>
        <ion-item><ion-toggle formControlName="autoRestart">Auto-restart</ion-toggle></ion-item>
        <ion-item><ion-toggle formControlName="backupBeforeRestart">Backup before restart</ion-toggle></ion-item>
        <ion-item><ion-toggle formControlName="backupBeforeUpdate">Backup before update</ion-toggle></ion-item>
        <ion-item><ion-toggle formControlName="backupBeforeConfigChange">Backup before config changes</ion-toggle></ion-item>
        <ion-item><ion-toggle formControlName="forceStopAfterGracefulTimeout">Force stop after graceful timeout</ion-toggle></ion-item>
      </ion-list>
      @if (!id) {
        <p class="content">
          Palwarden will install a fresh Palworld Dedicated Server with SteamCMD, write the Palworld settings file, register the
          profile, and optionally start it. Leave Admin password blank to generate one.
        </p>
        <ion-button type="button" fill="outline" (click)="resetDefaultInstallDirectory()">Use default install directory</ion-button>
      }
      <ion-button type="submit" [disabled]="form.invalid || deploying">{{ id ? 'Save' : 'Install server' }}</ion-button>
    </form>
    @if (deploying || deployLog.length || deployError) {
      <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Server install progress">
        <div class="modal-panel deploy-progress-modal">
          <header>
            <h2>{{ deployProgress().title }}</h2>
            @if (!deploying) {
              <button type="button" class="icon-button" aria-label="Close install progress" (click)="dismissDeployProgress()">x</button>
            }
          </header>
          <div class="loading-summary">
            <span class="loading-spinner" aria-hidden="true"></span>
            <div>
              <strong>{{ deployProgress().step }}</strong>
              <p class="muted">{{ deployProgress().detail }}</p>
            </div>
          </div>
          <div class="progress-track" [class.indeterminate]="deployProgress().percent === null">
            @if (deployProgress().percent !== null) {
              <span [style.width.%]="deployProgress().percent"></span>
            } @else {
              <span></span>
            }
          </div>
          @if (deployProgress().percent !== null) {
            <p class="muted progress-percent">{{ deployProgress().percent }}%</p>
          }
          @if (deployProgress().failed) {
            <p class="error-text">{{ deployError }}</p>
          }
          <details class="deploy-details">
            <summary>View details</summary>
            <pre>{{ deployProgress().log.join('\\n') }}</pre>
          </details>
        </div>
      </section>
    }
  `,
})
export class ServerFormPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(ServerInstancesService);
  id = this.route.snapshot.paramMap.get('id');
  deploying = false;
  deployLog: string[] = [];
  deployError = '';
  private defaultPathSub?: Subscription;
  private deployTimer?: number;
  private deployWatchdog?: number;
  private readonly existingInstallPathFields = [
    'executablePath',
    'workingDirectory',
    'configurationFilePath',
    'saveDirectory',
    'backupDirectory',
  ] as const;

  readonly form = this.fb.nonNullable.group({
    displayName: ['', Validators.required],
    description: [''],
    installationDirectory: ['', Validators.required],
    executablePath: ['', Validators.required],
    workingDirectory: ['', Validators.required],
    configurationFilePath: ['', Validators.required],
    saveDirectory: ['', Validators.required],
    backupDirectory: ['', Validators.required],
    restApiHost: ['127.0.0.1', Validators.required],
    restApiPort: [8212, Validators.required],
    adminPassword: [''],
    serverPassword: [''],
    gamePort: [8211, Validators.required],
    queryPort: [27015, Validators.required],
    maxPlayers: [32, Validators.required],
    launchArgumentsText: [''],
    autoStart: [false],
    autoRestart: [false],
    backupBeforeRestart: [false],
    backupBeforeUpdate: [false],
    backupBeforeConfigChange: [false],
    forceStopAfterGracefulTimeout: [false],
    startAfterInstall: [true],
  });

  ngOnInit(): void {
    this.configureModeValidation();
    if (this.id) {
      this.service.get(this.id).subscribe((server) =>
        this.form.patchValue({
          ...server,
          description: server.description ?? '',
          adminPassword: '',
          serverPassword: '',
          maxPlayers: 32,
          launchArgumentsText: server.launchArguments.join(' '),
        }),
      );
    } else {
      this.resetDefaultInstallDirectory();
      this.defaultPathSub = this.form.controls.displayName.valueChanges.subscribe(() => {
        if (!this.form.controls.installationDirectory.dirty) {
          this.resetDefaultInstallDirectory();
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.defaultPathSub?.unsubscribe();
    if (this.deployTimer) {
      window.clearInterval(this.deployTimer);
    }
    if (this.deployWatchdog) {
      window.clearTimeout(this.deployWatchdog);
    }
  }

  resetDefaultInstallDirectory(): void {
    const name = this.form.controls.displayName.value || 'Server';
    this.service
      .defaultInstallDirectory(name)
      .pipe(catchError(() => of({ path: `C:\\Users\\{user}\\AppData\\Local\\Palwarden\\data\\servers\\${name}` })))
      .subscribe(({ path }) => {
        this.form.controls.installationDirectory.setValue(path);
        this.form.controls.installationDirectory.markAsPristine();
      });
  }

  submit(): void {
    const raw = this.form.getRawValue();
    const { launchArgumentsText, adminPassword, serverPassword, startAfterInstall, maxPlayers, ...rest } = raw;
    const request = {
      ...rest,
      launchArguments: launchArgumentsText.split(' ').map((arg) => arg.trim()).filter(Boolean),
      ...(adminPassword ? { adminPassword } : {}),
    };
    const done = () => void this.router.navigateByUrl('/servers');
    if (this.id) {
      this.service.update(this.id, request).subscribe(done);
    } else {
      void this.deployNewServer(raw, request.launchArguments, adminPassword, serverPassword, startAfterInstall, maxPlayers);
    }
  }

  private async deployNewServer(
    raw: ReturnType<typeof this.form.getRawValue>,
    launchArguments: string[],
    adminPassword: string,
    serverPassword: string,
    startAfterInstall: boolean,
    maxPlayers: number,
  ): Promise<void> {
    this.deploying = true;
    this.deployError = '';
    this.deployLog = ['Sending deployment request to Palwarden...'];
    this.deployWatchdog = window.setTimeout(() => {
      if (this.deploying && this.deployLog.includes('Sending deployment request to Palwarden...')) {
        this.deploying = false;
        this.deployError = 'The browser did not complete the deployment request handoff within 20 seconds.';
        this.deployLog = [...this.deployLog, this.deployError];
      }
    }, 20000);
    try {
      this.deployLog = [...this.deployLog, 'Starting deployment...'];
      const job = await this.service.deploy({
        displayName: raw.displayName,
        description: raw.description,
        installationDirectory: raw.installationDirectory,
        restApiHost: raw.restApiHost,
        restApiPort: raw.restApiPort,
        gamePort: raw.gamePort,
        queryPort: raw.queryPort,
        maxPlayers,
        launchArguments,
        autoStart: raw.autoStart,
        autoRestart: raw.autoRestart,
        backupBeforeRestart: raw.backupBeforeRestart,
        backupBeforeUpdate: raw.backupBeforeUpdate,
        backupBeforeConfigChange: raw.backupBeforeConfigChange,
        forceStopAfterGracefulTimeout: raw.forceStopAfterGracefulTimeout,
        startAfterInstall,
        ...(adminPassword ? { adminPassword } : {}),
        ...(serverPassword ? { serverPassword } : {}),
      });
      if (this.deployWatchdog) {
        window.clearTimeout(this.deployWatchdog);
      }
      this.deployLog = [`Deployment job accepted: ${job.id}`, ...job.log];
      window.setTimeout(() => this.pollDeploy(job.id, true), 750);
    } catch (error) {
      if (this.deployWatchdog) {
        window.clearTimeout(this.deployWatchdog);
      }
      this.deploying = false;
      this.deployError = error instanceof Error ? error.message : 'Could not start deployment.';
      this.deployLog = [...this.deployLog, this.deployError];
    }
  }

  deployProgress() {
    return deployProgressView(this.deployLog, this.deployError ? 'error' : this.deploying ? 'running' : 'done', this.deployError || null);
  }

  dismissDeployProgress(): void {
    if (this.deploying) return;
    this.deployLog = [];
    this.deployError = '';
  }

  private configureModeValidation(): void {
    for (const field of this.existingInstallPathFields) {
      const control = this.form.controls[field];
      if (this.id) {
        control.setValidators(Validators.required);
      } else {
        control.clearValidators();
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private pollDeploy(jobId: string, immediately = false): void {
    const poll = () => {
      this.service.deployStatus(jobId).subscribe({
        next: (job) => {
          this.deployLog = job.log;
          if (job.status === 'done') {
            if (this.deployTimer) {
              window.clearInterval(this.deployTimer);
            }
            void this.router.navigateByUrl(job.serverInstanceId ? `/servers/${job.serverInstanceId}/overview` : '/servers');
          }
          if (job.status === 'error') {
            if (this.deployTimer) {
              window.clearInterval(this.deployTimer);
            }
            this.deploying = false;
            this.deployError = job.error ?? 'Deployment failed.';
          }
        },
        error: (error: unknown) => {
          if (this.deployTimer) {
            window.clearInterval(this.deployTimer);
          }
          this.deploying = false;
          this.deployError = error instanceof Error ? error.message : 'Could not read deployment status.';
        },
      });
    };
    if (immediately) {
      poll();
    }
    this.deployTimer = window.setInterval(poll, 1500);
  }
}
