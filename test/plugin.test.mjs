import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const bundle = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const date = '2026-11-18';
const notePath = `TimeLodge ${date}.md`;

class TestFile {
    constructor(path, contents) {
        this.path = path;
        this.contents = contents;
    }
}

async function loadPlugin(request, token = 'synthetic-read-token') {
    const files = new Map();
    const opened = [];
    const saved = [];
    const app = {
        vault: {
            getAbstractFileByPath: (path) => files.get(path),
            create: async (path, contents) => {
                assert.equal(files.has(path), false);
                const file = new TestFile(path, contents);
                files.set(path, file);
                return file;
            },
        },
        workspace: {
            getLeaf: () => ({
                openFile: async (file) => opened.push(file.path),
            }),
        },
        secretStorage: {
            getSecret: (name) => (name === 'daily-summary' ? token : null),
        },
    };

    class TestPlugin {
        app = app;
        loadData = async () => ({ secretName: 'daily-summary' });
        saveData = async (settings) => saved.push(settings);
        addSettingTab() {}
        addCommand(command) {
            this.command = command;
        }
    }

    const module = { exports: {} };
    runInNewContext(bundle, {
        module,
        require: (name) => {
            assert.equal(name, 'obsidian');
            return {
                Modal: class {},
                Plugin: TestPlugin,
                PluginSettingTab: class {},
                TFile: TestFile,
            };
        },
        URL,
        URLSearchParams,
        AbortSignal,
        fetch: request,
    });
    const plugin = new module.exports.default();
    await plugin.onload();
    assert.equal(plugin.command.id, 'create-daily-summary');
    return { plugin, files, opened, saved };
}

function page(entries, currentPage = 1, total = entries.length) {
    return Response.json({
        data: entries,
        meta: {
            current_page: currentPage,
            per_page: 100,
            last_page: Math.max(1, Math.ceil(total / 100)),
            total,
        },
    });
}

test('compiled plugin reads once and creates only an aggregate note', async () => {
    let requests = 0;
    const { plugin, files, opened } = await loadPlugin(async (url, options) => {
        requests += 1;
        assert.equal(url.origin, 'https://timelodge.com');
        assert.equal(url.pathname, '/api/v1/time-entries');
        assert.equal(url.searchParams.get('entry_date'), date);
        assert.equal(url.searchParams.get('per_page'), '100');
        assert.equal(options.method, 'GET');
        assert.equal(
            options.headers.Authorization,
            'Bearer synthetic-read-token',
        );
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');

        return page([
            {
                id: 'entry-a',
                duration_seconds: 1800,
                billable: true,
                notes: 'private project note',
            },
            { id: 'entry-b', duration_seconds: 600, billable: false },
        ]);
    });
    await plugin.createSummary(date);
    assert.equal(
        files.get(notePath).contents,
        '# TimeLodge summary for 2026-11-18\n\n- Time entries: 2\n- Recorded time: 00:40:00\n- Billable time: 00:30:00\n',
    );
    files.get(notePath).contents = 'User edits';
    await plugin.createSummary(date);
    assert.equal(files.get(notePath).contents, 'User edits');
    assert.equal(requests, 1);
    assert.deepEqual(opened, [notePath, notePath]);
});

test('reads all pages and rejects a duplicated entry', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        duration_seconds: 60,
        billable: true,
    }));
    const pages = [];
    const { plugin, files } = await loadPlugin(async (url) => {
        const current = Number(url.searchParams.get('page'));
        pages.push(current);
        return current === 1 ? page(first, 1, 101) : page([first[0]], 2, 101);
    });
    await assert.rejects(plugin.createSummary(date), /duplicate/);
    assert.deepEqual(pages, [1, 2]);
    assert.equal(files.size, 0);
});

test('disconnect during a read clears the reference and prevents note creation', async () => {
    let finish;
    const delayed = new Promise((resolve) => {
        finish = resolve;
    });
    const { plugin, files, saved } = await loadPlugin(() => delayed);
    const running = plugin.createSummary(date);
    await assert.rejects(plugin.createSummary(date), /already being prepared/);
    await plugin.setSecretName('');
    finish(page([]));
    await running;
    await assert.rejects(plugin.createSummary(date), /Select a TimeLodge/);
    assert.equal(JSON.stringify(saved), '[{"secretName":""}]');
    assert.equal(files.size, 0);
});

test('authentication and rate-limit responses give safe recovery instructions', async () => {
    const replies = [
        new Response('synthetic-read-token', { status: 401 }),
        new Response('synthetic-read-token', {
            status: 429,
            headers: { 'Retry-After': '60' },
        }),
    ];
    const { plugin, files } = await loadPlugin(async () => replies.shift());
    await assert.rejects(
        plugin.createSummary(date),
        /denied access.*time:read/,
    );
    await assert.rejects(plugin.createSummary(date), /rate limit.*60 seconds/);
    assert.equal(files.size, 0);
});

test('rejects an invalid date before requesting data', async () => {
    const { plugin, files } = await loadPlugin(async () =>
        assert.fail('No request expected'),
    );
    await assert.rejects(
        plugin.createSummary('2026-11-31'),
        /valid TimeLodge entry date/,
    );
    assert.equal(files.size, 0);
});

const localOrigin = process.env.TIMELODGE_TEST_ORIGIN;
const fixtureToken = process.env.TIMELODGE_LOCAL_FIXTURE_TOKEN;
test(
    'compiled plugin creates the expected note through the isolated local TimeLodge API',
    { skip: !localOrigin },
    async () => {
        assert.match(localOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.match(fixtureToken, /^synthetic-[\da-f]{48}$/);
        const { plugin, files } = await loadPlugin(async (url, options) => {
            assert.equal(url.origin, 'https://timelodge.com');
            return fetch(localOrigin + url.pathname + url.search, options);
        }, fixtureToken);
        await plugin.createSummary(date);
        assert.equal(
            files.get(notePath).contents,
            '# TimeLodge summary for 2026-11-18\n\n- Time entries: 2\n- Recorded time: 00:40:00\n- Billable time: 00:30:00\n',
        );
    },
);
