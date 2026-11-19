import {
    App,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    SecretComponent,
    Setting,
    TFile,
} from 'obsidian';
import { summarizeDay, SummaryError } from './time-summary.mjs';

function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return [hours, minutes, seconds % 60]
        .map((value) => String(value).padStart(2, '0'))
        .join(':');
}

function localDate(): string {
    const today = new Date();

    return [today.getFullYear(), today.getMonth() + 1, today.getDate()]
        .map((value) => String(value).padStart(2, '0'))
        .join('-');
}

class SummaryDateModal extends Modal {
    constructor(
        app: App,
        private readonly onSelect: (date: string) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle('Create a TimeLodge daily summary');
        const form = this.contentEl.createEl('form');
        const label = form.createEl('label', { text: 'Time entry date ' });
        const date = label.createEl('input', { type: 'date' });
        date.value = localDate();
        date.required = true;
        form.createEl('button', {
            text: 'Create or open summary',
            type: 'submit',
        });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const selection = date.value;
            this.close();
            this.onSelect(selection);
        });
        date.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export default class TimeLodgeSummaryPlugin extends Plugin {
    private secretName = '';
    private pending = false;
    private enabled = false;

    async onload(): Promise<void> {
        const settings: unknown = await this.loadData();
        if (
            settings &&
            typeof settings === 'object' &&
            'secretName' in settings &&
            typeof settings.secretName === 'string'
        ) {
            this.secretName = settings.secretName;
        }

        this.enabled = true;
        this.addSettingTab(new TimeLodgeSummarySettings(this.app, this));
        this.addCommand({
            id: 'create-daily-summary',
            name: 'Create daily summary',
            callback: () => {
                new SummaryDateModal(this.app, (date) => {
                    void this.createSummary(date).catch((error: unknown) => {
                        new Notice(
                            error instanceof SummaryError
                                ? error.message
                                : 'Could not create or open the TimeLodge summary. Check the vault and try again.',
                        );
                    });
                }).open();
            },
        });
    }

    onunload(): void {
        this.enabled = false;
        this.secretName = '';
    }

    getSecretName(): string {
        return this.secretName;
    }

    async setSecretName(secretName: string): Promise<void> {
        this.secretName = secretName;
        await this.saveData({ secretName });
    }

    async createSummary(date: string): Promise<void> {
        if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) {
            throw new SummaryError('Choose a valid time entry date.');
        }
        if (this.pending) {
            throw new SummaryError(
                'A TimeLodge summary is already being prepared.',
            );
        }
        const path = `TimeLodge ${date}.md`;
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            await this.app.workspace.getLeaf(false).openFile(existing);
            return;
        }
        if (existing) {
            throw new SummaryError(
                'A folder already uses the TimeLodge summary name.',
            );
        }

        const secretName = this.secretName;
        const token = secretName
            ? this.app.secretStorage.getSecret(secretName)
            : null;
        if (!token) {
            throw new SummaryError(
                'Select a TimeLodge workspace token in the plugin settings.',
            );
        }

        this.pending = true;
        try {
            const summary = await summarizeDay(date, token);
            if (
                !this.enabled ||
                this.secretName !== secretName ||
                this.app.secretStorage.getSecret(secretName) !== token
            ) {
                return;
            }

            const note = [
                `# TimeLodge summary for ${date}`,
                '',
                `- Time entries: ${summary['entry-count']}`,
                `- Recorded time: ${formatDuration(summary['recorded-seconds'])}`,
                `- Billable time: ${formatDuration(summary['billable-seconds'])}`,
                '',
            ].join('\n');
            const file = await this.app.vault.create(path, note);
            await this.app.workspace.getLeaf(false).openFile(file);
        } finally {
            this.pending = false;
        }
    }
}

class TimeLodgeSummarySettings extends PluginSettingTab {
    constructor(
        app: App,
        private readonly plugin: TimeLodgeSummaryPlugin,
    ) {
        super(app, plugin);
    }

    display(): void {
        this.containerEl.empty();
        new Setting(this.containerEl)
            .setName('TimeLodge workspace token')
            .setDesc(
                'Select a dedicated workspace service token with time:read access.',
            )
            .addComponent((element) =>
                new SecretComponent(this.app, element)
                    .setValue(this.plugin.getSecretName())
                    .onChange((value) =>
                        this.plugin.setSecretName(value ?? ''),
                    ),
            );
        new Setting(this.containerEl)
            .setName('Disconnect TimeLodge')
            .setDesc(
                'Remove this plugin’s token selection. Revoke the token in TimeLodge to disable it.',
            )
            .addButton((button) =>
                button.setButtonText('Disconnect').onClick(async () => {
                    await this.plugin.setSecretName('');
                    this.display();
                    new Notice('TimeLodge disconnected.');
                }),
            );
    }
}
