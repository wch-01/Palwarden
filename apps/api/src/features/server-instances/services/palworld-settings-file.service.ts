import { Injectable } from '@nestjs/common';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const OPTION_LINE = /^OptionSettings=\((.*)\)\s*$/m;

export interface InitialPalworldSettings {
  serverName: string;
  gamePort: number;
  queryPort: number;
  restApiPort: number;
  adminPassword: string;
  serverPassword?: string;
  maxPlayers: number;
}

export interface PalworldConfigOption {
  value: string;
  label: string;
  description: string;
}

export type PalworldConfigFieldType = 'bool' | 'int' | 'float' | 'string' | 'enum' | 'raw';

export interface PalworldConfigEntry {
  key: string;
  value: string | number | boolean;
  type: PalworldConfigFieldType;
  label: string;
  description: string | null;
  help: string;
  group: string;
  options: PalworldConfigOption[] | null;
  sensitive: boolean;
  configured: boolean;
  popular: boolean;
}

interface FieldMeta {
  key: string;
  label: string;
  group: string;
  description?: string;
  help: string;
  sensitive?: boolean;
  options?: PalworldConfigOption[];
}

const option = (value: string, label: string, description: string): PalworldConfigOption => ({ value, label, description });

const OPTIONS: Record<string, PalworldConfigOption[]> = {
  Difficulty: [
    option('None', 'None', 'Uses the dedicated server custom-settings baseline.'),
    option('Easy', 'Easy', 'A gentler preset when supported by the installed server.'),
    option('Normal', 'Normal', 'Standard preset when supported by the installed server.'),
    option('Hard', 'Hard', 'A harsher preset when supported by the installed server.'),
  ],
  DeathPenalty: [
    option('None', 'None', 'No item or Pal drops on death.'),
    option('Item', 'Items', 'Drop inventory items, but keep equipment and Pals.'),
    option('ItemAndEquipment', 'Items and equipment', 'Drop inventory items and equipped gear.'),
    option('All', 'Everything', 'Drop inventory, equipment, and team Pals.'),
  ],
  RandomizerType: [
    option('None', 'None', 'Use normal Pal spawns.'),
    option('Region', 'Region', 'Randomize Pal spawns inside each region.'),
    option('All', 'All', 'Randomize Pal spawns across the world.'),
  ],
  CrossplayPlatforms: [
    option('(Steam)', 'Steam only', 'Only Steam clients may connect.'),
    option('(Xbox)', 'Xbox only', 'Only Xbox/Game Pass clients may connect.'),
    option('(PS5)', 'PS5 only', 'Only PlayStation 5 clients may connect.'),
    option('(Mac)', 'Mac only', 'Only Mac clients may connect.'),
    option('(Steam,Xbox)', 'Steam + Xbox', 'Allow Steam and Xbox/Game Pass clients.'),
    option('(Steam,Xbox,PS5,Mac)', 'All platforms', 'Allow Steam, Xbox/Game Pass, PS5, and Mac clients.'),
  ],
  LogFormatType: [
    option('Text', 'Text', 'Human-readable server logs.'),
    option('Json', 'JSON', 'Structured logs for external tools.'),
  ],
};

const POPULAR_FIELDS: FieldMeta[] = [
  { key: 'ServerName', label: 'Server Name', group: 'Identity and Access', help: 'The server name shown to players when they connect or browse for a server. Restart after changing it.' },
  { key: 'ServerDescription', label: 'Server Description', group: 'Identity and Access', help: 'Short public description shown where Palworld displays server details.' },
  { key: 'ServerPassword', label: 'Server Password', group: 'Identity and Access', sensitive: true, description: 'Optional join password.', help: 'Set this when you want players to enter a password before joining. An empty value leaves the server open to reachable clients.' },
  { key: 'bIsPublic', label: 'Public Server Listing', group: 'Identity and Access', help: 'Asks Palworld/Steam listing services to list the server publicly. Players still need a reachable address and open game/query ports.' },
  { key: 'AdminPassword', label: 'Admin Password', group: 'Identity and Access', sensitive: true, description: 'Sets the Palworld admin password and updates Palwarden\'s encrypted connection credential.', help: 'Enter a new value to replace it. Palwarden writes it to the server config, stores its own encrypted copy, and uses that copy for status, save, broadcast, player, and shutdown actions.' },
  { key: 'ServerPlayerMaxNum', label: 'Max Players', group: 'Identity and Access', help: 'Maximum connected players. Higher values allow more players but increase CPU, RAM, and network load.' },
  { key: 'CoopPlayerMaxNum', label: 'Max Players Per Party', group: 'Identity and Access', help: 'Maximum players in a party or shared play group.' },
  { key: 'Difficulty', label: 'Difficulty', group: 'World Rules', options: OPTIONS.Difficulty!, help: 'Selects a Palworld difficulty preset when the installed server version supports it.' },
  { key: 'DeathPenalty', label: 'Death Penalty', group: 'World Rules', options: OPTIONS.DeathPenalty!, help: 'Chooses which inventory, gear, or Pal losses apply when a player dies.' },
  { key: 'bIsPvP', label: 'PvP Enabled', group: 'World Rules', help: 'Allows players to damage and fight each other.' },
  { key: 'bEnableFriendlyFire', label: 'Friendly Fire', group: 'World Rules', help: 'Allows damage to allies or friendly targets.' },
  { key: 'bHardcore', label: 'Hardcore Mode', group: 'World Rules', help: 'Enables harsh survival rules with stronger death consequences.' },
  { key: 'bPalLost', label: 'Permanent Pal Loss', group: 'World Rules', description: 'Pals are lost forever on death.', help: 'Dedicated Pal permadeath setting. It is separate from Hardcore Mode.' },
  { key: 'ExpRate', label: 'EXP Rate', group: 'Progression', help: 'Adjusts how quickly players gain experience. Lower than 1 slows leveling; higher than 1 speeds it up.' },
  { key: 'PalCaptureRate', label: 'Capture Rate', group: 'Progression', help: 'Adjusts capture odds. Values below 1 make captures stricter; values above 1 make them more forgiving.' },
  { key: 'PalSpawnNumRate', label: 'Pal Spawn Rate', group: 'World Density', help: 'Pal spawn multiplier. Higher values increase world density and server load.' },
  { key: 'PalDamageRateAttack', label: 'Pal Attack Damage Rate', group: 'Combat', help: 'Scales outgoing Pal damage. Use lower values for softer Pal attacks and higher values for harder hits.' },
  { key: 'PalDamageRateDefense', label: 'Pal Defense Damage Rate', group: 'Combat', help: 'Scales incoming damage to Pals. Lower values make Pals sturdier; higher values make them take more damage.' },
  { key: 'PlayerDamageRateAttack', label: 'Player Attack Damage Rate', group: 'Combat', help: 'Scales outgoing player damage. Lower values reduce player damage; higher values increase it.' },
  { key: 'PlayerDamageRateDefense', label: 'Player Defense Damage Rate', group: 'Combat', help: 'Scales incoming damage to players. Lower values make players sturdier; higher values make combat more punishing.' },
  { key: 'DayTimeSpeedRate', label: 'Day Length Rate', group: 'Time and Survival', help: 'Daytime speed multiplier. Lower values make daytime last longer.' },
  { key: 'NightTimeSpeedRate', label: 'Night Length Rate', group: 'Time and Survival', help: 'Nighttime speed multiplier. Lower values make nights last longer.' },
  { key: 'WorkSpeedRate', label: 'Work Speed Rate', group: 'Bases and Work', help: 'Work speed multiplier. Higher values make base work faster.' },
  { key: 'DropItemMaxNum', label: 'Max Dropped Items', group: 'Performance Limits', help: 'Maximum dropped items in the world. Higher values preserve more drops but can hurt performance.' },
  { key: 'BaseCampMaxNum', label: 'Max Base Camps', group: 'Bases and Work', help: 'Total bases allowed on the server.' },
  { key: 'BaseCampWorkerMaxNum', label: 'Max Workers Per Base', group: 'Bases and Work', help: 'Maximum Pals assigned to one base. Higher values make busier bases but add server load.' },
  { key: 'GuildPlayerMaxNum', label: 'Max Guild Size', group: 'Identity and Access', help: 'Maximum players in a guild.' },
  { key: 'AutoSaveSpan', label: 'Auto-Save Interval (minutes)', group: 'Saving and Backups', help: 'Minutes between automatic saves. Shorter intervals reduce rollback risk but increase disk activity.' },
  { key: 'bIsUseBackupSaveData', label: 'Keep Save Backups', group: 'Saving and Backups', help: 'Palworld keeps rotating save backups. Useful for recovery, but uses more disk activity and storage.' },
  { key: 'RESTAPIEnabled', label: 'REST API Enabled', group: 'Local API', help: 'Palwarden needs this on for status checks, saves, announcements, player actions, and graceful stops.' },
  { key: 'RESTAPIPort', label: 'REST API Port', group: 'Local API', help: 'Port used by Palworld management calls on this machine. Keep it private behind Palwarden.' },
];

const ADVANCED_META: Record<string, Omit<FieldMeta, 'key'>> = {
  CrossplayPlatforms: { label: 'Crossplay Platforms', group: 'Identity and Access', options: OPTIONS.CrossplayPlatforms!, help: 'Which client platforms may connect.' },
  LogFormatType: { label: 'Log Format', group: 'Local API', options: OPTIONS.LogFormatType!, help: 'Text is easier to read. JSON is better for external log tools.' },
  RandomizerType: { label: 'Pal Randomizer Mode', group: 'World Rules', options: OPTIONS.RandomizerType!, help: 'Controls Pal spawn randomization.' },
  bIsRandomizerPalLevelRandom: { label: 'Randomize Pal Levels', group: 'World Rules', help: 'Allows randomized wild Pals to have randomized levels.' },
  bEnableFastTravel: { label: 'Fast Travel Enabled', group: 'World Rules', help: 'Allows normal fast travel.' },
  bEnableFastTravelOnlyBaseCamp: { label: 'Fast Travel Only Between Bases', group: 'World Rules', help: 'Restricts fast travel to base camps.' },
  bShowPlayerList: { label: 'Show Player List', group: 'Identity and Access', help: 'Shows the player list in Palworld menus.' },
  bAllowClientMod: { label: 'Allow Client Mods', group: 'Mods and Compatibility', help: 'Allows clients with mods enabled to join.' },
  bEnableInvaderEnemy: { label: 'Enable Invaders', group: 'World Density', help: 'Enables invader events.' },
  bEnableVoiceChat: { label: 'Voice Chat Enabled', group: 'Identity and Access', help: 'Enables in-game voice chat.' },
  BaseCampMaxNumInGuild: { label: 'Max Bases Per Guild', group: 'Bases and Work', help: 'Maximum bases one guild can own.' },
  CollectionDropRate: { label: 'Gathering Drop Rate', group: 'Progression', help: 'Gathered item amount multiplier.' },
  EnemyDropItemRate: { label: 'Enemy Drop Rate', group: 'Progression', help: 'Enemy drop quantity multiplier.' },
  PalEggDefaultHatchingTime: { label: 'Egg Hatching Time (hours)', group: 'Progression', help: 'Huge Egg hatch time in hours.' },
  SupplyDropSpan: { label: 'Supply Drop Interval (minutes)', group: 'World Density', help: 'Minutes between meteorite or supply-drop events.' },
  BuildObjectDamageRate: { label: 'Structure Damage Rate', group: 'Combat', help: 'Damage dealt to buildings.' },
  BuildObjectDeteriorationDamageRate: { label: 'Building Decay Rate', group: 'Bases and Work', help: 'Building decay speed.' },
  ItemWeightRate: { label: 'Item Weight Rate', group: 'Time and Survival', help: 'Item weight multiplier.' },
  ServerReplicatePawnCullDistance: { label: 'Pal Sync Distance', group: 'Performance Limits', help: 'Distance for syncing Pals to players. Higher values cost performance.' },
  MaxBuildingLimitNum: { label: 'Max Buildings Per Player', group: 'Performance Limits', help: 'Per-player building cap. Zero often means unlimited.' },
  PhysicsActiveDropItemMaxNum: { label: 'Max Physics Items', group: 'Performance Limits', help: 'Maximum dropped items using physics behavior.' },
  RandomizerSeed: { label: 'Randomizer Seed', group: 'World Rules', help: 'Seed for spawn randomization. Blank keeps it random.' },
};

const POPULAR_META = new Map(POPULAR_FIELDS.map((field) => [field.key, field]));
const POPULAR_ORDER = new Map(POPULAR_FIELDS.map((field, index) => [field.key, index]));
const MANAGED_ELSEWHERE = new Set(['PublicPort', 'PublicIP', 'RCONEnabled', 'RCONPort', 'QueryPort']);

@Injectable()
export class PalworldSettingsFileService {
  configPath(installDirectory: string): string {
    return join(installDirectory, 'Pal', 'Saved', 'Config', 'WindowsServer', 'PalWorldSettings.ini');
  }

  saveDirectory(installDirectory: string): string {
    return join(installDirectory, 'Pal', 'Saved');
  }

  async writeInitialSettings(installDirectory: string, settings: InitialPalworldSettings): Promise<string> {
    const configPath = this.configPath(installDirectory);
    const text = await this.readLiveOrTemplate(installDirectory);
    const match = OPTION_LINE.exec(text);
    let body = match?.[1] ?? '';

    body = this.setField(body, 'ServerName', this.quote(settings.serverName));
    body = this.setField(body, 'PublicPort', String(settings.gamePort));
    body = this.setField(body, 'QueryPort', String(settings.queryPort));
    body = this.setField(body, 'RESTAPIEnabled', 'True');
    body = this.setField(body, 'RESTAPIPort', String(settings.restApiPort));
    body = this.setField(body, 'AdminPassword', this.quote(settings.adminPassword));
    body = this.setField(body, 'ServerPlayerMaxNum', String(settings.maxPlayers));
    if (settings.serverPassword !== undefined) {
      body = this.setField(body, 'ServerPassword', this.quote(settings.serverPassword));
    }

    await this.writeBody(configPath, text, match, body);
    return configPath;
  }

  async readConfigEntries(configPath: string): Promise<PalworldConfigEntry[]> {
    const text = await readFile(configPath, 'utf8');
    const body = OPTION_LINE.exec(text)?.[1] ?? '';
    const rawEntries = this.parseOptionBody(body);
    const fileOrder = new Map(rawEntries.map(([key], index) => [key, index]));
    return rawEntries
      .filter(([key]) => !MANAGED_ELSEWHERE.has(key))
      .map(([key, rawValue]) => this.toEntry(key, rawValue))
      .sort((a, b) => {
        const popularRank = Number(!a.popular) - Number(!b.popular);
        if (popularRank !== 0) return popularRank;
        if (a.popular && b.popular) return (POPULAR_ORDER.get(a.key) ?? 0) - (POPULAR_ORDER.get(b.key) ?? 0);
        return (fileOrder.get(a.key) ?? 0) - (fileOrder.get(b.key) ?? 0);
      });
  }

  async updateConfigEntries(configPath: string, values: Record<string, string | number | boolean>): Promise<void> {
    const text = await readFile(configPath, 'utf8');
    const match = OPTION_LINE.exec(text);
    let body = match?.[1] ?? '';
    const rawEntries = new Map(this.parseOptionBody(body));
    for (const [key, value] of Object.entries(values)) {
      const existing = rawEntries.get(key);
      const type = existing ? this.inferType(existing) : this.inferValueType(value);
      body = this.setField(body, key, this.encodeValue(value, type));
    }
    await this.writeBody(configPath, text, match, body);
  }

  private toEntry(key: string, rawValue: string): PalworldConfigEntry {
    const type = this.inferType(rawValue);
    const popular = POPULAR_META.has(key);
    const meta = POPULAR_META.get(key) ?? (ADVANCED_META[key] ? { key, ...ADVANCED_META[key] } : null);
    const sensitive = Boolean(meta?.sensitive) || this.isSensitive(key);
    const value = sensitive ? '' : this.decodeValue(rawValue, type);
    return {
      key,
      value,
      type,
      label: meta?.label ?? this.humanizeKey(key),
      description: meta?.description ?? null,
      help: meta?.help ?? this.defaultHelp(type),
      group: meta?.group ?? this.groupForKey(key),
      options: meta?.options ?? null,
      sensitive,
      configured: rawValue !== '""' && rawValue !== '',
      popular,
    };
  }

  private async readLiveOrTemplate(installDirectory: string): Promise<string> {
    const live = this.configPath(installDirectory);
    if (await this.exists(live)) {
      return readFile(live, 'utf8');
    }
    const template = join(installDirectory, 'DefaultPalWorldSettings.ini');
    if (await this.exists(template)) {
      return readFile(template, 'utf8');
    }
    return '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=()\n';
  }

  private async writeBody(configPath: string, text: string, match: RegExpExecArray | null, body: string): Promise<void> {
    const nextLine = `OptionSettings=(${body})`;
    const next = match ? text.slice(0, match.index) + nextLine + text.slice(match.index + match[0].length) : `${text.trimEnd()}\n${nextLine}\n`;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, next, 'utf8');
  }

  private setField(body: string, key: string, value: string): string {
    const pattern = new RegExp(`(?:^|(?<=[,(]))${this.escapeRegExp(key)}=(?:"[^"]*"|\\([^)]*\\)|[^,()]*)`);
    if (pattern.test(body)) {
      return body.replace(pattern, `${key}=${value}`);
    }
    return body ? `${body.replace(/\s+$/, '')},${key}=${value}` : `${key}=${value}`;
  }

  private parseOptionBody(body: string): Array<[string, string]> {
    const entries: Array<[string, string]> = [];
    let current = '';
    let inQuote = false;
    let depth = 0;
    for (const char of body) {
      if (char === '"') {
        inQuote = !inQuote;
      } else if (!inQuote && (char === '(' || char === '[')) {
        depth += 1;
      } else if (!inQuote && (char === ')' || char === ']')) {
        depth -= 1;
      }
      if (char === ',' && !inQuote && depth === 0) {
        this.pushEntry(entries, current);
        current = '';
      } else {
        current += char;
      }
    }
    this.pushEntry(entries, current);
    return entries;
  }

  private pushEntry(entries: Array<[string, string]>, text: string): void {
    const index = text.indexOf('=');
    if (index <= 0) return;
    entries.push([text.slice(0, index).trim(), text.slice(index + 1).trim()]);
  }

  private inferType(rawValue: string): PalworldConfigFieldType {
    if (rawValue === 'True' || rawValue === 'False') return 'bool';
    if (/^-?\d+$/.test(rawValue)) return 'int';
    if (/^-?\d+\.\d+$/.test(rawValue)) return 'float';
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) return 'string';
    if (rawValue.startsWith('(') && rawValue.endsWith(')')) return 'raw';
    return rawValue ? 'enum' : 'string';
  }

  private inferValueType(value: string | number | boolean): PalworldConfigFieldType {
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
    if (/^(true|false)$/i.test(value)) return 'bool';
    if (/^-?\d+$/.test(value)) return 'int';
    if (/^-?\d+\.\d+$/.test(value)) return 'float';
    return 'string';
  }

  private decodeValue(rawValue: string, type: PalworldConfigFieldType): string | number | boolean {
    if (type === 'bool') return rawValue === 'True';
    if (type === 'int') return Number.parseInt(rawValue, 10);
    if (type === 'float') return Number.parseFloat(rawValue);
    if (type === 'string') return rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;
    return rawValue;
  }

  private encodeValue(value: string | number | boolean, type: PalworldConfigFieldType): string {
    if (type === 'bool') return value === true || String(value).toLowerCase() === 'true' ? 'True' : 'False';
    if (type === 'int') return String(Number.parseInt(String(value || 0), 10));
    if (type === 'float') return String(Number.parseFloat(String(value || 0)));
    if (type === 'string') return this.quote(String(value));
    return String(value);
  }

  private defaultHelp(type: PalworldConfigFieldType): string {
    if (type === 'bool') return 'Enable or disable this Palworld setting.';
    if (type === 'int') return 'Whole-number Palworld setting. The exact meaning depends on the setting.';
    if (type === 'float') return 'Decimal multiplier. Common examples: 0.5 is half, 1 is normal, 2 is double.';
    if (type === 'raw') return 'Advanced Palworld value. Preserve the punctuation and grouping unless you know the exact format expected by the server.';
    return 'Text value saved back into PalWorldSettings.ini.';
  }

  private groupForKey(key: string): string {
    if (key.includes('Damage') || key.includes('PvP')) return 'Combat';
    if (key.includes('BaseCamp') || key.includes('Build') || key.includes('Work')) return 'Bases and Work';
    if (key.includes('Drop') || key.includes('Spawn') || key.includes('Invader')) return 'World Density';
    if (key.includes('Rate') || key.includes('Exp') || key.includes('Egg') || key.includes('Technology')) return 'Progression';
    if (key.includes('Time') || key.includes('Stamina') || key.includes('Stomach') || key.includes('HPRegene')) return 'Time and Survival';
    if (key.includes('Password') || key.includes('Player') || key.includes('Guild') || key.includes('Server') || key.includes('VoiceChat')) return 'Identity and Access';
    if (key.includes('Save') || key.includes('Backup')) return 'Saving and Backups';
    if (key.includes('REST') || key.includes('RCON') || key.includes('Log')) return 'Local API';
    return 'Other';
  }

  private humanizeKey(key: string): string {
    const stripped = key.startsWith('b') && key.length > 1 && /[A-Z]/.test(key[1] ?? '') ? key.slice(1) : key;
    return stripped.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, ' ');
  }

  private isSensitive(key: string): boolean {
    return key.toLowerCase().includes('password');
  }

  private quote(value: string): string {
    return `"${value.replace(/"/g, '')}"`;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async exists(path: string): Promise<boolean> {
    return Boolean(await stat(path).catch(() => null));
  }
}
