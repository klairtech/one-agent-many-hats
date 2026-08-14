/**
 * `hats init` — cold start (paper §5.1).
 *
 * Two jobs. First, connect a model: pick a provider, list its models live (never guessed
 * from a table that may be stale), bind the three tiers. Second, structured elicitation:
 * "onboarding is an interview, not an empty text box" — the agent asks, drafts the
 * workspace context document, and the human confirms or corrects it.
 */

import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type HatsConfig,
  type ProviderConfig,
  type Tier,
} from '../core/config.js';
import { hatsHome } from '../core/paths.js';
import { PRESETS, type ProviderPreset } from '../core/presets.js';
import { createProvider } from '../providers/index.js';
import { syncPacks } from '../registry/loader.js';
import { OrgContext } from '../memory/index.js';
import { workspaceDir, workspaceSlug } from '../core/paths.js';
import { out, paint, type Prompter } from './render.js';

const INTERVIEW: Array<{ key: string; heading: string; question: string }> = [
  {
    key: 'what',
    heading: 'What this project is',
    question: 'In one or two sentences, what is this project? (enter to skip)',
  },
  {
    key: 'terms',
    heading: 'Terminology and conventions',
    question: 'Any words that mean something specific here, and what they mean?',
  },
  {
    key: 'howWork',
    heading: 'How I want work done',
    question:
      'How should the agent work? (e.g. "ask before assuming", "always run npm test", "keep answers short")',
  },
  {
    key: 'sensitive',
    heading: 'Sensitivities',
    question: 'Anything it should treat carefully or never touch?',
  },
  {
    key: 'standing',
    heading: 'Standing instructions',
    question: 'Anything that applies to every run in this workspace?',
  },
];

export async function runInit(prompter: Prompter, workspaceRoot: string): Promise<void> {
  out.heading('hats init');
  out.dim(`home: ${hatsHome()}`);
  out.dim(`workspace: ${workspaceRoot}`);

  const config = await loadConfig();
  await syncPacks();

  // --- 1. provider ---
  out.heading('1. Connect a model');
  const presets = Object.values(PRESETS).filter((p) => p.kind !== 'mock');
  presets.forEach((p, i) => {
    const key = p.apiKeyEnv ? (process.env[p.apiKeyEnv] ? paint('key set', 'green') : paint(`needs ${p.apiKeyEnv}`, 'grey')) : paint('no key needed', 'green');
    out.line(`  ${String(i + 1).padStart(2)}. ${p.label.padEnd(46)} ${key}`);
  });

  const pick = await prompter.question('\nWhich provider? (number, or enter for Ollama) ');
  const preset = pick ? presets[Number(pick) - 1] : PRESETS['ollama'];
  if (!preset) {
    out.fail('no such option');
    return;
  }

  const providerConfig = await configureProvider(preset, prompter);
  config.providers[preset.id] = providerConfig;
  config.defaultProvider = preset.id;

  // --- 2. models, listed live ---
  out.heading('2. Choose models');
  let models: string[] = [];
  try {
    const provider = createProvider(preset.id, providerConfig);
    models = (await provider.listModels()).map((m) => m.id);
    if (models.length === 0) out.warn('the provider returned no models');
  } catch (e) {
    out.warn(`could not list models: ${(e as Error).message}`);
    out.dim('You can type model ids by hand instead.');
  }

  if (models.length > 0) {
    models.slice(0, 40).forEach((m, i) => out.line(`  ${String(i + 1).padStart(2)}. ${m}`));
    if (models.length > 40) out.dim(`  … and ${models.length - 40} more`);
  }

  out.line('');
  out.dim(
    'Three tiers (paper §2.2): light for extraction, standard for ordinary work, frontier for judgement.',
  );
  out.dim('One model for all three is fine — enter the same number, or press enter to reuse.');

  const tiers: Tier[] = ['light', 'standard', 'frontier'];
  let last = '';
  for (const tier of tiers) {
    const answer = await prompter.question(
      `  ${tier.padEnd(9)} ${last ? `[enter = ${last}] ` : ''}`,
    );
    const chosen = resolveModelChoice(answer, models, last);
    if (!chosen) {
      out.warn(`no model set for ${tier}`);
      continue;
    }
    config.tiers[tier] = `${preset.id}/${chosen}`;
    last = chosen;
  }

  // --- 3. profile ---
  out.heading('3. Execution profile');
  out.dim('read-only  reads, searches, computes. Worst case: a wrong answer that shows its work.');
  out.dim('assisted   adds file writes and commands, each one approved by you at the moment it runs.');
  out.dim('trusted    same surface, approval pre-granted for the session. Everything still audited.');
  const profileAnswer = await prompter.question('\nProfile [read-only] ');
  if (profileAnswer === 'assisted' || profileAnswer === 'trusted') config.profile = profileAnswer;

  await saveConfig(config);
  out.ok(`config written to ${hatsHome()}/config.json`);

  // --- 4. elicitation ---
  out.heading('4. Tell the agent about this workspace');
  out.dim('Authored context outranks anything the system infers. Skip anything you would rather not state.');
  const doInterview = await prompter.confirm('\nAnswer five short questions now?', true);

  const org = OrgContext.forWorkspace(workspaceDir(workspaceSlug(workspaceRoot)));
  if (doInterview) {
    const answers: Array<{ heading: string; text: string }> = [];
    for (const q of INTERVIEW) {
      const a = await prompter.question(`\n  ${q.question}\n  > `);
      if (a) answers.push({ heading: q.heading, text: a });
    }
    if (answers.length > 0) {
      const doc = ['# Workspace context', '', ...answers.flatMap((a) => [`## ${a.heading}`, '', a.text, ''])].join('\n');
      out.heading('Draft');
      out.line(doc);
      const confirmed = await prompter.confirm('Save this? (you can edit the file any time)', true);
      if (confirmed) {
        await org.write(doc);
        out.ok(`workspace context written to ${org.path}`);
      }
    } else {
      await org.ensureTemplate();
      out.dim(`empty template left at ${org.path}`);
    }
  } else {
    await org.ensureTemplate();
    out.dim(`template left at ${org.path} — fill it in whenever you like`);
  }

  out.heading('Ready');
  out.line(`  ${paint('hats', 'bold')} "how is this project laid out?"`);
  out.line(`  ${paint('hats', 'bold')}                      # interactive session`);
  out.line(`  ${paint('hats doctor', 'bold')}               # check the setup`);
}

async function configureProvider(
  preset: ProviderPreset,
  prompter: Prompter,
): Promise<ProviderConfig> {
  const base = await prompter.question(`  base URL [${preset.baseUrl}] `);
  const cfg: ProviderConfig = {
    kind: preset.kind,
    baseUrl: base || preset.baseUrl,
    toolProtocol: 'auto',
    ...(preset.modelsPath ? { modelsPath: preset.modelsPath } : {}),
    ...(preset.apiKeyEnv ? { apiKeyEnv: preset.apiKeyEnv } : {}),
  };

  if (preset.apiKeyEnv && !process.env[preset.apiKeyEnv]) {
    out.warn(`${preset.apiKeyEnv} is not set in this shell.`);
    out.dim(
      `hats reads the key from the environment and never writes it to config.json. Set it with:  export ${preset.apiKeyEnv}=...`,
    );
  }
  if (preset.note) out.dim(`  note: ${preset.note}`);
  return cfg;
}

function resolveModelChoice(answer: string, models: string[], fallback: string): string | undefined {
  if (!answer) return fallback || models[0];
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= models.length) return models[index - 1];
  return answer;
}

export function defaultConfigForOllama(): HatsConfig {
  return structuredClone(DEFAULT_CONFIG);
}
