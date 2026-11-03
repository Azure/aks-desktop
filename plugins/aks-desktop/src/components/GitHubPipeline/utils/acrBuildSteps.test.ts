// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { generateAcrBuildSteps } from './acrBuildSteps';
import { getAcrBuildFiles } from './acrTasks/acrTaskRunner';

it.each([0, 1])(
  'launches emitted step %i without checkout or environment module shadowing',
  index => {
    const directory = mkdtempSync(join(tmpdir(), 'aksd-acr-launch-'));
    try {
      for (const [file, content] of Object.entries(getAcrBuildFiles())) {
        mkdirSync(dirname(join(directory, file)), { recursive: true });
        writeFileSync(join(directory, file), content);
      }
      const scripts = join(directory, '.github/scripts');
      const poison = 'raise RuntimeError("checkout module was imported")\n';
      writeFileSync(join(scripts, 'email.py'), poison);
      writeFileSync(join(directory, 'json.py'), poison);
      mkdirSync(join(directory, 'pythonpath'));
      writeFileSync(join(directory, 'pythonpath/email.py'), poison);
      const steps = generateAcrBuildSteps({
        acrName: 'registry',
        containerName: 'app',
        dockerfilePath: 'Dockerfile',
        buildContextPath: '.',
      });
      const [exec, binary, ...args] = String(steps[index].run).trim().split(/\s+/);
      expect(exec).toBe('exec');
      expect(binary).toBe('python3');
      expect(args[0]).toBe('-I');
      const result = spawnSync(binary, args, {
        cwd: directory,
        env: {
          ...process.env,
          RUNNER_TEMP: directory,
          GITHUB_WORKSPACE: directory,
          PYTHONPATH: join(directory, 'pythonpath'),
          AZURE_ACR_RESOURCE_ID: '',
          AZURE_CONTAINER_REGISTRY: '',
          AZURE_SUBSCRIPTION_ID: '',
          CONTAINER_NAME: '',
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).not.toMatch(/checkout module|ModuleNotFoundError|Traceback/);
      if (index === 0) {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Missing required input');
      } else {
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
      }
      const unsafe = spawnSync(
        binary,
        args.filter(argument => argument !== '-I'),
        {
          cwd: directory,
          env: { ...process.env, RUNNER_TEMP: directory, GITHUB_WORKSPACE: directory },
          encoding: 'utf8',
          timeout: 10_000,
        }
      );
      expect(unsafe.error).toBeUndefined();
      expect(unsafe.status).toBe(1);
      expect(unsafe.stderr).toContain('checkout module was imported');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
);
