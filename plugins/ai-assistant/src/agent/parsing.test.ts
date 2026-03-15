import { beforeAll, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { parseKubernetesYAML } from '../utils/SampleYamlLibrary';
import { _testing } from './aksAgentManager';

const {
  stripAnsi,
  normalizeBullets,
  looksLikeYaml,
  wrapBareYamlBlocks,
  wrapBareCodeBlocks,
  cleanTerminalFormatting,
  collapseTerminalBlankLines,
  stripAgentNoise,
  isAgentNoiseLine,
  extractAIAnswer,
  ThinkingStepTracker,
  extractTaskRow,
  friendlyToolLabel,
  looksLikeShellOrDockerCodeLine,
  hasShellSyntax,
  normalizeTerminalMarkdown,
} = _testing;

describe('stripAnsi', () => {
  it('removes color escape sequences', () => {
    expect(stripAnsi('\x1b[31mred text\x1b[0m')).toBe('red text');
  });

  it('removes cursor movement sequences', () => {
    expect(stripAnsi('\x1b[2Jhello\x1b[H')).toBe('hello');
  });

  it('removes character set selection', () => {
    expect(stripAnsi('\x1b(Bhello\x1b)0')).toBe('hello');
  });

  it('removes carriage returns', () => {
    expect(stripAnsi('line1\rline2')).toBe('line1line2');
  });

  it('handles text with no ANSI codes', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('removes multiple sequences', () => {
    expect(stripAnsi('\x1b[1m\x1b[32mbold green\x1b[0m')).toBe('bold green');
  });

  it('removes bracketed paste sequences', () => {
    expect(stripAnsi('\x1b[?2004h text \x1b[?2004l')).toBe(' text ');
  });
});

describe('normalizeBullets', () => {
  it('converts bullet character (•) to markdown list', () => {
    expect(normalizeBullets('• item one')).toBe('- item one');
  });

  it('converts middle dot (·) to markdown list', () => {
    expect(normalizeBullets('· item one')).toBe('- item one');
  });

  it('converts black square (▪) to markdown list', () => {
    expect(normalizeBullets('▪ item one')).toBe('- item one');
  });

  it('converts right-pointing triangle (▸) to markdown list', () => {
    expect(normalizeBullets('▸ item one')).toBe('- item one');
  });

  it('converts en-dash (–) to markdown list', () => {
    expect(normalizeBullets('– item one')).toBe('- item one');
  });

  it('preserves leading indentation', () => {
    expect(normalizeBullets('  • nested item')).toBe('  - nested item');
  });

  it('converts multiple bullets', () => {
    const input = '• first\n• second\n  • nested';
    const expected = '- first\n- second\n  - nested';
    expect(normalizeBullets(input)).toBe(expected);
  });

  it('does not convert bullet without trailing space', () => {
    expect(normalizeBullets('•text')).toBe('•text');
  });

  it('does not modify existing markdown list markers', () => {
    expect(normalizeBullets('- existing item')).toBe('- existing item');
  });

  it('handles empty string', () => {
    expect(normalizeBullets('')).toBe('');
  });

  it('handles text with no bullets', () => {
    expect(normalizeBullets('plain text')).toBe('plain text');
  });
});

describe('looksLikeYaml', () => {
  it('identifies key: value pairs', () => {
    expect(looksLikeYaml('name: my-pod')).toBe(true);
  });

  it('identifies keys with dots', () => {
    expect(looksLikeYaml('app.kubernetes.io/name: test')).toBe(true);
  });

  it('identifies keys with slashes', () => {
    expect(looksLikeYaml('kubernetes.io/name: test')).toBe(true);
  });

  it('identifies key with no value', () => {
    expect(looksLikeYaml('metadata:')).toBe(true);
  });

  it('identifies YAML list items', () => {
    expect(looksLikeYaml('- item')).toBe(true);
  });

  it('identifies bare list markers', () => {
    expect(looksLikeYaml('-')).toBe(true);
  });

  it('identifies YAML comments', () => {
    expect(looksLikeYaml('# this is a comment')).toBe(true);
  });

  it('identifies empty lines', () => {
    expect(looksLikeYaml('')).toBe(true);
  });

  it('identifies flow mappings', () => {
    expect(looksLikeYaml('{key: value}')).toBe(true);
  });

  it('identifies flow sequences', () => {
    expect(looksLikeYaml('[1, 2, 3]')).toBe(true);
  });

  it('identifies quoted keys', () => {
    expect(looksLikeYaml('"key with spaces": value')).toBe(true);
  });

  it('rejects plain text sentences', () => {
    expect(looksLikeYaml('This is a sentence about pods.')).toBe(false);
  });

  it('treats markdown headers starting with # as YAML comments', () => {
    // looksLikeYaml treats any line starting with # as a YAML comment
    expect(looksLikeYaml('## Header')).toBe(true);
    expect(looksLikeYaml('# Single')).toBe(true);
  });
});

describe('hasShellSyntax', () => {
  it('detects single-letter flags', () => {
    expect(hasShellSyntax('cat -n file.txt')).toBe(true);
  });
  it('detects long flags', () => {
    expect(hasShellSyntax('npm install --save-dev webpack')).toBe(true);
  });
  it('detects file paths with /', () => {
    expect(hasShellSyntax('cat /etc/passwd')).toBe(true);
  });
  it('detects glob patterns', () => {
    expect(hasShellSyntax('find . -name "*.js"')).toBe(true);
  });
  it('detects pipe operator', () => {
    expect(hasShellSyntax('ps aux | grep node')).toBe(true);
  });
  it('detects && chaining', () => {
    expect(hasShellSyntax('cd /app && make')).toBe(true);
  });
  it('detects output redirection', () => {
    expect(hasShellSyntax('echo hello > out.txt')).toBe(true);
  });
  it('detects 2>&1', () => {
    expect(hasShellSyntax('make build 2>&1')).toBe(true);
  });
  it('detects quoted arguments', () => {
    expect(hasShellSyntax("grep -r 'TODO' src/")).toBe(true);
  });
  it('detects variable references', () => {
    expect(hasShellSyntax('echo $HOME')).toBe(true);
  });
  it('detects backtick substitution', () => {
    expect(hasShellSyntax('echo `date`')).toBe(true);
  });
  it('rejects plain English prose', () => {
    expect(hasShellSyntax('This is a regular sentence.')).toBe(false);
  });
  it('rejects prose with no special syntax', () => {
    expect(hasShellSyntax('sort the results by name')).toBe(false);
  });
});

describe('looksLikeShellOrDockerCodeLine', () => {
  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Dockerfile instructions
  // ──────────────────────────────────────────────────────────────
  it('detects FROM', () => {
    expect(looksLikeShellOrDockerCodeLine('FROM python:3.12-slim')).toBe(true);
  });
  it('detects FROM with AS', () => {
    expect(looksLikeShellOrDockerCodeLine('FROM node:18 AS builder')).toBe(true);
  });
  it('detects RUN', () => {
    expect(looksLikeShellOrDockerCodeLine('RUN pip install -r requirements.txt')).toBe(true);
  });
  it('detects CMD array form', () => {
    expect(looksLikeShellOrDockerCodeLine('CMD ["uvicorn", "main:app"]')).toBe(true);
  });
  it('detects COPY', () => {
    expect(looksLikeShellOrDockerCodeLine('COPY . .')).toBe(true);
  });
  it('detects COPY --from', () => {
    expect(looksLikeShellOrDockerCodeLine('COPY --from=builder /app/dist /app')).toBe(true);
  });
  it('detects WORKDIR', () => {
    expect(looksLikeShellOrDockerCodeLine('WORKDIR /app')).toBe(true);
  });
  it('detects EXPOSE', () => {
    expect(looksLikeShellOrDockerCodeLine('EXPOSE 8000')).toBe(true);
  });
  it('detects ENTRYPOINT', () => {
    expect(looksLikeShellOrDockerCodeLine('ENTRYPOINT ["python", "app.py"]')).toBe(true);
  });
  it('detects ENV', () => {
    expect(looksLikeShellOrDockerCodeLine('ENV NODE_ENV=production')).toBe(true);
  });
  it('detects ARG', () => {
    expect(looksLikeShellOrDockerCodeLine('ARG PYTHON_VERSION=3.12')).toBe(true);
  });
  it('detects HEALTHCHECK', () => {
    expect(looksLikeShellOrDockerCodeLine('HEALTHCHECK CMD curl -f http://localhost/healthz')).toBe(
      true
    );
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Container & orchestration tools
  // ──────────────────────────────────────────────────────────────
  it('detects docker build', () => {
    expect(looksLikeShellOrDockerCodeLine('docker build -t myapp:latest .')).toBe(true);
  });
  it('detects docker run', () => {
    expect(looksLikeShellOrDockerCodeLine('docker run --rm -p 8000:8000 myapp')).toBe(true);
  });
  it('detects docker-compose', () => {
    expect(looksLikeShellOrDockerCodeLine('docker-compose up -d')).toBe(true);
  });
  it('detects kubectl apply', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl apply -f deployment.yaml')).toBe(true);
  });
  it('detects kubectl get', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl get pods -n kube-system')).toBe(true);
  });
  it('detects kubectl describe', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl describe pod my-pod')).toBe(true);
  });
  it('detects kubectl logs', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl logs -f deployment/myapp')).toBe(true);
  });
  it('detects kubectl exec', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl exec -it my-pod -- bash')).toBe(true);
  });
  it('detects kubectl delete', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl delete -f service.yaml')).toBe(true);
  });
  it('detects kubectl port-forward', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl port-forward svc/myapp 8080:80')).toBe(true);
  });
  it('detects kubectl rollout', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl rollout status deployment/myapp')).toBe(true);
  });
  it('detects kubectl scale', () => {
    expect(looksLikeShellOrDockerCodeLine('kubectl scale deployment myapp --replicas=3')).toBe(
      true
    );
  });
  it('detects helm install', () => {
    expect(looksLikeShellOrDockerCodeLine('helm install my-release ./chart')).toBe(true);
  });
  it('detects helm upgrade', () => {
    expect(looksLikeShellOrDockerCodeLine('helm upgrade --install myapp ./charts/myapp')).toBe(
      true
    );
  });
  it('detects podman', () => {
    expect(looksLikeShellOrDockerCodeLine('podman build -t myapp .')).toBe(true);
  });
  it('detects minikube', () => {
    expect(looksLikeShellOrDockerCodeLine('minikube start --driver=docker')).toBe(true);
  });
  it('detects kind', () => {
    expect(looksLikeShellOrDockerCodeLine('kind create cluster --name dev')).toBe(true);
  });
  it('detects stern', () => {
    expect(looksLikeShellOrDockerCodeLine('stern myapp -n production')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Cloud CLIs
  // ──────────────────────────────────────────────────────────────
  it('detects az aks', () => {
    expect(looksLikeShellOrDockerCodeLine('az aks get-credentials --name my-cluster')).toBe(true);
  });
  it('detects az group create', () => {
    expect(looksLikeShellOrDockerCodeLine('az group create --name myRG --location eastus')).toBe(
      true
    );
  });
  it('detects gcloud', () => {
    expect(looksLikeShellOrDockerCodeLine('gcloud container clusters get-credentials')).toBe(true);
  });
  it('detects aws', () => {
    expect(looksLikeShellOrDockerCodeLine('aws eks update-kubeconfig --name my-cluster')).toBe(
      true
    );
  });
  it('detects eksctl', () => {
    expect(looksLikeShellOrDockerCodeLine('eksctl create cluster --name dev')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Language runtimes & package managers
  // ──────────────────────────────────────────────────────────────
  it('detects pip install', () => {
    expect(looksLikeShellOrDockerCodeLine('pip install flask')).toBe(true);
  });
  it('detects pip3', () => {
    expect(looksLikeShellOrDockerCodeLine('pip3 install flask')).toBe(true);
  });
  it('detects python', () => {
    expect(looksLikeShellOrDockerCodeLine('python main.py')).toBe(true);
  });
  it('detects python3', () => {
    expect(looksLikeShellOrDockerCodeLine('python3 -m venv .venv')).toBe(true);
  });
  it('detects npm install', () => {
    expect(looksLikeShellOrDockerCodeLine('npm install')).toBe(true);
  });
  it('detects npm run', () => {
    expect(looksLikeShellOrDockerCodeLine('npm run build')).toBe(true);
  });
  it('detects npx', () => {
    expect(looksLikeShellOrDockerCodeLine('npx create-react-app my-app')).toBe(true);
  });
  it('detects yarn', () => {
    expect(looksLikeShellOrDockerCodeLine('yarn add typescript --dev')).toBe(true);
  });
  it('detects go build', () => {
    expect(looksLikeShellOrDockerCodeLine('go build -o myapp .')).toBe(true);
  });
  it('detects go mod', () => {
    expect(looksLikeShellOrDockerCodeLine('go mod init example.com/myapp')).toBe(true);
  });
  it('detects cargo build', () => {
    expect(looksLikeShellOrDockerCodeLine('cargo build --release')).toBe(true);
  });
  it('detects cargo test', () => {
    expect(looksLikeShellOrDockerCodeLine('cargo test --all')).toBe(true);
  });
  it('detects java', () => {
    expect(looksLikeShellOrDockerCodeLine('java -jar app.jar')).toBe(true);
  });
  it('detects gradle', () => {
    expect(looksLikeShellOrDockerCodeLine('gradle bootRun')).toBe(true);
  });
  it('detects dotnet', () => {
    expect(looksLikeShellOrDockerCodeLine('dotnet run --project ./src/MyApp')).toBe(true);
  });
  it('detects ruby', () => {
    expect(looksLikeShellOrDockerCodeLine('ruby app.rb')).toBe(true);
  });
  it('detects bundle', () => {
    expect(looksLikeShellOrDockerCodeLine('bundle install')).toBe(true);
  });
  it('detects rails', () => {
    expect(looksLikeShellOrDockerCodeLine('rails new myapp --api')).toBe(true);
  });
  it('detects php', () => {
    expect(looksLikeShellOrDockerCodeLine('php artisan migrate')).toBe(true);
  });
  it('detects composer', () => {
    expect(looksLikeShellOrDockerCodeLine('composer require laravel/framework')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Build tools & compilers
  // ──────────────────────────────────────────────────────────────
  it('detects make', () => {
    expect(looksLikeShellOrDockerCodeLine('make build')).toBe(true);
  });
  it('detects cmake', () => {
    expect(looksLikeShellOrDockerCodeLine('cmake -B build -DCMAKE_BUILD_TYPE=Release')).toBe(true);
  });
  it('detects gcc', () => {
    expect(looksLikeShellOrDockerCodeLine('gcc -o main main.c -Wall')).toBe(true);
  });
  it('detects bazel', () => {
    expect(looksLikeShellOrDockerCodeLine('bazel build //src:main')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: General CLI tools
  // ──────────────────────────────────────────────────────────────
  it('detects curl', () => {
    expect(looksLikeShellOrDockerCodeLine('curl -sL https://example.com')).toBe(true);
  });
  it('detects wget', () => {
    expect(looksLikeShellOrDockerCodeLine('wget -O file.tar.gz https://example.com/f.tar.gz')).toBe(
      true
    );
  });
  it('detects git clone', () => {
    expect(looksLikeShellOrDockerCodeLine('git clone https://github.com/user/repo')).toBe(true);
  });
  it('detects git commit', () => {
    expect(looksLikeShellOrDockerCodeLine('git commit -m "initial commit"')).toBe(true);
  });
  it('detects jq', () => {
    expect(looksLikeShellOrDockerCodeLine('jq ".name" package.json')).toBe(true);
  });
  it('detects sed', () => {
    expect(looksLikeShellOrDockerCodeLine("sed -i 's/old/new/g' file.txt")).toBe(true);
  });
  it('detects grep', () => {
    expect(looksLikeShellOrDockerCodeLine('grep -r "TODO" src/')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: File operations (unambiguous)
  // ──────────────────────────────────────────────────────────────
  it('detects mkdir', () => {
    expect(looksLikeShellOrDockerCodeLine('mkdir -p /app/data')).toBe(true);
  });
  it('detects chmod', () => {
    expect(looksLikeShellOrDockerCodeLine('chmod +x deploy.sh')).toBe(true);
  });
  it('detects tar', () => {
    expect(looksLikeShellOrDockerCodeLine('tar -xzf archive.tar.gz')).toBe(true);
  });
  it('detects echo', () => {
    expect(looksLikeShellOrDockerCodeLine('echo "hello world"')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: System administration
  // ──────────────────────────────────────────────────────────────
  it('detects sudo', () => {
    expect(looksLikeShellOrDockerCodeLine('sudo apt-get install nginx')).toBe(true);
  });
  it('detects apt-get', () => {
    expect(looksLikeShellOrDockerCodeLine('apt-get install -y curl')).toBe(true);
  });
  it('detects apt', () => {
    expect(looksLikeShellOrDockerCodeLine('apt update && apt install -y git')).toBe(true);
  });
  it('detects brew', () => {
    expect(looksLikeShellOrDockerCodeLine('brew install node')).toBe(true);
  });
  it('detects systemctl', () => {
    expect(looksLikeShellOrDockerCodeLine('systemctl start nginx')).toBe(true);
  });
  it('detects export', () => {
    expect(looksLikeShellOrDockerCodeLine('export PORT=8080')).toBe(true);
  });
  it('detects ssh', () => {
    expect(looksLikeShellOrDockerCodeLine('ssh user@host')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Infrastructure / CI-CD
  // ──────────────────────────────────────────────────────────────
  it('detects terraform apply', () => {
    expect(looksLikeShellOrDockerCodeLine('terraform apply -auto-approve')).toBe(true);
  });
  it('detects terraform init', () => {
    expect(looksLikeShellOrDockerCodeLine('terraform init')).toBe(true);
  });
  it('detects ansible-playbook', () => {
    expect(looksLikeShellOrDockerCodeLine('ansible-playbook site.yml -i hosts')).toBe(true);
  });
  it('detects vagrant up', () => {
    expect(looksLikeShellOrDockerCodeLine('vagrant up')).toBe(true);
  });
  it('detects gh pr', () => {
    expect(looksLikeShellOrDockerCodeLine('gh pr create --title "Fix bug"')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Database CLIs
  // ──────────────────────────────────────────────────────────────
  it('detects psql', () => {
    expect(looksLikeShellOrDockerCodeLine('psql -U postgres -d mydb')).toBe(true);
  });
  it('detects mysql', () => {
    expect(looksLikeShellOrDockerCodeLine('mysql -u root -p mydb')).toBe(true);
  });
  it('detects redis-cli', () => {
    expect(looksLikeShellOrDockerCodeLine('redis-cli SET key value')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Ambiguous words WITH shell syntax → match
  // ──────────────────────────────────────────────────────────────
  it('detects "cat" with path (ambiguous + shell syntax)', () => {
    expect(looksLikeShellOrDockerCodeLine('cat /etc/nginx/nginx.conf')).toBe(true);
  });
  it('detects "cat" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('cat -n file.txt')).toBe(true);
  });
  it('detects "find" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('find . -name "*.js" -type f')).toBe(true);
  });
  it('detects "find" with path', () => {
    expect(looksLikeShellOrDockerCodeLine('find /var/log -mtime +7')).toBe(true);
  });
  it('detects "sort" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('sort -u -k2 data.csv')).toBe(true);
  });
  it('detects "head" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('head -n 10 access.log')).toBe(true);
  });
  it('detects "tail" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('tail -f /var/log/syslog')).toBe(true);
  });
  it('detects "kill" with signal flag', () => {
    expect(looksLikeShellOrDockerCodeLine('kill -9 1234')).toBe(true);
  });
  it('detects "test" with flag', () => {
    expect(looksLikeShellOrDockerCodeLine('test -f /etc/config.yaml')).toBe(true);
  });
  it('detects "set" with flag', () => {
    expect(looksLikeShellOrDockerCodeLine('set -euo pipefail')).toBe(true);
  });
  it('detects "cp" with path', () => {
    expect(looksLikeShellOrDockerCodeLine('cp config.yaml /etc/app/')).toBe(true);
  });
  it('detects "mv" with path', () => {
    expect(looksLikeShellOrDockerCodeLine('mv old.log /var/archive/')).toBe(true);
  });
  it('detects "rm" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('rm -rf /tmp/build')).toBe(true);
  });
  it('detects "ls" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('ls -la /etc/')).toBe(true);
  });
  it('detects "cd" with && chaining', () => {
    expect(looksLikeShellOrDockerCodeLine('cd /app && npm start')).toBe(true);
  });
  it('detects "watch" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('watch -n 5 kubectl get pods')).toBe(true);
  });
  it('detects "time" with sub-command path', () => {
    expect(looksLikeShellOrDockerCodeLine('time make -j$(nproc)')).toBe(true);
  });
  it('detects "diff" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('diff -u old.txt new.txt')).toBe(true);
  });
  it('detects "host" with argument', () => {
    expect(hasShellSyntax('host example.com')).toBe(false);
    // "host" alone without shell syntax is ambiguous — not matched
    expect(looksLikeShellOrDockerCodeLine('host example.com')).toBe(false);
  });
  it('detects "service" with flags', () => {
    expect(looksLikeShellOrDockerCodeLine('service nginx --status-all')).toBe(true);
  });
  it('detects "env" with variable', () => {
    expect(looksLikeShellOrDockerCodeLine('env NODE_ENV=production node app.js')).toBe(true);
  });
  it('detects "ps" with pipe', () => {
    expect(looksLikeShellOrDockerCodeLine('ps aux | grep node')).toBe(true);
  });
  it('detects "touch" with path', () => {
    expect(looksLikeShellOrDockerCodeLine('touch /tmp/healthcheck')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Ambiguous words WITHOUT shell syntax → no match
  // (This is the key accuracy feature)
  // ──────────────────────────────────────────────────────────────
  it('rejects "cat" as standalone word', () => {
    expect(looksLikeShellOrDockerCodeLine('cat')).toBe(false);
  });
  it('rejects "find" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('find the configuration file')).toBe(false);
  });
  it('rejects "sort" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('sort the results by name')).toBe(false);
  });
  it('rejects "head" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('head over to the documentation')).toBe(false);
  });
  it('rejects "tail" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('tail end of the deployment')).toBe(false);
  });
  it('rejects "kill" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('kill the process manually')).toBe(false);
  });
  it('rejects "test" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('test the application locally')).toBe(false);
  });
  it('rejects "set" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('set up the environment variables')).toBe(false);
  });
  it('rejects "wait" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('wait for the process to complete')).toBe(false);
  });
  it('rejects "watch" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('watch the logs for errors')).toBe(false);
  });
  it('rejects "time" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('time to deploy the application')).toBe(false);
  });
  it('rejects "service" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('service mesh configuration')).toBe(false);
  });
  it('rejects "host" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('host the application on port 8080')).toBe(false);
  });
  it('rejects "date" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('date of the deployment')).toBe(false);
  });
  it('rejects "file" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('file structure overview')).toBe(false);
  });
  it('rejects "read" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('read the documentation first')).toBe(false);
  });
  it('rejects "open" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('open the browser and navigate to')).toBe(false);
  });
  it('rejects "link" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('link to the repository')).toBe(false);
  });
  it('rejects "split" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('split the traffic between versions')).toBe(false);
  });
  it('rejects "join" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('join the two tables on ID')).toBe(false);
  });
  it('rejects "mount" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('mount the volume in the container')).toBe(false);
  });
  it('rejects "top" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('top priority for the next sprint')).toBe(false);
  });
  it('rejects "jobs" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('jobs running in the cluster')).toBe(false);
  });
  it('rejects "env" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('env vars need to be configured')).toBe(false);
  });
  it('rejects "exit" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('exit the application gracefully')).toBe(false);
  });
  it('rejects "cut" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('cut down on unnecessary resources')).toBe(false);
  });
  it('rejects "diff" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('diff between the two versions')).toBe(false);
  });
  it('rejects "true" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('true for production environments')).toBe(false);
  });
  it('rejects "false" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('false positives may occur in edge cases')).toBe(false);
  });
  it('rejects "sleep" without shell syntax', () => {
    expect(looksLikeShellOrDockerCodeLine('sleep between retries is configurable')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // POSITIVE: Structural patterns (no specific command)
  // ──────────────────────────────────────────────────────────────
  it('detects executable paths (./)', () => {
    expect(looksLikeShellOrDockerCodeLine('./deploy.sh')).toBe(true);
  });
  it('detects executable paths with args', () => {
    expect(looksLikeShellOrDockerCodeLine('./gradlew build --parallel')).toBe(true);
  });
  it('detects shell prompts ($ command)', () => {
    expect(looksLikeShellOrDockerCodeLine('$ kubectl get pods')).toBe(true);
  });
  it('detects shebang lines', () => {
    expect(looksLikeShellOrDockerCodeLine('#!/bin/bash')).toBe(true);
  });
  it('detects shebang with env', () => {
    expect(looksLikeShellOrDockerCodeLine('#!/usr/bin/env python3')).toBe(true);
  });
  it('detects environment variable assignments', () => {
    expect(looksLikeShellOrDockerCodeLine('DATABASE_URL=postgres://localhost/mydb')).toBe(true);
  });
  it('detects NODE_ENV assignment', () => {
    expect(looksLikeShellOrDockerCodeLine('NODE_ENV=production')).toBe(true);
  });
  it('detects pipe chains (structural)', () => {
    expect(looksLikeShellOrDockerCodeLine('something | another thing')).toBe(true);
  });
  it('detects output redirection (structural)', () => {
    expect(looksLikeShellOrDockerCodeLine('mycommand > output.txt')).toBe(true);
  });
  it('detects append redirection', () => {
    expect(looksLikeShellOrDockerCodeLine('mycommand >> log.txt')).toBe(true);
  });
  it('detects stderr redirection', () => {
    expect(looksLikeShellOrDockerCodeLine('mycommand 2>&1')).toBe(true);
  });
  it('detects && chaining (structural)', () => {
    expect(looksLikeShellOrDockerCodeLine('something && another')).toBe(true);
  });
  it('detects command substitution', () => {
    expect(looksLikeShellOrDockerCodeLine('echo $(date)')).toBe(true);
  });
  it('detects line continuation', () => {
    expect(looksLikeShellOrDockerCodeLine('docker build \\')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // NEGATIVE: English prose — should NOT match
  // ──────────────────────────────────────────────────────────────
  it('rejects simple sentence', () => {
    expect(looksLikeShellOrDockerCodeLine('This is a regular sentence.')).toBe(false);
  });
  it('rejects question', () => {
    expect(looksLikeShellOrDockerCodeLine('Which deployment target do you mean?')).toBe(false);
  });
  it('rejects exclamation', () => {
    expect(looksLikeShellOrDockerCodeLine('Great job on the deployment!')).toBe(false);
  });
  it('rejects instruction prose', () => {
    expect(looksLikeShellOrDockerCodeLine('Reply with: target + framework')).toBe(false);
  });
  it('rejects advice prose', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        "While you answer, here's a solid default pattern that works almost everywhere:"
      )
    ).toBe(false);
  });
  it('rejects prose starting with "I"', () => {
    expect(
      looksLikeShellOrDockerCodeLine('I can give you the exact Kubernetes YAML once you confirm.')
    ).toBe(false);
  });
  it('rejects prose starting with "You"', () => {
    expect(
      looksLikeShellOrDockerCodeLine('You can apply it with kubectl apply -f deployment.yaml.')
    ).toBe(false);
  });
  it('rejects prose starting with "The"', () => {
    expect(
      looksLikeShellOrDockerCodeLine('The deployment will be created in the default namespace.')
    ).toBe(false);
  });
  it('rejects prose about best practices', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Always use environment variables for secrets instead of hardcoding them.'
      )
    ).toBe(false);
  });
  it('rejects prose about configuration', () => {
    expect(
      looksLikeShellOrDockerCodeLine('Configure the readiness probe to check the health endpoint.')
    ).toBe(false);
  });
  it('rejects prose about architecture', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Each microservice should have its own deployment and service resource.'
      )
    ).toBe(false);
  });
  it('rejects prose about networking', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Traffic is routed through the ingress controller to the backend pods.'
      )
    ).toBe(false);
  });
  it('rejects prose with technical terms', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Horizontal Pod Autoscaler scales based on CPU utilization metrics.'
      )
    ).toBe(false);
  });
  it('rejects prose about containers', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Containers share the host kernel and are isolated via namespaces.'
      )
    ).toBe(false);
  });
  it('rejects prose about scaling', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Scale the deployment to three replicas for high availability.'
      )
    ).toBe(false);
  });
  it('rejects prose about monitoring', () => {
    expect(
      looksLikeShellOrDockerCodeLine('Monitoring should be set up with Prometheus and Grafana.')
    ).toBe(false);
  });
  it('rejects prose about security', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Network policies restrict traffic between namespaces for security.'
      )
    ).toBe(false);
  });
  it('rejects prose about CI/CD', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Continuous deployment pipelines should include automated testing stages.'
      )
    ).toBe(false);
  });
  it('rejects prose about databases', () => {
    expect(
      looksLikeShellOrDockerCodeLine(
        'Database migrations should run before the application starts.'
      )
    ).toBe(false);
  });
  it('rejects conversational prose', () => {
    expect(
      looksLikeShellOrDockerCodeLine("Here's how to set up a basic Python web application:")
    ).toBe(false);
  });
  it('rejects comparative prose', () => {
    expect(
      looksLikeShellOrDockerCodeLine('Gunicorn is generally preferred over the Flask dev server.')
    ).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // NEGATIVE: Markdown syntax — should NOT match
  // ──────────────────────────────────────────────────────────────
  it('rejects markdown bullet list', () => {
    expect(looksLikeShellOrDockerCodeLine('- Create requirements.txt')).toBe(false);
  });
  it('rejects nested bullet list', () => {
    expect(looksLikeShellOrDockerCodeLine('  - Flask/Django (WSGI): gunicorn')).toBe(false);
  });
  it('rejects numbered list', () => {
    expect(looksLikeShellOrDockerCodeLine('1. Install the dependencies')).toBe(false);
  });
  it('rejects markdown heading', () => {
    expect(looksLikeShellOrDockerCodeLine('## Installation Guide')).toBe(false);
  });
  it('rejects markdown h3', () => {
    expect(looksLikeShellOrDockerCodeLine('### Step 1: Clone the Repository')).toBe(false);
  });
  it('rejects markdown blockquote', () => {
    expect(looksLikeShellOrDockerCodeLine('> Note: this requires admin privileges')).toBe(false);
  });
  it('rejects markdown link', () => {
    expect(looksLikeShellOrDockerCodeLine('[See the docs](https://example.com)')).toBe(false);
  });
  it('rejects markdown bold', () => {
    expect(looksLikeShellOrDockerCodeLine('**Important:** always back up first')).toBe(false);
  });
  it('rejects markdown table separator', () => {
    expect(looksLikeShellOrDockerCodeLine('|---|---|---|')).toBe(false);
  });
  it('rejects markdown table row', () => {
    expect(looksLikeShellOrDockerCodeLine('| Pod Name | Status | Restarts |')).toBe(false);
  });
  it('rejects markdown checkbox', () => {
    expect(looksLikeShellOrDockerCodeLine('- [x] Deploy to staging')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // NEGATIVE: YAML / Kubernetes manifest lines — should NOT match
  // ──────────────────────────────────────────────────────────────
  it('rejects apiVersion YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('apiVersion: v1')).toBe(false);
  });
  it('rejects kind YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('kind: Deployment')).toBe(false);
  });
  it('rejects metadata YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('metadata:')).toBe(false);
  });
  it('rejects name YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('  name: my-deployment')).toBe(false);
  });
  it('rejects namespace YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('  namespace: production')).toBe(false);
  });
  it('rejects spec YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('spec:')).toBe(false);
  });
  it('rejects replicas YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('  replicas: 3')).toBe(false);
  });
  it('rejects containers YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('  containers:')).toBe(false);
  });
  it('rejects image YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('    image: nginx:1.25')).toBe(false);
  });
  it('rejects ports YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('    - containerPort: 80')).toBe(false);
  });
  it('rejects YAML document separator', () => {
    expect(looksLikeShellOrDockerCodeLine('---')).toBe(false);
  });
  it('rejects labels YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('    app: my-app')).toBe(false);
  });
  it('rejects selector YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('  selector:')).toBe(false);
  });
  it('rejects matchLabels YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('    matchLabels:')).toBe(false);
  });
  it('rejects resources YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('    resources:')).toBe(false);
  });
  it('rejects limits YAML', () => {
    expect(looksLikeShellOrDockerCodeLine('      memory: "128Mi"')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // NEGATIVE: Labels, headings, titles — should NOT match
  // ──────────────────────────────────────────────────────────────
  it('rejects capitalized Python prose', () => {
    expect(looksLikeShellOrDockerCodeLine('Python web app deployment checklist')).toBe(false);
  });
  it('rejects Dockerfile as title', () => {
    expect(looksLikeShellOrDockerCodeLine('Dockerfile (FastAPI example)')).toBe(false);
  });
  it('rejects "Build + run:" label', () => {
    expect(looksLikeShellOrDockerCodeLine('Build + run:')).toBe(false);
  });
  it('rejects "Example:" label', () => {
    expect(looksLikeShellOrDockerCodeLine('Example: containerize (works for AKS)')).toBe(false);
  });
  it('rejects "Prerequisites:" label', () => {
    expect(looksLikeShellOrDockerCodeLine('Prerequisites: Docker and kubectl installed')).toBe(
      false
    );
  });
  it('rejects "Note:" label', () => {
    expect(
      looksLikeShellOrDockerCodeLine('Note: Make sure your cluster is running before proceeding.')
    ).toBe(false);
  });
  it('rejects "Step 1" label', () => {
    expect(looksLikeShellOrDockerCodeLine('Step 1: Create the Dockerfile')).toBe(false);
  });
  it('rejects "Option A" label', () => {
    expect(looksLikeShellOrDockerCodeLine('Option A: Use Kubernetes Deployment')).toBe(false);
  });
  it('rejects "Summary" heading', () => {
    expect(looksLikeShellOrDockerCodeLine('Summary of deployment options')).toBe(false);
  });
  it('rejects "Troubleshooting" heading', () => {
    expect(looksLikeShellOrDockerCodeLine('Troubleshooting common deployment issues')).toBe(false);
  });
  it('rejects status output', () => {
    expect(looksLikeShellOrDockerCodeLine('Status: Running')).toBe(false);
  });
  it('rejects key-value output', () => {
    expect(looksLikeShellOrDockerCodeLine('Name: my-pod-abc123')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // NEGATIVE: Other non-code patterns
  // ──────────────────────────────────────────────────────────────
  it('rejects empty string', () => {
    expect(looksLikeShellOrDockerCodeLine('')).toBe(false);
  });
  it('rejects URL', () => {
    expect(looksLikeShellOrDockerCodeLine('https://kubernetes.io/docs/tutorials/')).toBe(false);
  });
  it('rejects email-like text', () => {
    expect(looksLikeShellOrDockerCodeLine('admin@example.com')).toBe(false);
  });
  it('rejects version numbers', () => {
    expect(looksLikeShellOrDockerCodeLine('v1.28.0')).toBe(false);
  });
  it('rejects plain numbers', () => {
    expect(looksLikeShellOrDockerCodeLine('8080')).toBe(false);
  });
  it('rejects just whitespace', () => {
    expect(looksLikeShellOrDockerCodeLine('   ')).toBe(false);
  });
});

describe('normalizeTerminalMarkdown', () => {
  it('converts terminal-style numbered choices to markdown ordered list', () => {
    const input = ' 1 Kubernetes (AKS)\n 2 Container on a VM\n 3 PaaS\n 4 Bare VM';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('1. Kubernetes (AKS)');
    expect(result).toContain('2. Container on a VM');
    expect(result).toContain('3. PaaS');
    expect(result).toContain('4. Bare VM');
  });

  it('trims centered heading lines with 6+ spaces indentation', () => {
    const input = '\n                 Python web app deployment checklist (generic)\n\n';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('Python web app deployment checklist (generic)');
    expect(result).not.toContain('                 Python');
  });

  it('wraps indented code blocks in fences when 2+ code-like lines detected', () => {
    const input = 'Example:\n\n FROM python:3.12-slim\n WORKDIR /app\n COPY . .\n\nDone.';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```');
    expect(result).toContain('FROM python:3.12-slim');
  });

  it('preserves existing code fences', () => {
    const input = '```yaml\napiVersion: v1\nkind: Pod\n```';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toBe(input);
  });

  it('wraps single indented code line in code fence', () => {
    const input = 'Hello\n docker build -t myapp .\nDone.';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```\ndocker build -t myapp .\n```');
    expect(result).toContain('Done.');
  });

  it('wraps single indented kubectl apply line in code fence', () => {
    const input = 'Then:\n\n kubectl apply -f app.yaml';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```\nkubectl apply -f app.yaml\n```');
  });

  it('does not treat prose lines as code', () => {
    const input =
      '\n                 Example: containerize (works for AKS, any container runtime)\n\n';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('Example: containerize');
    expect(result).not.toContain('```');
  });

  it('wraps code blocks with empty lines between code lines', () => {
    const input =
      'Steps:\n\n docker build -t myapp .\n\n docker run --rm -p 8000:8000 myapp\n\nDone.';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```');
    expect(result).toContain('docker build -t myapp .');
    expect(result).toContain('docker run --rm -p 8000:8000 myapp');
  });

  it('wraps Dockerfile blocks with empty lines between instructions', () => {
    const input =
      'Dockerfile:\n\n FROM python:3.12-slim\n\n WORKDIR /app\n COPY . .\n\n RUN pip install -r requirements.txt\n\nDone.';
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```');
    expect(result).toContain('FROM python:3.12-slim');
    expect(result).toContain('WORKDIR /app');
    expect(result).toContain('RUN pip install -r requirements.txt');
  });

  it('does not wrap Kubernetes YAML as code (handled separately by wrapBareYamlBlocks)', () => {
    const input =
      'Here is the deployment:\n\n apiVersion: apps/v1\n kind: Deployment\n metadata:\n   name: my-app\n';
    const result = normalizeTerminalMarkdown(input);
    // YAML lines don't match looksLikeShellOrDockerCodeLine, so no wrapping
    expect(result).not.toContain('```');
    expect(result).toContain('apiVersion: apps/v1');
  });

  it('does not wrap indented prose as code', () => {
    const input =
      '\n service mesh configuration\n service discovery is built-in\n service accounts are used\n';
    const result = normalizeTerminalMarkdown(input);
    // "service" is ambiguous and these lines have no shell syntax → not wrapped
    expect(result).not.toContain('```');
  });

  it('handles mixed content: numbered list + code block + prose', () => {
    const input = [
      ' 1 Option A',
      ' 2 Option B',
      '',
      '                 Setup instructions',
      '',
      ' docker pull nginx',
      ' docker run -d -p 80:80 nginx',
      '',
      'That should work.',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('1. Option A');
    expect(result).toContain('2. Option B');
    expect(result).toContain('Setup instructions');
    expect(result).toContain('```');
    expect(result).toContain('docker pull nginx');
    expect(result).toContain('That should work.');
  });
});

describe('wrapBareYamlBlocks', () => {
  it('wraps a bare YAML block starting with apiVersion:', () => {
    const input = 'Here is the YAML:\napiVersion: v1\nkind: Pod\nmetadata:\n  name: test';
    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    expect(result).toContain('apiVersion: v1');
    expect(result).toContain('```');
  });

  it('wraps apiVersion with no value after colon', () => {
    const input = 'apiVersion:\nkind: Pod';
    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    expect(result).toContain('apiVersion:');
  });

  it('does not double-wrap YAML already in code fences', () => {
    const input = '```yaml\napiVersion: v1\nkind: Pod\n```';
    const result = wrapBareYamlBlocks(input);
    // Should not add extra fences
    const fenceCount = (result.match(/```/g) || []).length;
    expect(fenceCount).toBe(2);
  });

  it('wraps bare YAML even when another block is already fenced', () => {
    const input =
      '```yaml\napiVersion: v1\nkind: Pod\n```\n\nHere is another:\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: test';
    const result = wrapBareYamlBlocks(input);
    // Should have the original fences plus new ones
    const fenceCount = (result.match(/```/g) || []).length;
    expect(fenceCount).toBe(4); // original 2 + new 2
    expect(result).toContain('kind: Deployment');
  });

  it('stops at two consecutive blank lines', () => {
    const input = 'apiVersion: v1\nkind: Pod\n\n\nSome text after';
    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    expect(result).not.toContain('Some text after\n```');
  });

  it('stops at non-YAML lines', () => {
    const input = 'apiVersion: v1\nkind: Pod\nThis is not YAML';
    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    // The "This is not YAML" should be outside the fence
    const lines = result.split('\n');
    const closingFenceIdx = lines.lastIndexOf('```');
    const nonYamlIdx = lines.indexOf('This is not YAML');
    expect(nonYamlIdx).toBeGreaterThan(closingFenceIdx);
  });

  it('handles text with no YAML at all', () => {
    const input = 'Hello world\nThis is some text\nNo YAML here';
    expect(wrapBareYamlBlocks(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(wrapBareYamlBlocks('')).toBe('');
  });

  it('joins bare value after kind: (terminal split kind: / Kustomization)', () => {
    const input =
      'apiVersion: kustomize.config.k8s.io/v1beta1\nkind:\nKustomization\nnamespace: shop\nresources:\n  - base.yaml';
    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('kind: Kustomization');
    expect(result).not.toMatch(/^Kustomization$/m);
  });

  it('does NOT consume entire YAML block when labels: has unclosed brace from terminal wrapping', () => {
    const input = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: payments',
      '  namespace: shop',
      '  labels: { app.kubernetes.io/name: payments, app.kubernetes.io/part-of: shop',
      'spec:',
      '  replicas: 2',
    ].join('\n');
    const result = wrapBareYamlBlocks(input);
    // spec: should be on its own line, not joined onto the labels line
    expect(result).toMatch(/^spec:/m);
  });

  it('stops indented YAML block at less-indented prose like "Apply:"', () => {
    const input = [
      'Kubernetes YAML:',
      ' apiVersion: v1',
      ' kind: Namespace',
      ' metadata:',
      '   name: demo',
      '',
      'Apply:',
      'kubectl apply -f app.yaml',
    ].join('\n');

    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    expect(result).toContain('apiVersion: v1');
    // Apply: must be OUTSIDE the yaml fence
    const fenceEnd = result.indexOf('```\n', result.indexOf('```yaml') + 7);
    const applyIdx = result.indexOf('Apply:');
    expect(fenceEnd).toBeLessThan(applyIdx);
  });

  it('dedents indented multi-document YAML with --- separators', () => {
    const input = [
      ' apiVersion: v1',
      ' kind: Namespace',
      ' metadata:',
      '   name: demo',
      ' ---',
      ' apiVersion: apps/v1',
      ' kind: Deployment',
      ' metadata:',
      '   name: my-app',
    ].join('\n');

    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    // Should be dedented — no leading space
    expect(result).toContain('\napiVersion: v1\n');
    expect(result).toContain('\napiVersion: apps/v1\n');
    expect(result).toContain('\n---\n');
  });

  it('dedents indented YAML', () => {
    const input = '  apiVersion: v1\n  kind: Pod\n  metadata:\n    name: test';
    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('apiVersion: v1');
    // The 2-space indent should be removed from the first level
    expect(result).toContain('kind: Pod');
  });

  it('preserves content inside existing code fences', () => {
    const input = '```bash\napiVersion: v1\n```\nSome text';
    const result = wrapBareYamlBlocks(input);
    // apiVersion inside bash fence should not be re-wrapped
    expect(result).toBe(input);
  });

  it('handles YAML with list items', () => {
    const input =
      'apiVersion: v1\nkind: Pod\nspec:\n  containers:\n  - name: test\n    image: nginx';
    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    expect(result).toContain('- name: test');
  });

  it('handles multiple bare YAML blocks', () => {
    const input =
      'First resource:\napiVersion: v1\nkind: Pod\n\n\nSecond resource:\napiVersion: v1\nkind: Service';
    const result = wrapBareYamlBlocks(input);
    const yamlFences = (result.match(/```yaml/g) || []).length;
    expect(yamlFences).toBe(2);
  });

  it('includes YAML value continuation when key ends with colon', () => {
    const input = [
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: global-config',
      '  namespace: apps',
      'data:',
      '  OTEL_EXPORTER_OTLP_ENDPOINT:',
      '"http://otel-collector.observability.svc.cluster.local:4317"',
      '---',
      'apiVersion: v1',
      'kind: Secret',
    ].join('\n');

    const result = wrapBareYamlBlocks(input);
    // The quoted value should be INSIDE the yaml fence, not outside
    expect(result).toContain('OTEL_EXPORTER_OTLP_ENDPOINT:');
    expect(result).toContain('"http://otel-collector.observability.svc.cluster.local:4317"');
    // Should be one continuous yaml block
    const yamlFences = (result.match(/```yaml/g) || []).length;
    expect(yamlFences).toBe(1);
  });

  it('includes YAML value continuation for unclosed flow braces', () => {
    const input = [
      'apiVersion: apps/v1',
      'kind: StatefulSet',
      'spec:',
      '  containers:',
      '    - name: postgres',
      '      env:',
      '        - name: POSTGRES_USER',
      '          valueFrom: { secretKeyRef: { name: db-credentials, key:',
      'POSTGRES_USER } }',
      '        - name: POSTGRES_PASSWORD',
      '          valueFrom: { secretKeyRef: { name: db-credentials, key:',
      'POSTGRES_PASSWORD } }',
    ].join('\n');

    const result = wrapBareYamlBlocks(input);
    // Continuations should be inside the fence
    expect(result).toContain('POSTGRES_USER } }');
    expect(result).toContain('POSTGRES_PASSWORD } }');
    // Should be one yaml block
    const yamlFences = (result.match(/```yaml/g) || []).length;
    expect(yamlFences).toBe(1);
  });

  it('includes flow mapping closer } after flow opener', () => {
    const input = [
      'apiVersion: v1',
      'kind: Pod',
      'spec:',
      '  containers:',
      '    - name: test',
      '      resources:',
      '        requests: { cpu: "150m", memory: "256Mi" }',
      '        limits: { cpu: "1", memory: "1Gi" }',
    ].join('\n');

    const result = wrapBareYamlBlocks(input);
    expect(result).toContain('```yaml');
    expect(result).toContain('{ cpu: "150m", memory: "256Mi" }');
    expect(result).toContain('{ cpu: "1", memory: "1Gi" }');
  });
});

describe('wrapBareCodeBlocks', () => {
  it('wraps a bare curl command in code fences', () => {
    const input = 'Test your deployment:\n\ncurl http://localhost:8080';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('```\ncurl http://localhost:8080\n```');
  });

  it('wraps bare kubectl commands in a single code fence', () => {
    const input =
      'Run these commands:\n\nkubectl apply -f deploy.yaml\nkubectl get pods -n demo -w';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('```\nkubectl apply -f deploy.yaml\nkubectl get pods -n demo -w\n```');
  });

  it('wraps bare docker commands', () => {
    const input = 'Build and push:\n\ndocker build -t myapp:1.0 .\ndocker push myapp:1.0';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('```\ndocker build -t myapp:1.0 .\ndocker push myapp:1.0\n```');
  });

  it('wraps bare helm commands', () => {
    const input = 'Install the chart:\n\nhelm install myrelease ./mychart --namespace demo';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('```\nhelm install myrelease ./mychart --namespace demo\n```');
  });

  it('does not wrap prose text', () => {
    const input = 'This is a paragraph about deploying apps.\nIt explains how to use kubectl.';
    const result = wrapBareCodeBlocks(input);
    expect(result).toBe(input);
  });

  it('does not double-wrap code already in fences', () => {
    const input = '```\ncurl http://localhost:8080\n```';
    const result = wrapBareCodeBlocks(input);
    const fenceCount = (result.match(/```/g) || []).length;
    expect(fenceCount).toBe(2);
  });

  it('does not wrap YAML lines (handled by wrapBareYamlBlocks)', () => {
    const input = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: test';
    const result = wrapBareCodeBlocks(input);
    expect(result).not.toContain('```\napiVersion');
  });

  it('handles empty string', () => {
    expect(wrapBareCodeBlocks('')).toBe('');
  });

  it('wraps multiple separate bare code blocks', () => {
    const input = 'First step:\n\ncurl http://localhost/health\n\nSecond step:\n\nkubectl get pods';
    const result = wrapBareCodeBlocks(input);
    const fenceCount = (result.match(/```/g) || []).length;
    expect(fenceCount).toBe(4); // 2 blocks × 2 fences each
  });

  it('wraps curl with flags', () => {
    const input =
      'Test the endpoint:\n\ncurl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('```\ncurl');
    expect(result).toContain('http://localhost:8080/health\n```');
  });

  it('wraps az aks commands', () => {
    const input =
      'Get credentials:\n\naz aks get-credentials --resource-group myRG --name myCluster';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('```\naz aks get-credentials');
  });

  it('preserves markdown structure around wrapped code', () => {
    const input =
      '## Step 1\n\nDeploy the app:\n\nkubectl apply -f app.yaml\n\n## Step 2\n\nCheck status:';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('## Step 1');
    expect(result).toContain('```\nkubectl apply -f app.yaml\n```');
    expect(result).toContain('## Step 2');
  });

  it('wraps bare curl after YAML code fence', () => {
    const input =
      '```yaml\napiVersion: v1\nkind: Service\n```\n\nTest:\n\ncurl http://localhost:8080';
    const result = wrapBareCodeBlocks(input);
    expect(result).toContain('```\ncurl http://localhost:8080\n```');
    // Should have yaml fence + curl fence = 4 total ``` markers
    const fenceCount = (result.match(/```/g) || []).length;
    expect(fenceCount).toBe(4);
  });
});

describe('cleanTerminalFormatting', () => {
  it('removes Rich panel top border', () => {
    const input = '┏━━━━━━━━━━┓\nContent\n┗━━━━━━━━━━┛';
    const result = cleanTerminalFormatting(input);
    expect(result).toBe('Content');
  });

  it('unwraps Rich panel content lines', () => {
    const input = '┃ Hello World ┃';
    const result = cleanTerminalFormatting(input);
    expect(result).toBe('Hello World');
  });

  it('removes horizontal rule lines', () => {
    const input = 'Before\n────────────\nAfter';
    const result = cleanTerminalFormatting(input);
    expect(result).toBe('Before\nAfter');
  });

  it('removes double-line horizontal rules', () => {
    const input = 'Before\n════════════\nAfter';
    const result = cleanTerminalFormatting(input);
    expect(result).toBe('Before\nAfter');
  });

  it('does not remove short horizontal lines', () => {
    const input = 'Before\n───\nAfter';
    const result = cleanTerminalFormatting(input);
    expect(result).toBe('Before\n───\nAfter');
  });

  it('preserves content inside code fences', () => {
    const input = '```\n┃ inside fence ┃\n```';
    const result = cleanTerminalFormatting(input);
    expect(result).toContain('┃ inside fence ┃');
  });

  it('trims trailing whitespace', () => {
    const input = 'text with trailing spaces     ';
    const result = cleanTerminalFormatting(input);
    expect(result).toBe('text with trailing spaces');
  });

  it('handles empty panel content', () => {
    const input = '┃  ┃';
    const result = cleanTerminalFormatting(input);
    expect(result).toBe('');
  });

  it('handles empty string', () => {
    expect(cleanTerminalFormatting('')).toBe('');
  });

  it('handles nested Rich panel content', () => {
    const input = '┃ outer ┃\n┃   inner content ┃';
    const result = cleanTerminalFormatting(input);
    expect(result).toContain('outer');
    expect(result).toContain('inner content');
  });
});

describe('isAgentNoiseLine', () => {
  it('detects shell prompt lines', () => {
    expect(isAgentNoiseLine('root@aks-agent-abc123:/app# ')).toBe(true);
  });

  it('detects python command lines', () => {
    expect(isAgentNoiseLine('python /app/aks-agent.py')).toBe(true);
  });

  it('detects Task List header', () => {
    expect(isAgentNoiseLine('Task List:')).toBe(true);
  });

  it('detects table borders', () => {
    expect(isAgentNoiseLine('+------+------+')).toBe(true);
  });

  it('detects table header rows', () => {
    expect(isAgentNoiseLine('| ID | Description | Status |')).toBe(true);
  });

  it('detects table data rows', () => {
    expect(isAgentNoiseLine('| t1 | Some task | [~] in_progress |')).toBe(true);
  });

  it('detects show hints', () => {
    expect(isAgentNoiseLine(' - /show 1 to view contents')).toBe(true);
  });

  it('detects user echo', () => {
    expect(isAgentNoiseLine('User: what pods are running?')).toBe(true);
  });

  it('does not match plain text', () => {
    expect(isAgentNoiseLine('Here are the running pods:')).toBe(false);
  });

  it('does not match YAML list items', () => {
    expect(isAgentNoiseLine('- name: my-pod')).toBe(false);
  });

  it('does not match markdown horizontal rules', () => {
    expect(isAgentNoiseLine('---')).toBe(false);
  });

  it('does not match empty string', () => {
    expect(isAgentNoiseLine('')).toBe(false);
  });
});

describe('stripAgentNoise', () => {
  it('removes noise lines from output', () => {
    const lines = [
      'root@aks-agent-abc:/app# python /app/aks-agent.py',
      'Task List:',
      '+------+------+',
      '| ID | Description |',
      'AI response here',
    ];
    const result = stripAgentNoise(lines);
    expect(result).toEqual(['AI response here']);
  });

  it('collapses multiple blank lines', () => {
    const lines = ['line 1', '', '', '', 'line 2'];
    const result = stripAgentNoise(lines);
    expect(result).toEqual(['line 1', '', 'line 2']);
  });

  it('preserves content inside code fences', () => {
    const lines = [
      '```',
      'root@host:/# this should stay',
      'Task List:',
      '```',
      'root@host:/# prompt outside',
    ];
    const result = stripAgentNoise(lines);
    // Inside fence should be preserved
    expect(result).toContain('root@host:/# this should stay');
    expect(result).toContain('Task List:');
    // Outside fence noise should be removed (pattern matches ^root@)
    expect(result).not.toContain('root@host:/# prompt outside');
  });

  it('handles empty input', () => {
    expect(stripAgentNoise([])).toEqual([]);
  });

  it('preserves normal content', () => {
    const lines = ['Here are the pods:', '- pod-1', '- pod-2'];
    expect(stripAgentNoise(lines)).toEqual(lines);
  });
});

describe('extractAIAnswer', () => {
  it('extracts content after "AI:" prefix on same line', () => {
    const input = 'AI: Here is the answer.';
    expect(extractAIAnswer(input)).toBe('Here is the answer.');
  });

  it('extracts content after "AI:" on its own line', () => {
    const input = 'AI:\nHere is the answer.';
    expect(extractAIAnswer(input)).toBe('Here is the answer.');
  });

  it('strips ANSI codes from output', () => {
    const input = 'AI: \x1b[32mGreen text\x1b[0m';
    expect(extractAIAnswer(input)).toBe('Green text');
  });

  it('removes trailing bash prompts', () => {
    const input = 'AI: The answer is here.\nroot@aks-agent:/app#';
    expect(extractAIAnswer(input)).toBe('The answer is here.');
  });

  it('removes leading and trailing blank lines', () => {
    const input = 'AI:\n\n\nActual content\n\n\n';
    expect(extractAIAnswer(input)).toBe('Actual content');
  });

  it('strips agent noise from content', () => {
    const input = 'AI: The answer\nroot@host:/# echo done\n+------+\nMore content';
    const result = extractAIAnswer(input);
    expect(result).toContain('The answer');
    expect(result).toContain('More content');
    expect(result).not.toContain('root@host');
    expect(result).not.toContain('+------+');
  });

  it('normalizes Unicode bullets', () => {
    const input = 'AI:\n• first item\n• second item';
    const result = extractAIAnswer(input);
    expect(result).toContain('- first item');
    expect(result).toContain('- second item');
  });

  it('wraps bare YAML blocks', () => {
    const input = 'AI: Here is the YAML:\napiVersion: v1\nkind: Pod\nmetadata:\n  name: test';
    const result = extractAIAnswer(input);
    expect(result).toContain('```yaml');
  });

  it('cleans Rich terminal formatting', () => {
    const input = 'AI:\n┏━━━━━━━━━━┓\n┃ Content  ┃\n┗━━━━━━━━━━┛';
    const result = extractAIAnswer(input);
    expect(result).toContain('Content');
    expect(result).not.toContain('┏');
    expect(result).not.toContain('┗');
    expect(result).not.toContain('┃');
  });

  it('falls back to full output when no "AI:" line found', () => {
    const input = 'Some content without AI prefix';
    expect(extractAIAnswer(input)).toBe('Some content without AI prefix');
  });

  it('handles multiline AI response with mixed content', () => {
    const input = [
      'root@aks-agent:/app# python /app/aks-agent.py',
      'Task List:',
      '+------+------+',
      '| t1 | Check pods | [~] in_progress |',
      'AI: Here are the results:',
      '',
      '## Running Pods',
      '- pod-1',
      '- pod-2',
      '',
      'root@aks-agent:/app#',
    ].join('\n');
    const result = extractAIAnswer(input);
    expect(result).toContain('Here are the results:');
    expect(result).toContain('## Running Pods');
    expect(result).not.toContain('Task List');
    expect(result).not.toContain('root@aks-agent');
  });

  it('handles "AI:" with whitespace after colon but no content', () => {
    const input = 'AI:   \nThe answer starts here';
    const result = extractAIAnswer(input);
    expect(result).toBe('The answer starts here');
  });

  it('handles empty output', () => {
    expect(extractAIAnswer('')).toBe('');
  });

  it('handles output with only noise', () => {
    const input = 'root@host:/# python /app/aks-agent.py\nTask List:\n+----+';
    const result = extractAIAnswer(input);
    expect(result).toBe('');
  });
});

describe('ThinkingStepTracker', () => {
  it('tracks model loading', () => {
    const tracker = new ThinkingStepTracker();
    const changed = tracker.processLine("Loaded models: ['gpt-4']");
    expect(changed).toBe(true);
    expect(tracker.steps).toHaveLength(1);
    expect(tracker.steps[0].label).toContain('gpt-4');
    expect(tracker.steps[0].phase).toBe('init');
    expect(tracker.steps[0].status).toBe('completed');
  });

  it('tracks toolset loading', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('✅ Toolset kubernetes loaded');
    expect(tracker.steps).toHaveLength(1);
    expect(tracker.steps[0].label).toContain('kubernetes');
    expect(tracker.steps[0].phase).toBe('init');
  });

  it('tracks task list rows', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('| t1 | List pods | [ ] pending |');
    expect(tracker.steps).toHaveLength(1);
    expect(tracker.steps[0].label).toBe('List pods');
    expect(tracker.steps[0].status).toBe('pending');
    expect(tracker.steps[0].phase).toBe('planning');
  });

  it('updates task status from pending to in_progress', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('| t1 | List pods | [ ] pending |');
    tracker.processLine('| t1 | List pods | [~] in_progress |');
    expect(tracker.steps).toHaveLength(1);
    expect(tracker.steps[0].status).toBe('running');
  });

  it('updates task status to completed', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('| t1 | List pods | [ ] pending |');
    tracker.processLine('| t1 | List pods | [✓] completed |');
    expect(tracker.steps).toHaveLength(1);
    expect(tracker.steps[0].status).toBe('completed');
  });

  it('tracks multiple tasks', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('| t1 | List pods | [ ] pending |');
    tracker.processLine('| t2 | Check services | [ ] pending |');
    expect(tracker.steps).toHaveLength(2);
  });

  it('tracks running tool calls', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('Running tool #1 web_search: searching');
    expect(tracker.steps).toHaveLength(1);
    expect(tracker.steps[0].label).toBe('Searching the web');
    expect(tracker.steps[0].status).toBe('running');
    expect(tracker.steps[0].phase).toBe('executing');
  });

  it('marks tool calls as completed', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('Running tool #1 web_search: searching');
    tracker.processLine('Finished #1 in 2.3s');
    expect(tracker.steps[0].status).toBe('completed');
  });

  it('skips TodoWrite tool calls', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('Running tool #1 TodoWrite: updating tasks');
    expect(tracker.steps).toHaveLength(0);
  });

  it('skips call_kubectl tool calls', () => {
    const tracker = new ThinkingStepTracker();
    tracker.processLine('Running tool #1 call_kubectl: get pods');
    expect(tracker.steps).toHaveLength(0);
  });

  it('ignores empty lines', () => {
    const tracker = new ThinkingStepTracker();
    expect(tracker.processLine('')).toBe(false);
    expect(tracker.processLine('   ')).toBe(false);
  });

  it('ignores Thinking... indicator', () => {
    const tracker = new ThinkingStepTracker();
    expect(tracker.processLine('Thinking...')).toBe(false);
  });

  it('handles wrapped task table rows', () => {
    const tracker = new ThinkingStepTracker();
    // First line is partial
    tracker.processLine('| t1 | Very long task description that wraps');
    // Second line completes it
    tracker.processLine('across lines | [ ] pending |');
    expect(tracker.steps).toHaveLength(1);
    expect(tracker.steps[0].label).toBe('Very long task description that wraps across lines');
  });
});

describe('extractTaskRow', () => {
  it('parses pending task', () => {
    const result = extractTaskRow('| t1 | List pods | [ ] pending |');
    expect(result).toEqual({ content: 'List pods', status: 'pending' });
  });

  it('parses in_progress task', () => {
    const result = extractTaskRow('| t1 | Check services | [~] in_progress |');
    expect(result).toEqual({ content: 'Check services', status: 'in_progress' });
  });

  it('parses completed task', () => {
    const result = extractTaskRow('| t2 | Deploy app | [✓] completed |');
    expect(result).toEqual({ content: 'Deploy app', status: 'completed' });
  });

  it('returns null for non-task lines', () => {
    expect(extractTaskRow('regular text')).toBeNull();
  });

  it('returns null for table borders', () => {
    expect(extractTaskRow('+------+------+')).toBeNull();
  });

  it('returns null for header row', () => {
    expect(extractTaskRow('| ID | Description | Status |')).toBeNull();
  });
});

describe('friendlyToolLabel', () => {
  it('returns friendly label for web_search', () => {
    expect(friendlyToolLabel('Running tool #1 web_search: query')).toBe('Searching the web');
  });

  it('returns friendly label for read_file', () => {
    expect(friendlyToolLabel('Running tool #2 read_file: /path/to/file')).toBe('Reading file');
  });

  it('returns friendly label for file_read', () => {
    expect(friendlyToolLabel('Running tool #3 file_read: /path/to/file')).toBe('Reading file');
  });

  it('returns null for call_kubectl', () => {
    expect(friendlyToolLabel('Running tool #1 call_kubectl: get pods')).toBeNull();
  });

  it('returns null for TodoWrite', () => {
    expect(friendlyToolLabel('Running tool #1 TodoWrite: update')).toBeNull();
  });

  it('returns generic label for unknown tool', () => {
    expect(friendlyToolLabel('Running tool #1 custom_tool: args')).toBe('Running custom_tool');
  });

  it('returns fallback for non-matching input', () => {
    expect(friendlyToolLabel('some other text')).toBe('Running tool');
  });
});

describe('code block preservation', () => {
  describe('wrapBareYamlBlocks preserves non-YAML code fences', () => {
    it('preserves typescript code blocks', () => {
      const input = [
        'Here is some TypeScript:',
        '```ts',
        'const x: number = 42;',
        'interface Pod { name: string; }',
        '```',
      ].join('\n');
      expect(wrapBareYamlBlocks(input)).toBe(input);
    });

    it('preserves mermaid code blocks', () => {
      const input = [
        'Here is a diagram:',
        '```mermaid',
        'graph TD',
        '  A[Start] --> B{Decision}',
        '  B -->|Yes| C[End]',
        '```',
      ].join('\n');
      expect(wrapBareYamlBlocks(input)).toBe(input);
    });

    it('preserves javascript code blocks', () => {
      const input = '```javascript\nconst obj = { apiVersion: "v1" };\n```';
      expect(wrapBareYamlBlocks(input)).toBe(input);
    });

    it('preserves json code blocks even with K8s-like content', () => {
      const input = ['```json', '{"apiVersion": "v1", "kind": "Pod"}', '```'].join('\n');
      expect(wrapBareYamlBlocks(input)).toBe(input);
    });

    it('wraps bare YAML but preserves adjacent ts code block', () => {
      const input = [
        '```ts',
        'const x = 1;',
        '```',
        '',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```ts');
      expect(result).toContain('const x = 1;');
      expect(result).toContain('```yaml');
      expect(result).toContain('apiVersion: v1');
    });

    it('wraps bare YAML but preserves adjacent mermaid block', () => {
      const input = [
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: nginx',
        '',
        '```mermaid',
        'graph LR',
        '  A --> B',
        '```',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('```mermaid');
      expect(result).toContain('graph LR');
    });
  });

  describe('cleanTerminalFormatting preserves code blocks', () => {
    it('does not alter content inside ts code blocks', () => {
      const input = ['```ts', '┃ this looks like a Rich border but is actually code ┃', '```'].join(
        '\n'
      );
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('┃ this looks like a Rich border but is actually code ┃');
    });

    it('does not alter content inside mermaid code blocks', () => {
      const input = ['```mermaid', 'graph TD', '  A[━━━━━] --> B[┏━━━┓]', '```'].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('A[━━━━━] --> B[┏━━━┓]');
    });

    it('does not alter content inside bash code blocks', () => {
      const input = ['```bash', 'root@host:/# echo hello', '┏━━━━━━━━┓', '```'].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('root@host:/# echo hello');
      expect(result).toContain('┏━━━━━━━━┓');
    });
  });

  describe('stripAgentNoise preserves code blocks', () => {
    it('does not strip noise-like lines inside ts code blocks', () => {
      const lines = [
        '```ts',
        'root@host:/# this is a code comment',
        'python /app/aks-agent.py',
        '| t1 | table-like code | [ ] pending |',
        '```',
      ];
      const result = stripAgentNoise(lines);
      expect(result).toContain('root@host:/# this is a code comment');
      expect(result).toContain('python /app/aks-agent.py');
      expect(result).toContain('| t1 | table-like code | [ ] pending |');
    });

    it('does not strip noise-like lines inside mermaid code blocks', () => {
      const lines = ['```mermaid', '+------+------+', '| ID | Description |', '```'];
      const result = stripAgentNoise(lines);
      expect(result).toContain('+------+------+');
      expect(result).toContain('| ID | Description |');
    });
  });

  describe('extractAIAnswer preserves code blocks end-to-end', () => {
    it('preserves typescript code blocks through full pipeline', () => {
      const input = [
        'AI: Here is how to do it:',
        '',
        '```typescript',
        'import { Pod } from "@k8s/api";',
        'const pod: Pod = { apiVersion: "v1", kind: "Pod" };',
        '```',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```typescript');
      expect(result).toContain('const pod: Pod');
      expect(result).not.toContain('```yaml');
    });

    it('preserves mermaid diagrams through full pipeline', () => {
      const input = [
        'AI: Here is the architecture:',
        '',
        '```mermaid',
        'graph TD',
        '  subgraph "AKS Cluster"',
        '    A[Pod] --> B[Service]',
        '    B --> C[Ingress]',
        '  end',
        '```',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```mermaid');
      expect(result).toContain('graph TD');
      expect(result).toContain('subgraph "AKS Cluster"');
    });

    it('preserves multiple different code blocks', () => {
      const input = [
        'AI: Here are examples:',
        '',
        '```yaml',
        'apiVersion: v1',
        'kind: Pod',
        '```',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        '```mermaid',
        'graph LR',
        '  A --> B',
        '```',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('```ts');
      expect(result).toContain('```mermaid');
    });
  });
});

describe('malformed AI output handling', () => {
  describe('extractAIAnswer with malformed output', () => {
    it('handles truncated output mid-sentence', () => {
      const input = 'AI: The pod is in a CrashLo';
      const result = extractAIAnswer(input);
      expect(result).toBe('The pod is in a CrashLo');
    });

    it('handles output with only ANSI noise', () => {
      const input = '\x1b[31m\x1b[0m\x1b[32m\x1b[0m';
      expect(extractAIAnswer(input)).toBe('');
    });

    it('handles output with garbled mixed ANSI and text', () => {
      const input = 'AI: \x1b[1m\x1b[3partialHello\x1b[0m world';
      const result = extractAIAnswer(input);
      expect(result).toContain('Hello');
      expect(result).toContain('world');
    });

    it('handles output with multiple AI: prefixes', () => {
      const input = 'AI: First answer\nAI: Second answer';
      const result = extractAIAnswer(input);
      expect(result).toContain('First answer');
    });

    it('handles output with AI: inside content', () => {
      const input = 'AI: The model said AI: something interesting';
      const result = extractAIAnswer(input);
      expect(result).toContain('The model said AI: something interesting');
    });

    it('handles extremely long single line', () => {
      const longText = 'A'.repeat(10000);
      const input = `AI: ${longText}`;
      expect(extractAIAnswer(input)).toBe(longText);
    });

    it('handles output with null bytes', () => {
      const input = 'AI: Hello\x00World';
      const result = extractAIAnswer(input);
      expect(result).toContain('Hello');
    });

    it('handles output with only whitespace after AI:', () => {
      const input = 'AI:     \n   \n  ';
      expect(extractAIAnswer(input)).toBe('');
    });

    it('handles output with interleaved noise and content', () => {
      const input = [
        'root@host:/# python /app/aks-agent.py',
        'AI: Here is the result',
        'root@host:/#',
        'More content',
        '+------+',
        'Final answer',
        'root@host:/#',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('Here is the result');
      expect(result).toContain('More content');
      expect(result).toContain('Final answer');
      expect(result).not.toContain('root@host');
    });
  });

  describe('wrapBareYamlBlocks with malformed YAML', () => {
    it('does not wrap lines that look like YAML keys but are prose', () => {
      const input = 'The field apiVersion: is required for all resources.';
      expect(wrapBareYamlBlocks(input)).toBe(input);
    });

    it('handles YAML with trailing garbage', () => {
      const input = [
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test',
        'THIS IS NOT YAML AND SHOULD NOT BE WRAPPED',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('apiVersion: v1');
      expect(result).toContain('THIS IS NOT YAML AND SHOULD NOT BE WRAPPED');
    });

    it('handles YAML block followed immediately by prose', () => {
      const input = ['apiVersion: v1', 'kind: Pod', 'That was the YAML.'].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('That was the YAML.');
    });

    it('handles apiVersion with no kind or metadata', () => {
      const input = 'apiVersion: v1\nThis is just a fragment';
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('apiVersion: v1');
    });

    it('handles deeply indented bare YAML', () => {
      const input = ['   apiVersion: v1', '   kind: Pod', '   metadata:', '     name: test'].join(
        '\n'
      );
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('apiVersion: v1');
    });

    it('handles unclosed code fence before YAML', () => {
      const input = [
        '```',
        'some content in an unclosed fence',
        'apiVersion: v1',
        'kind: Pod',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```');
      expect(result).toContain('apiVersion: v1');
    });

    it('handles empty content between apiVersion lines', () => {
      const input = [
        'apiVersion: v1',
        'kind: Pod',
        '',
        '',
        '',
        'apiVersion: apps/v1',
        'kind: Deployment',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(2);
    });

    it('handles YAML with special characters in values', () => {
      const input = [
        'apiVersion: v1',
        'kind: ConfigMap',
        'data:',
        '  key: "value with: colons and [brackets]"',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('"value with: colons and [brackets]"');
    });
  });

  describe('cleanTerminalFormatting with malformed borders', () => {
    it('handles incomplete top border', () => {
      const input = '┏━━━━━';
      const result = cleanTerminalFormatting(input);
      expect(result).toBe('┏━━━━━');
    });

    it('handles mismatched border characters', () => {
      const input = '┏━━━━━┛';
      const result = cleanTerminalFormatting(input);
      expect(result).toBe('');
    });

    it('handles panel with only one side', () => {
      const input = '┃ content without closing border';
      const result = cleanTerminalFormatting(input);
      expect(result).toBe('content without closing border');
    });

    it('handles panel with multiple pipe characters', () => {
      const input = '┃ data ┃ more ┃';
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('data');
    });

    it('handles empty panel border', () => {
      const input = ['┏━━━━━━┓', '┃      ┃', '┗━━━━━━┛'].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result.trim()).toBe('');
    });

    it('handles nested Rich panels', () => {
      const input = [
        '┏━━━━━━━━━━━━┓',
        '┃ ┏━━━━━━┓   ┃',
        '┃ ┃ inner ┃  ┃',
        '┃ ┗━━━━━━┛   ┃',
        '┗━━━━━━━━━━━━┛',
      ].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('inner');
    });

    it('handles horizontal rules of different widths', () => {
      expect(cleanTerminalFormatting('────')).toBe('');
      expect(cleanTerminalFormatting('━━━━━━━━')).toBe('');
      expect(cleanTerminalFormatting('═══════')).toBe('');
      expect(cleanTerminalFormatting('───')).toBe('───');
    });
  });

  describe('stripAgentNoise with garbled patterns', () => {
    it('handles partial shell prompt', () => {
      const lines = ['root@'];
      const result = stripAgentNoise(lines);
      expect(result).toEqual(['root@']);
    });

    it('strips noise-like lines even with leading whitespace', () => {
      const lines = ['  root@host:/# command  '];
      const result = stripAgentNoise(lines);
      expect(result).toEqual([]);
    });

    it('handles very long table border', () => {
      const lines = ['+' + '-'.repeat(200) + '+'];
      const result = stripAgentNoise(lines);
      expect(result).toEqual([]);
    });

    it('preserves lines that look like markdown tables', () => {
      const lines = ['| Name | Status |', '| pod-1 | Running |'];
      const result = stripAgentNoise(lines);
      expect(result).toEqual(lines);
    });

    it('collapses many consecutive blank lines to one', () => {
      const lines = ['content', '', '', '', '', '', 'more'];
      const result = stripAgentNoise(lines);
      expect(result).toEqual(['content', '', 'more']);
    });
  });

  describe('ThinkingStepTracker with malformed input', () => {
    it('handles garbled model loading line', () => {
      const tracker = new ThinkingStepTracker();
      expect(tracker.processLine("Loaded models: ['']")).toBe(true);
      expect(tracker.steps).toHaveLength(1);
    });

    it('handles empty brackets in model loading', () => {
      const tracker = new ThinkingStepTracker();
      expect(tracker.processLine('Loaded models: []')).toBe(false);
    });

    it('handles toolset line with no tool name', () => {
      const tracker = new ThinkingStepTracker();
      expect(tracker.processLine('✅ Toolset  loaded')).toBe(true);
    });

    it('handles running tool with no arguments', () => {
      const tracker = new ThinkingStepTracker();
      tracker.processLine("Loaded models: ['gpt-4']");
      tracker.processLine('✅ Toolset kubernetes loaded');
      expect(tracker.processLine('Running tool #1 web_search:')).toBe(true);
    });

    it('ignores finish for tool that was never started', () => {
      const tracker = new ThinkingStepTracker();
      tracker.processLine("Loaded models: ['gpt-4']");
      tracker.processLine('✅ Toolset kubernetes loaded');
      expect(tracker.processLine('Finished #99 in 5.2s')).toBe(false);
    });

    it('swallows non-continuation lines while partial row is buffered', () => {
      const tracker = new ThinkingStepTracker();
      tracker.processLine('| t1 | Start of partial');
      const changed = tracker.processLine("Loaded models: ['gpt-4']");
      expect(changed).toBe(false);
    });

    it('handles duplicate task status updates', () => {
      const tracker = new ThinkingStepTracker();
      tracker.processLine('| t1 | Do something | [ ] pending |');
      tracker.processLine('| t1 | Do something | [~] in_progress |');
      tracker.processLine('| t1 | Do something | [✓] completed |');
      const taskSteps = tracker.steps.filter(s => s.phase === 'executing');
      expect(taskSteps.length).toBeLessThanOrEqual(1);
    });

    it('abandons partial row on equal-sign table border', () => {
      const tracker = new ThinkingStepTracker();
      // Start a partial row
      tracker.processLine('| t1 | Start of partial');
      // Equal-sign border should abandon the partial row
      tracker.processLine('+====+====+');
      // Now a real task row should be processed normally
      const changed = tracker.processLine('| t1 | Full task | [ ] pending |');
      expect(changed).toBe(true);
      expect(tracker.steps).toHaveLength(1);
      expect(tracker.steps[0].label).toBe('Full task');
    });
  });

  describe('extractTaskRow with malformed rows', () => {
    it('returns null for row with missing status', () => {
      expect(extractTaskRow('| t1 | Do something |')).toBeNull();
    });

    it('returns null for row with invalid status symbol', () => {
      expect(extractTaskRow('| t1 | Task | [x] unknown_status |')).toBeNull();
    });

    it('returns empty content for row with empty task description', () => {
      const result = extractTaskRow('| t1 | | [ ] pending |');
      expect(result).toEqual({ content: '', status: 'pending' });
    });

    it('returns null for pipe-only line', () => {
      expect(extractTaskRow('| | | |')).toBeNull();
    });

    it('returns null for row with no closing pipe', () => {
      expect(extractTaskRow('| t1 | Task | [ ] pending')).toBeNull();
    });
  });

  describe('looksLikeYaml with edge cases', () => {
    it('accepts plain English sentences with colons as YAML-like', () => {
      expect(looksLikeYaml('Note: this is just a sentence')).toBe(true);
    });

    it('rejects lines that are just colons', () => {
      expect(looksLikeYaml(':')).toBe(false);
    });

    it('accepts YAML comments', () => {
      expect(looksLikeYaml('# This is a YAML comment')).toBe(true);
    });

    it('accepts flow mappings', () => {
      expect(looksLikeYaml('{key: value}')).toBe(true);
    });

    it('accepts flow sequences', () => {
      expect(looksLikeYaml('[item1, item2]')).toBe(true);
    });

    it('treats markdown headings as YAML (starts with #)', () => {
      expect(looksLikeYaml('## Heading')).toBe(true);
    });

    it('accepts multi-line string indicators', () => {
      expect(looksLikeYaml('description: |')).toBe(true);
    });
  });

  describe('normalizeBullets with edge cases', () => {
    it('handles mixed bullet types in one response', () => {
      const input = '• first\n▪ second\n– third\n- already normal';
      const result = normalizeBullets(input);
      expect(result).toBe('- first\n- second\n- third\n- already normal');
    });

    it('converts bullets even inside code fences (no fence awareness)', () => {
      const input = '```\n• not a bullet\n```';
      expect(normalizeBullets(input)).toBe('```\n- not a bullet\n```');
    });

    it('handles empty string', () => {
      expect(normalizeBullets('')).toBe('');
    });
  });

  describe('stripAnsi with malformed sequences', () => {
    it('handles truncated escape sequence', () => {
      const input = 'text\x1b[31';
      const result = stripAnsi(input);
      expect(result).toContain('text');
    });

    it('handles escape followed by non-bracket', () => {
      const input = 'text\x1bXmore';
      const result = stripAnsi(input);
      expect(result).toContain('text');
      expect(result).toContain('more');
    });

    it('handles many nested escape sequences', () => {
      const input = '\x1b[1m\x1b[31m\x1b[4m\x1b[7mhello\x1b[0m\x1b[0m\x1b[0m\x1b[0m';
      expect(stripAnsi(input)).toBe('hello');
    });
  });
});

// ─── Kubernetes YAML block tests ───────────────────────────────────────────

describe('Kubernetes YAML markdown blocks', () => {
  describe('wrapBareYamlBlocks with real-world K8s resources', () => {
    it('wraps a typical Deployment manifest', () => {
      const input = [
        'Here is a Deployment:',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: nginx-deployment',
        '  labels:',
        '    app: nginx',
        'spec:',
        '  replicas: 3',
        '  selector:',
        '    matchLabels:',
        '      app: nginx',
        '  template:',
        '    metadata:',
        '      labels:',
        '        app: nginx',
        '    spec:',
        '      containers:',
        '      - name: nginx',
        '        image: nginx:1.25',
        '        ports:',
        '        - containerPort: 80',
        '        resources:',
        '          limits:',
        '            cpu: "500m"',
        '            memory: "128Mi"',
        '          requests:',
        '            cpu: "250m"',
        '            memory: "64Mi"',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Deployment');
      expect(result).toContain('replicas: 3');
      expect(result).toContain('containerPort: 80');
      const fences = (result.match(/```/g) || []).length;
      expect(fences).toBe(2);
    });

    it('wraps a Service manifest', () => {
      const input = [
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: my-service',
        '  namespace: default',
        'spec:',
        '  type: LoadBalancer',
        '  selector:',
        '    app: nginx',
        '  ports:',
        '  - protocol: TCP',
        '    port: 80',
        '    targetPort: 8080',
        '    nodePort: 30080',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('type: LoadBalancer');
      expect(result).toContain('nodePort: 30080');
    });

    it('wraps a ConfigMap with multiline data', () => {
      const input = [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: game-config',
        'data:',
        '  game.properties: |',
        '    enemies=aliens',
        '    lives=3',
        '  ui.properties: |',
        '    color.good=purple',
        '    color.bad=yellow',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('game.properties: |');
      expect(result).toContain('enemies=aliens');
    });

    it('wraps a Secret manifest', () => {
      const input = [
        'apiVersion: v1',
        'kind: Secret',
        'metadata:',
        '  name: db-credentials',
        'type: Opaque',
        'data:',
        '  username: YWRtaW4=',
        '  password: cGFzc3dvcmQ=',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('type: Opaque');
      expect(result).toContain('username: YWRtaW4=');
    });

    it('wraps an Ingress manifest', () => {
      const input = [
        'apiVersion: networking.k8s.io/v1',
        'kind: Ingress',
        'metadata:',
        '  name: minimal-ingress',
        '  annotations:',
        '    nginx.ingress.kubernetes.io/rewrite-target: /',
        'spec:',
        '  ingressClassName: nginx',
        '  rules:',
        '  - host: example.com',
        '    http:',
        '      paths:',
        '      - path: /testpath',
        '        pathType: Prefix',
        '        backend:',
        '          service:',
        '            name: test',
        '            port:',
        '              number: 80',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('networking.k8s.io/v1');
      expect(result).toContain('nginx.ingress.kubernetes.io/rewrite-target: /');
    });

    it('wraps a HorizontalPodAutoscaler manifest', () => {
      const input = [
        'apiVersion: autoscaling/v2',
        'kind: HorizontalPodAutoscaler',
        'metadata:',
        '  name: php-apache',
        'spec:',
        '  scaleTargetRef:',
        '    apiVersion: apps/v1',
        '    kind: Deployment',
        '    name: php-apache',
        '  minReplicas: 1',
        '  maxReplicas: 10',
        '  metrics:',
        '  - type: Resource',
        '    resource:',
        '      name: cpu',
        '      target:',
        '        type: Utilization',
        '        averageUtilization: 50',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('autoscaling/v2');
      expect(result).toContain('maxReplicas: 10');
    });

    it('wraps a PersistentVolumeClaim manifest', () => {
      const input = [
        'apiVersion: v1',
        'kind: PersistentVolumeClaim',
        'metadata:',
        '  name: my-pvc',
        'spec:',
        '  accessModes:',
        '  - ReadWriteOnce',
        '  storageClassName: managed-premium',
        '  resources:',
        '    requests:',
        '      storage: 5Gi',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('ReadWriteOnce');
      expect(result).toContain('storage: 5Gi');
    });

    it('wraps a Namespace manifest', () => {
      const input = [
        'apiVersion: v1',
        'kind: Namespace',
        'metadata:',
        '  name: my-namespace',
        '  labels:',
        '    env: production',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Namespace');
    });

    it('wraps a CronJob manifest', () => {
      const input = [
        'apiVersion: batch/v1',
        'kind: CronJob',
        'metadata:',
        '  name: backup',
        'spec:',
        '  schedule: "*/5 * * * *"',
        '  jobTemplate:',
        '    spec:',
        '      template:',
        '        spec:',
        '          containers:',
        '          - name: backup',
        '            image: busybox',
        '            command: ["/bin/sh", "-c", "date; echo Hello"]',
        '          restartPolicy: OnFailure',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('schedule: "*/5 * * * *"');
      expect(result).toContain('restartPolicy: OnFailure');
    });

    it('wraps a ClusterRole with RBAC rules', () => {
      const input = [
        'apiVersion: rbac.authorization.k8s.io/v1',
        'kind: ClusterRole',
        'metadata:',
        '  name: pod-reader',
        'rules:',
        '- apiGroups: [""]',
        '  resources: ["pods"]',
        '  verbs: ["get", "watch", "list"]',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('rbac.authorization.k8s.io/v1');
      expect(result).toContain('verbs: ["get", "watch", "list"]');
    });
  });

  describe('wrapBareYamlBlocks with multi-resource responses', () => {
    it('wraps two K8s resources separated by prose', () => {
      const input = [
        'First, create the Deployment:',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: web',
        'spec:',
        '  replicas: 2',
        '',
        '',
        'Then create the Service:',
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: web-svc',
        'spec:',
        '  selector:',
        '    app: web',
        '  ports:',
        '  - port: 80',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(2);
      expect(result).toContain('kind: Deployment');
      expect(result).toContain('kind: Service');
    });

    it('handles response with fenced YAML + bare YAML + prose', () => {
      const input = [
        'Here is the current pod:',
        '```yaml',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: old-pod',
        '```',
        '',
        'And here is the updated version you need:',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: new-pod',
        '  labels:',
        '    version: v2',
        '',
        '',
        'Apply it with `kubectl apply -f pod.yaml`.',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      const fences = (result.match(/```/g) || []).length;
      expect(fences).toBe(4); // original 2 + new 2
      expect(result).toContain('name: old-pod');
      expect(result).toContain('name: new-pod');
      expect(result).toContain('version: v2');
    });

    it('handles three consecutive bare K8s resources', () => {
      const input = [
        'apiVersion: v1',
        'kind: Namespace',
        'metadata:',
        '  name: prod',
        '',
        '',
        'apiVersion: v1',
        'kind: ServiceAccount',
        'metadata:',
        '  name: deployer',
        '  namespace: prod',
        '',
        '',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: app',
        '  namespace: prod',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(3);
    });
  });

  describe('extractAIAnswer with K8s YAML end-to-end', () => {
    it('preserves fenced K8s Deployment YAML through pipeline', () => {
      const input = [
        'AI: Here is a Deployment:',
        '',
        '```yaml',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: nginx',
        'spec:',
        '  replicas: 3',
        '  selector:',
        '    matchLabels:',
        '      app: nginx',
        '  template:',
        '    metadata:',
        '      labels:',
        '        app: nginx',
        '    spec:',
        '      containers:',
        '      - name: nginx',
        '        image: nginx:latest',
        '```',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Deployment');
      expect(result).toContain('replicas: 3');
      expect(result).toContain('image: nginx:latest');
      // Should not double-wrap
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(1);
    });

    it('wraps bare K8s Service YAML through pipeline', () => {
      const input = [
        'AI: Here is the service configuration:',
        '',
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: my-svc',
        'spec:',
        '  type: ClusterIP',
        '  ports:',
        '  - port: 80',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Service');
      expect(result).toContain('type: ClusterIP');
    });

    it('handles ANSI-wrapped K8s YAML output', () => {
      const input = [
        '\x1b[1mAI:\x1b[0m Here is the ConfigMap:',
        '',
        '\x1b[32mapiVersion: v1\x1b[0m',
        '\x1b[32mkind: ConfigMap\x1b[0m',
        '\x1b[32mmetadata:\x1b[0m',
        '\x1b[32m  name: my-config\x1b[0m',
        '\x1b[32mdata:\x1b[0m',
        '\x1b[32m  key: value\x1b[0m',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: ConfigMap');
      expect(result).toContain('key: value');
    });

    it('handles Rich panel wrapped K8s YAML', () => {
      const input = [
        'AI:',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃ apiVersion: v1               ┃',
        '┃ kind: Pod                     ┃',
        '┃ metadata:                     ┃',
        '┃   name: debug-pod            ┃',
        '┃ spec:                         ┃',
        '┃   containers:                 ┃',
        '┃   - name: debug              ┃',
        '┃     image: busybox           ┃',
        '┃     command: ["sleep", "3600"]┃',
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Pod');
      expect(result).toContain('name: debug-pod');
    });
  });
});

// ─── Parser edge case tests ────────────────────────────────────────────────

describe('parser edge cases', () => {
  describe('wrapBareYamlBlocks edge cases', () => {
    it('handles YAML multi-document separator (---)', () => {
      const input = [
        'apiVersion: v1',
        'kind: Namespace',
        'metadata:',
        '  name: test',
        '---',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test-pod',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('apiVersion: v1');
      // The --- separator should be inside the fenced block, not bare text
      // (bare --- in markdown would render as a horizontal rule)
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(1);
      expect(result).toContain('---');
    });

    it('handles YAML with pipe (|) multiline string indicator', () => {
      const input = [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: scripts',
        'data:',
        '  init.sh: |',
        '    #!/bin/bash',
        '    echo "Hello, World!"',
        '    exit 0',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('init.sh: |');
    });

    it('handles YAML with folded (>) multiline string indicator', () => {
      const input = [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: desc',
        'data:',
        '  description: >',
        '    This is a long',
        '    description that gets',
        '    folded into one line.',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('description: >');
    });

    it('handles YAML with boolean-like values', () => {
      const input = [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: flags',
        'data:',
        '  enabled: "true"',
        '  debug: "false"',
        '  count: "0"',
        '  empty: ""',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('enabled: "true"');
    });

    it('handles YAML with null/empty values', () => {
      const input = [
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test',
        '  namespace:',
        '  annotations:',
        '  labels:',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('namespace:');
    });

    it('handles YAML with very deep nesting (6+ levels)', () => {
      const input = [
        'apiVersion: apps/v1',
        'kind: Deployment',
        'spec:',
        '  template:',
        '    spec:',
        '      containers:',
        '      - name: app',
        '        env:',
        '        - name: DB_HOST',
        '          valueFrom:',
        '            configMapKeyRef:',
        '              name: db-config',
        '              key: host',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('configMapKeyRef:');
      expect(result).toContain('key: host');
    });

    it('handles YAML with inline flow sequences in values', () => {
      const input = [
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test',
        'spec:',
        '  containers:',
        '  - name: test',
        '    command: ["sh", "-c", "echo hello"]',
        '    args: []',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('command: ["sh", "-c", "echo hello"]');
      expect(result).toContain('args: []');
    });

    it('handles YAML with annotation keys containing dots and slashes', () => {
      const input = [
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: annotated',
        '  annotations:',
        '    kubernetes.io/change-cause: "initial deploy"',
        '    app.kubernetes.io/managed-by: helm',
        '    meta.helm.sh/release-name: my-release',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kubernetes.io/change-cause:');
      expect(result).toContain('meta.helm.sh/release-name:');
    });

    it('handles YAML with quoted keys', () => {
      const input = [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: special',
        'data:',
        '  "key.with.dots": value1',
        "  'key-with-dashes': value2",
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('"key.with.dots": value1');
    });

    it('handles YAML followed by a markdown code block', () => {
      const input = [
        'Apply this manifest:',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test',
        '',
        '',
        'Then run this command:',
        '```bash',
        'kubectl apply -f pod.yaml',
        '```',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('```bash');
      expect(result).toContain('kubectl apply -f pod.yaml');
    });

    it('handles YAML where apiVersion value is on the next line', () => {
      const input = ['apiVersion:', '  v1', 'kind: Pod', 'metadata:', '  name: test'].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('apiVersion:');
    });

    it('handles YAML with comment lines interspersed', () => {
      const input = [
        'apiVersion: v1',
        '# This is a pod for testing',
        'kind: Pod',
        'metadata:',
        '  name: test',
        '  # Add more labels as needed',
        '  labels:',
        '    app: test',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('# This is a pod for testing');
      expect(result).toContain('# Add more labels as needed');
    });

    it('handles YAML with single blank line (does not split)', () => {
      const input = ['apiVersion: v1', 'kind: Pod', '', 'metadata:', '  name: test'].join('\n');
      const result = wrapBareYamlBlocks(input);
      // Single blank line should be included in the same block
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(1);
      expect(result).toContain('name: test');
    });

    it('handles YAML with resource quantity strings', () => {
      const input = [
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: resource-pod',
        'spec:',
        '  containers:',
        '  - name: app',
        '    resources:',
        '      limits:',
        '        cpu: "2"',
        '        memory: 2Gi',
        '        nvidia.com/gpu: "1"',
        '      requests:',
        '        cpu: 500m',
        '        memory: 256Mi',
      ].join('\n');
      const result = wrapBareYamlBlocks(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('memory: 2Gi');
      expect(result).toContain('nvidia.com/gpu: "1"');
      expect(result).toContain('cpu: 500m');
    });
  });

  describe('looksLikeYaml edge cases', () => {
    it('accepts keys with dots like K8s annotations', () => {
      expect(looksLikeYaml('kubernetes.io/name: test')).toBe(true);
    });

    it('accepts keys with slashes', () => {
      expect(looksLikeYaml('app.kubernetes.io/version: v1')).toBe(true);
    });

    it('accepts keys ending with colon and no space', () => {
      expect(looksLikeYaml('metadata:')).toBe(true);
    });

    it('accepts YAML list items with nested keys', () => {
      expect(looksLikeYaml('- name: test')).toBe(true);
    });

    it('accepts bare list marker', () => {
      expect(looksLikeYaml('-')).toBe(true);
    });

    it('accepts YAML anchors (&)', () => {
      expect(looksLikeYaml('defaults: &defaults')).toBe(true);
    });

    it('accepts YAML aliases (*)', () => {
      // *defaults would start with *, which isn't a YAML key/list/flow
      expect(looksLikeYaml('<<: *defaults')).toBe(false);
    });

    it('rejects bare prose without colons', () => {
      expect(looksLikeYaml('This is just text')).toBe(false);
    });

    it('rejects markdown bold/italic markers', () => {
      expect(looksLikeYaml('**bold text**')).toBe(false);
    });

    it('accepts numeric-starting keys (\\w includes digits)', () => {
      expect(looksLikeYaml('8080: http')).toBe(true);
    });

    it('accepts keys with hyphens', () => {
      expect(looksLikeYaml('my-key: my-value')).toBe(true);
    });

    it('accepts indented YAML continuation (empty line treated as YAML)', () => {
      expect(looksLikeYaml('')).toBe(true);
    });

    it('accepts YAML document separator (---)', () => {
      expect(looksLikeYaml('---')).toBe(true);
    });

    it('accepts YAML document end marker (...)', () => {
      expect(looksLikeYaml('...')).toBe(true);
    });

    it('rejects longer dashes (markdown horizontal rule)', () => {
      // ---- is not a YAML separator (only exactly --- is)
      expect(looksLikeYaml('----')).toBe(false);
    });
  });

  describe('cleanTerminalFormatting edge cases', () => {
    it('strips Rich border from around K8s YAML output', () => {
      const input = [
        '┏━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃ apiVersion: v1         ┃',
        '┃ kind: Service          ┃',
        '┃ metadata:              ┃',
        '┃   name: my-svc         ┃',
        '┗━━━━━━━━━━━━━━━━━━━━━━━┛',
      ].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('apiVersion: v1');
      expect(result).toContain('kind: Service');
      expect(result).not.toContain('┃');
      expect(result).not.toContain('┏');
    });

    it('handles Rich panel with mismatched widths', () => {
      const input = [
        '┏━━━━━━━━━┓',
        '┃ short ┃',
        '┃ this is a much longer line ┃',
        '┗━━━━━━━━━┛',
      ].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('short');
      expect(result).toContain('this is a much longer line');
    });

    it('preserves fenced yaml block content', () => {
      const input = [
        '```yaml',
        '┃ this is inside a code fence',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '```',
      ].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('┃ this is inside a code fence');
      expect(result).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });

    it('handles alternating panel borders and content', () => {
      const input = [
        '┏━━━━━━━━━━┓',
        '┃ Block 1  ┃',
        '┗━━━━━━━━━━┛',
        'Some prose text here',
        '┏━━━━━━━━━━┓',
        '┃ Block 2  ┃',
        '┗━━━━━━━━━━┛',
      ].join('\n');
      const result = cleanTerminalFormatting(input);
      expect(result).toContain('Block 1');
      expect(result).toContain('Some prose text here');
      expect(result).toContain('Block 2');
    });
  });

  describe('stripAgentNoise edge cases', () => {
    it('strips agent noise before K8s YAML content', () => {
      const lines = [
        'root@agent:/# python /app/aks-agent.py',
        '┏━━━ Task List ━━━┓',
        '+----+-------------+--------+',
        '| ID | Description | Status |',
        '+----+-------------+--------+',
        '| t1 | Get pods    | [✓] completed |',
        '+----+-------------+--------+',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test',
      ];
      const result = stripAgentNoise(lines);
      expect(result).toContain('apiVersion: v1');
      expect(result).toContain('kind: Pod');
      expect(result.join('\n')).not.toContain('root@agent');
    });

    it('preserves K8s YAML inside fenced block among noise', () => {
      const lines = [
        'root@agent:/# command',
        '```yaml',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: app',
        '```',
        'root@agent:/#',
      ];
      const result = stripAgentNoise(lines);
      expect(result).toContain('```yaml');
      expect(result).toContain('apiVersion: apps/v1');
      expect(result).toContain('```');
    });
  });

  describe('extractAIAnswer edge cases', () => {
    it('handles response with only YAML and no prose', () => {
      const input = [
        'AI:',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: test-pod',
        'spec:',
        '  containers:',
        '  - name: test',
        '    image: alpine',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Pod');
      expect(result).toContain('image: alpine');
    });

    it('handles response with multiple interspersed code blocks', () => {
      const input = [
        'AI: Here are the resources:',
        '',
        '```yaml',
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: config',
        '```',
        '',
        'And the TypeScript client:',
        '',
        '```typescript',
        "import * as k8s from '@kubernetes/client-node';",
        'const kc = new k8s.KubeConfig();',
        'kc.loadFromDefault();',
        '```',
        '',
        'And a Mermaid diagram:',
        '',
        '```mermaid',
        'graph TD',
        '  A[ConfigMap] --> B[Pod]',
        '  B --> C[Service]',
        '```',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('```typescript');
      expect(result).toContain('```mermaid');
      expect(result).toContain('kind: ConfigMap');
      expect(result).toContain('kc.loadFromDefault()');
      expect(result).toContain('A[ConfigMap] --> B[Pod]');
    });

    it('handles response where AI says apiVersion in prose', () => {
      const input = [
        'AI: You should set apiVersion: apps/v1 in your Deployment manifest.',
        'The kind should be Deployment.',
      ].join('\n');
      const result = extractAIAnswer(input);
      // Should not wrap prose as YAML
      expect(result).toContain('apiVersion: apps/v1');
    });

    it('handles response with kubectl output table', () => {
      const input = [
        'AI: Here are your pods:',
        '',
        '```',
        'NAME                     READY   STATUS    RESTARTS   AGE',
        'nginx-6b474476c4-abc12   1/1     Running   0          2d',
        'nginx-6b474476c4-def34   1/1     Running   0          2d',
        '```',
        '',
        'All pods are running.',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('nginx-6b474476c4-abc12');
      expect(result).toContain('All pods are running.');
    });

    it('handles response with YAML containing emoji in labels', () => {
      const input = [
        'AI: Here is the manifest:',
        '',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '  name: demo',
        '  labels:',
        '    app: demo',
        'spec:',
        '  containers:',
        '  - name: web',
        '    image: nginx',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('app: demo');
    });

    it('handles malformed response with partial YAML then error', () => {
      const input = [
        'AI: Here is your Deployment:',
        '',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name:',
        '',
        '',
        'Error: I was unable to complete the manifest due to missing information.',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Deployment');
      expect(result).toContain('Error: I was unable to complete');
    });

    it('handles response with Windows-style CRLF line endings', () => {
      const input =
        'AI: Here is the pod:\r\n\r\napiVersion: v1\r\nkind: Pod\r\nmetadata:\r\n  name: test\r\n';
      const result = extractAIAnswer(input);
      expect(result).toContain('kind: Pod');
    });

    it('handles response with zero-width characters', () => {
      const input = [
        'AI: Here is the config:',
        '',
        'apiVersion: v1',
        'kind: \u200BConfigMap',
        'metadata:',
        '  name: test',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('apiVersion: v1');
    });

    it('handles response with tab indentation instead of spaces', () => {
      const input = [
        'AI: Here is the pod:',
        '',
        'apiVersion: v1',
        'kind: Pod',
        'metadata:',
        '\tname: test',
        'spec:',
        '\tcontainers:',
        '\t- name: nginx',
        '\t  image: nginx',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('apiVersion: v1');
      expect(result).toContain('kind: Pod');
    });

    it('wraps multi-document YAML with --- into a single fenced block', () => {
      const input = [
        'AI: Apply these resources:',
        '',
        'apiVersion: v1',
        'kind: Namespace',
        'metadata:',
        '  name: prod',
        '---',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: app',
        '  namespace: prod',
      ].join('\n');
      const result = extractAIAnswer(input);
      // Both documents should be in a single fenced block
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(1);
      expect(result).toContain('kind: Namespace');
      expect(result).toContain('---');
      expect(result).toContain('kind: Deployment');
    });

    it('does not treat --- in prose as YAML', () => {
      const input = [
        'AI: Here is some info.',
        '',
        'Kubernetes is a container orchestration platform.',
        '',
        'That is all I have to share.',
      ].join('\n');
      const result = extractAIAnswer(input);
      // No YAML fence should be added for prose-only content
      expect(result).not.toContain('```yaml');
    });
  });

  describe('isAgentNoiseLine edge cases', () => {
    it('detects noise with long paths', () => {
      expect(isAgentNoiseLine('root@long-hostname-12345:/very/deep/path/to/workspace#')).toBe(true);
    });

    it('does not flag K8s resource lines as noise', () => {
      expect(isAgentNoiseLine('apiVersion: v1')).toBe(false);
      expect(isAgentNoiseLine('kind: Deployment')).toBe(false);
      expect(isAgentNoiseLine('  name: my-pod')).toBe(false);
      expect(isAgentNoiseLine('  replicas: 3')).toBe(false);
      expect(isAgentNoiseLine('  - containerPort: 80')).toBe(false);
    });

    it('does not flag prose that discusses K8s concepts as noise', () => {
      expect(isAgentNoiseLine('The pod is in CrashLoopBackOff state.')).toBe(false);
      expect(isAgentNoiseLine('You need to create a Service of type LoadBalancer.')).toBe(false);
    });

    it('detects table border variations', () => {
      expect(isAgentNoiseLine('+---+---+---+')).toBe(true);
      // = sign table borders (e.g. Python tabulate double_grid format)
      expect(isAgentNoiseLine('+====+====+')).toBe(true);
      expect(isAgentNoiseLine('+--+-+')).toBe(true);
    });

    it('preserves GFM markdown table separator rows', () => {
      // GFM table separators use |---|---| (no + characters) and must be preserved
      // for markdown tables to render correctly
      expect(isAgentNoiseLine('|----------|--------|----------|')).toBe(false);
      expect(isAgentNoiseLine('| --- | --- | --- |')).toBe(false);
      expect(isAgentNoiseLine('|:---|:---:|---:|')).toBe(false);
    });

    it('detects task table data rows with various statuses', () => {
      expect(isAgentNoiseLine('| t1 | Check status | [✓] completed |')).toBe(true);
      expect(isAgentNoiseLine('| t2 | Fix issue   | [~] in_progress |')).toBe(true);
      expect(isAgentNoiseLine('| t3 | Test it     | [ ] pending |')).toBe(true);
    });
  });
});

// ─── Real-world agent response tests (from dev console captures) ───────────
// All identifiers (pod names, cluster names, IPs) are redacted / genericised.

describe('real-world agent responses', () => {
  describe('extractAIAnswer with real exec output containing bracketed paste and prompts', () => {
    it('extracts markdown answer from output with bracketed paste mode sequences', () => {
      const input = [
        '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
        "python /app/aks-agent.py ask 'what pods are running?'",
        '\x1b[?2004l',
        "Loaded models: ['gpt-4']",
        'Task List:',
        '+------+------------------+---------+',
        '| ID   | Description      | Status  |',
        '+------+------------------+---------+',
        '| t1   | Check pods       | [~] in_progress |',
        '+------+------------------+---------+',
        'AI: Here are the running pods in the `kube-system` namespace:',
        '',
        '| Pod Name | Status | Restarts |',
        '|----------|--------|----------|',
        '| coredns-7c6bf4f | Running | 0 |',
        '| kube-proxy-abc12 | Running | 0 |',
        '| metrics-server-xyz | Running | 2 |',
        '',
        'All pods are healthy.',
        'root@aks-agent-abc1234def-x9y8z:/app#',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('Here are the running pods');
      expect(result).toContain('kube-system');
      expect(result).toContain('coredns-7c6bf4f');
      expect(result).toContain('All pods are healthy.');
      // GFM table separator must be preserved for markdown table rendering
      expect(result).toContain('|----------|--------|----------|');
      expect(result).not.toContain('root@aks-agent');
      expect(result).not.toContain('Task List');
      expect(result).not.toContain('[?2004');
    });

    it('extracts YAML deployment from output with bash continuation prompts', () => {
      const input = [
        '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
        "python /app/aks-agent.py ask 'IMPORTANT INSTRUCTIONS:",
        '\x1b[?2004l',
        '\x1b[?2004h>',
        '- When returning any YAML content, always wrap it inside a markdown code block.',
        '\x1b[?2004l',
        '\x1b[?2004h>',
        'Now answer the following new question:',
        '\x1b[?2004l',
        '\x1b[?2004h>',
        "show me a deployment for nginx'",
        '\x1b[?2004l',
        "Loaded models: ['gpt-4']",
        'AI: Here is a Deployment for nginx:',
        '',
        '```yaml',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: nginx-deployment',
        '  namespace: default',
        'spec:',
        '  replicas: 3',
        '  selector:',
        '    matchLabels:',
        '      app: nginx',
        '  template:',
        '    metadata:',
        '      labels:',
        '        app: nginx',
        '    spec:',
        '      containers:',
        '      - name: nginx',
        '        image: nginx:1.25',
        '        ports:',
        '        - containerPort: 80',
        '```',
        '',
        'You can apply it with `kubectl apply -f deployment.yaml`.',
        'root@aks-agent-abc1234def-x9y8z:/app#',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('Here is a Deployment for nginx');
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Deployment');
      expect(result).toContain('nginx-deployment');
      expect(result).toContain('replicas: 3');
      expect(result).toContain('kubectl apply');
      expect(result).not.toContain('root@aks-agent');
      expect(result).not.toContain('IMPORTANT INSTRUCTIONS');
      expect(result).not.toContain('[?2004');
      // Should not double-wrap YAML
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(1);
    });

    it('extracts bare YAML from output with ANSI color codes and Rich formatting', () => {
      const input = [
        '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
        "python /app/aks-agent.py ask 'create a service'",
        '\x1b[?2004l',
        "\x1b[1mLoaded models:\x1b[0m [\x1b[32m'gpt-4'\x1b[0m]",
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃ Task List                       ┃',
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        '| t1 | Create service | [✓] completed |',
        '\x1b[1mAI:\x1b[0m Here is a Service:',
        '',
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: my-service',
        '  namespace: default',
        'spec:',
        '  type: LoadBalancer',
        '  selector:',
        '    app: nginx',
        '  ports:',
        '  - protocol: TCP',
        '    port: 80',
        '    targetPort: 8080',
        '',
        'This Service exposes your application on port 80.',
        'root@aks-agent-abc1234def-x9y8z:/app#',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('Here is a Service');
      expect(result).toContain('```yaml');
      expect(result).toContain('kind: Service');
      expect(result).toContain('type: LoadBalancer');
      expect(result).toContain('This Service exposes your application');
      expect(result).not.toContain('root@aks-agent');
      expect(result).not.toContain('Task List');
      expect(result).not.toContain('┏');
      expect(result).not.toContain('[✓] completed');
    });

    it('extracts multi-paragraph prose response with diagnostic info', () => {
      const input = [
        '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
        "python /app/aks-agent.py ask 'why is my pod crashing?'",
        '\x1b[?2004l',
        "Loaded models: ['gpt-4']",
        '+------+-------------------+-------------------+',
        '| t1   | Check pod status  | [✓] completed     |',
        '| t2   | Get pod logs      | [✓] completed     |',
        '+------+-------------------+-------------------+',
        'AI: Your pod `web-app-6f8b9c4d7-x2k9p` is in a **CrashLoopBackOff** state. Here is what I found:',
        '',
        '## Root Cause',
        '',
        'The container is failing because it cannot connect to the database. The logs show:',
        '',
        '```',
        'Error: connect ECONNREFUSED 10.0.0.5:5432',
        '    at TCPConnectWrap.afterConnect [as oncomplete]',
        '```',
        '',
        '## Recommended Steps',
        '',
        '1. Check if the database pod is running: `kubectl get pods -l app=postgres`',
        '2. Verify the service endpoint: `kubectl get endpoints postgres-svc`',
        '3. Check network policies that might block traffic between namespaces',
        '',
        '> **Note**: The pod has restarted 15 times in the last hour.',
        'root@aks-agent-abc1234def-x9y8z:/app#',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('CrashLoopBackOff');
      expect(result).toContain('## Root Cause');
      expect(result).toContain('ECONNREFUSED');
      expect(result).toContain('## Recommended Steps');
      expect(result).toContain('kubectl get pods -l app=postgres');
      expect(result).toContain('> **Note**');
      expect(result).not.toContain('root@aks-agent');
      expect(result).not.toContain('Loaded models');
      expect(result).not.toContain('[✓] completed');
    });

    it('extracts bullet list response with conversation history echo stripped', () => {
      const input = [
        '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
        "python /app/aks-agent.py ask 'IMPORTANT INSTRUCTIONS:",
        '\x1b[?2004l',
        '\x1b[?2004h>',
        '- When returning any YAML content, always wrap it inside a markdown code block using ```yaml ... ``` so it renders properly.',
        '\x1b[?2004l',
        '\x1b[?2004h>',
        '- The conversation history below shows all previously asked questions and your answers.',
        '\x1b[?2004l',
        '\x1b[?2004h>',
        'Now answer the following new question:',
        '\x1b[?2004l',
        '\x1b[?2004h>',
        "what best practices should I follow for AKS?'",
        '\x1b[?2004l',
        "Loaded models: ['gpt-4']",
        'AI: Here are the key best practices for AKS:',
        '',
        '- **Use managed identities** instead of service principals for authentication',
        '- **Enable Azure Policy** to enforce organizational standards',
        '- **Configure autoscaling** for both cluster and pods:',
        '  - Cluster Autoscaler for node pools',
        '  - Horizontal Pod Autoscaler (HPA) for workloads',
        '- **Use Azure CNI** networking for better integration with VNets',
        '- **Enable monitoring** with Container Insights and Prometheus',
        '- **Implement network policies** to control pod-to-pod traffic',
        '- **Use node pools** to separate system and user workloads',
        '',
        'For more details, see the [AKS best practices documentation](https://learn.microsoft.com/en-us/azure/aks/best-practices).',
        'root@aks-agent-abc1234def-x9y8z:/app#',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('key best practices for AKS');
      expect(result).toContain('- **Use managed identities**');
      expect(result).toContain('- Cluster Autoscaler for node pools');
      expect(result).toContain('- Horizontal Pod Autoscaler');
      expect(result).toContain('AKS best practices documentation');
      expect(result).not.toContain('IMPORTANT INSTRUCTIONS');
      expect(result).not.toContain('conversation history');
      expect(result).not.toContain('root@aks-agent');
      expect(result).not.toContain('[?2004');
    });

    it('extracts response with multiple YAML resources and explanation', () => {
      const input = [
        '\x1b[?2004hroot@aks-agent-abc1234def-x9y8z:/app#',
        "python /app/aks-agent.py ask 'create a complete app with deployment and service'",
        '\x1b[?2004l',
        "Loaded models: ['gpt-4']",
        '| t1 | Create resources | [✓] completed |',
        'AI: Here is a complete application setup with a Deployment and Service:',
        '',
        '### Deployment',
        '',
        '```yaml',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: web-app',
        '  labels:',
        '    app: web-app',
        'spec:',
        '  replicas: 2',
        '  selector:',
        '    matchLabels:',
        '      app: web-app',
        '  template:',
        '    metadata:',
        '      labels:',
        '        app: web-app',
        '    spec:',
        '      containers:',
        '      - name: web',
        '        image: myregistry.azurecr.io/web-app:latest',
        '        ports:',
        '        - containerPort: 3000',
        '        resources:',
        '          requests:',
        '            cpu: 100m',
        '            memory: 128Mi',
        '          limits:',
        '            cpu: 250m',
        '            memory: 256Mi',
        '```',
        '',
        '### Service',
        '',
        '```yaml',
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: web-app-svc',
        'spec:',
        '  type: LoadBalancer',
        '  selector:',
        '    app: web-app',
        '  ports:',
        '  - port: 80',
        '    targetPort: 3000',
        '```',
        '',
        'Apply both with: `kubectl apply -f app.yaml`',
        'root@aks-agent-abc1234def-x9y8z:/app#',
      ].join('\n');
      const result = extractAIAnswer(input);
      expect(result).toContain('complete application setup');
      expect(result).toContain('### Deployment');
      expect(result).toContain('### Service');
      // Two YAML blocks
      const yamlFences = (result.match(/```yaml/g) || []).length;
      expect(yamlFences).toBe(2);
      expect(result).toContain('kind: Deployment');
      expect(result).toContain('kind: Service');
      expect(result).toContain('myregistry.azurecr.io/web-app:latest');
      expect(result).toContain('kubectl apply');
      expect(result).not.toContain('root@aks-agent');
      expect(result).not.toContain('Loaded models');
    });

    it('normalizes terminal-formatted deployment guidance into markdown lists and code blocks', () => {
      const input = [
        'stty -echo',
        '\x1b[?2004l',
        '\x1b[?2004hroot@aks-agent-redacted:/app# ',
        '\x1b[?2004l',
        '',
        '\x1b[?2004h',
        '> ',
        '\x1b[?2004l',
        '',
        '\x1b[?2004h> ',
        '\x1b[?2004l',
        '',
        "Loaded models: ['azure/gpt-5.x']",
        '✅ Toolset core_investigation',
        '✅ Toolset internet',
        'Received session ID: mcp-session-REDACTED',
        'Negotiated protocol version: 2025-06-18',
        '✅ Toolset aks_mcp',
        'Using 3 datasources (toolsets). To refresh: use flag `--refresh-toolsets`',
        'NO ENABLED LOGGING TOOLSET',
        'Using model: azure/gpt-5.x (272,000 total tokens, 54,400 output tokens)',
        'This tool uses AI to generate responses and may not always be accurate.',
        'User: IMPORTANT INSTRUCTIONS:',
        '- When returning any YAML content, always wrap it inside a markdown code block',
        'using ```yaml ... ``` so it renders properly.',
        '- The conversation history below shows all previously asked questions and your',
        'answers. Keep that context in mind and answer accordingly — do not repeat',
        'information already provided unless the user explicitly asks for it.',
        'Now answer the following new question:',
        'How do I deploy a python application?',
        'The AI requested 1 tool call(s).',
        'Running tool #1 TodoWrite: Update investigation tasks',
        'Task List:',
        '+----+--------------------------------------+-----------------+',
        '| ID | Content                              | Status          |',
        '+----+--------------------------------------+-----------------+',
        '| 1  | Clarify deployment target           | [~] in_progress |',
        '| 2  | Provide deployment examples         | [ ] pending     |',
        '| 3  | Include runtime best practices      | [ ] pending     |',
        '| 4  | Final review                        | [ ] pending     |',
        '+----+--------------------------------------+-----------------+',
        'Finished #1 in 0.00s, output length: 787 characters (12 lines) - /show 1 to',
        'view contents',
        '',
        '\x1b[1;96mAI:\x1b[0m ',
        'Which deployment target do you mean?',
        '',
        '\x1b[1;33m 1 \x1b[0m\x1b[1mKubernetes (AKS)\x1b[0m (Deployment/Service/Ingress YAML)',
        '\x1b[1;33m 2 \x1b[0m\x1b[1mContainer on a VM\x1b[0m (Dockerfile + \x1b[1;36;40mdocker run\x1b[0m or compose)',
        '\x1b[1;33m 3 \x1b[0m\x1b[1mPaaS\x1b[0m (Azure App Service / Container Apps / Cloud Run / Heroku-like)',
        '\x1b[1;33m 4 \x1b[0m\x1b[1mBare VM\x1b[0m (systemd + nginx + venv)',
        '',
        'Reply with: \x1b[1mtarget + framework\x1b[0m (e.g., “AKS + FastAPI” or “Docker VM + Flask”)',
        'and \x1b[1mhow it should be exposed\x1b[0m (public HTTP, internal-only, background',
        'worker/cron).',
        '',
        'While you answer, here’s a solid default pattern that works almost everywhere:',
        '',
        '                 \x1b[1;4mPython web app deployment checklist (generic)\x1b[0m',
        '',
        '\x1b[1;33m • \x1b[0mCreate \x1b[1;36;40mrequirements.txt\x1b[0m (or \x1b[1;36;40mpyproject.toml\x1b[0m)',
        '\x1b[1;33m • \x1b[0mAdd a production server:',
        '\x1b[1;33m   \x1b[0m\x1b[1;33m • \x1b[0m\x1b[1mFlask/Django (WSGI):\x1b[0m \x1b[1;36;40mgunicorn\x1b[0m',
        '\x1b[1;33m   \x1b[0m\x1b[1;33m • \x1b[0m\x1b[1mFastAPI/Starlette (ASGI):\x1b[0m \x1b[1;36;40muvicorn\x1b[0m (often behind gunicorn worker)',
        '\x1b[1;33m • \x1b[0mRead config from \x1b[1menv vars\x1b[0m (no secrets in code)',
        '\x1b[1;33m • \x1b[0mAdd \x1b[1;36;40m/healthz\x1b[0m endpoint for health checks',
        '\x1b[1;33m • \x1b[0mPin Python version (e.g., \x1b[1;36;40mpython:3.12-slim\x1b[0m)',
        '',
        '          \x1b[1;4mExample: containerize (works for AKS, any container runtime)\x1b[0m',
        '',
        '\x1b[1mDockerfile (FastAPI example)\x1b[0m',
        '',
        '\x1b[40m \x1b[0m\x1b[96;40mFROM\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40mpython:3.12-slim\x1b[0m',
        '\x1b[40m \x1b[0m\x1b[96;40mWORKDIR\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m/app\x1b[0m',
        '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mrequirements.txt\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m',
        '\x1b[40m \x1b[0m\x1b[96;40mRUN\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpip install --no-cache-dir -r requirements.txt\x1b[0m',
        '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m',
        '\x1b[40m \x1b[0m\x1b[96;40mEXPOSE\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m8000\x1b[0m',
        '\x1b[40m \x1b[0m\x1b[96;40mCMD\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m[\x1b[0m\x1b[93;40m"uvicorn"\x1b[0m\x1b[97;40m, "main:app", "--host", "0.0.0.0", "--port", "8000"]\x1b[0m',
        '',
        'Build + run:',
        '',
        '\x1b[40m \x1b[0m\x1b[97;40mdocker build -t myapp:latest .\x1b[0m',
        '\x1b[40m \x1b[0m\x1b[97;40mdocker run --rm -p 8000:8000 myapp:latest\x1b[0m',
        '',
        'I can give you the exact \x1b[1mKubernetes YAML\x1b[0m (Deployment/Service/Ingress) or',
        '\x1b[1msystemd/nginx\x1b[0m setup once you confirm the target.',
        '\x1b[?2004hroot@aks-agent-redacted:/app# ',
      ].join('\n');

      const result = extractAIAnswer(input);
      expect(result).toContain('Which deployment target do you mean?');
      expect(result).toContain('1. Kubernetes (AKS) (Deployment/Service/Ingress YAML)');
      expect(result).toContain('2. Container on a VM (Dockerfile + docker run or compose)');
      expect(result).toContain('Python web app deployment checklist (generic)');
      expect(result).toContain('```');
      expect(result).toContain('FROM python:3.12-slim');
      expect(result).toContain('docker build -t myapp:latest .');
      expect(result).not.toContain('Task List');
      expect(result).not.toContain('Received session ID');
      expect(result).not.toContain('root@aks-agent-redacted');
    });
  });

  it('extracts indented multi-document YAML (Java deployment) with commands and headings', () => {
    const input = [
      'AI:',
      'Kubernetes YAML (Namespace + Deployment + Service)',
      ' apiVersion: v1',
      ' kind: Namespace',
      ' metadata:',
      '   name: demo',
      ' ---',
      ' apiVersion: apps/v1',
      ' kind: Deployment',
      ' metadata:',
      '   name: java-demo',
      '   namespace: demo',
      '   labels:',
      '     app: java-demo',
      ' spec:',
      '   replicas: 2',
      '   selector:',
      '     matchLabels:',
      '       app: java-demo',
      '   template:',
      '     metadata:',
      '       labels:',
      '         app: java-demo',
      '     spec:',
      '       containers:',
      '         - name: java-demo',
      '           image: myacr.azurecr.io/java-demo:1.0.0',
      '           imagePullPolicy: IfNotPresent',
      '           ports:',
      '             - name: http',
      '               containerPort: 8080',
      '           env:',
      '             - name: JAVA_TOOL_OPTIONS',
      '               value: "-XX:MaxRAMPercentage=75.0 -XX:+UseG1GC"',
      '             - name: SPRING_PROFILES_ACTIVE',
      '               value: "prod"',
      '           resources:',
      '             requests:',
      '               cpu: "100m"',
      '               memory: "256Mi"',
      '             limits:',
      '               cpu: "500m"',
      '               memory: "512Mi"',
      '           readinessProbe:',
      '             httpGet:',
      '               path: /actuator/health/readiness',
      '               port: http',
      '             initialDelaySeconds: 10',
      '             periodSeconds: 5',
      '           livenessProbe:',
      '             httpGet:',
      '               path: /actuator/health/liveness',
      '               port: http',
      '             initialDelaySeconds: 30',
      '             periodSeconds: 10',
      ' ---',
      ' apiVersion: v1',
      ' kind: Service',
      ' metadata:',
      '   name: java-demo',
      '   namespace: demo',
      ' spec:',
      '   type: ClusterIP',
      '   selector:',
      '     app: java-demo',
      '   ports:',
      '     - name: http',
      '       port: 80',
      '       targetPort: http',
      '',
      'Apply:',
      'kubectl apply -f app.yaml',
      'kubectl get pods -n demo',
      'kubectl get svc -n demo',
      '',
      '                     2) Build + push image (typical flow)',
      '',
      '# build',
      'docker build -t myacr.azurecr.io/java-demo:1.0.0 .',
    ].join('\n');

    const result = extractAIAnswer(input);
    // YAML should be in a fenced block and dedented
    expect(result).toContain('```yaml');
    expect(result).toContain('apiVersion: v1');
    expect(result).toContain('kind: Deployment');
    expect(result).toContain('kind: Service');
    // Apply: should be outside the fence
    const yamlClose = result.indexOf('```\n', result.indexOf('```yaml') + 7);
    const applyIdx = result.indexOf('Apply:');
    expect(yamlClose).toBeLessThan(applyIdx);
    // Commands should be present
    expect(result).toContain('kubectl apply -f app.yaml');
    expect(result).toContain('docker build -t myacr.azurecr.io/java-demo:1.0.0 .');
  });
});

describe('collapseTerminalBlankLines', () => {
  it('removes single blank line between space-prefixed code lines', () => {
    const input = ' FROM maven:3.9\n\n WORKDIR /src\n\n COPY pom.xml .';
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe(' FROM maven:3.9\n WORKDIR /src\n COPY pom.xml .');
  });

  it('collapses multiple blank lines between code lines to one', () => {
    const input = ' RUN mvn package\n\n\n\n FROM eclipse-temurin:17-jre';
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe(' RUN mvn package\n\n FROM eclipse-temurin:17-jre');
  });

  it('joins prose continuation lines (long line wrapped at terminal width)', () => {
    const input =
      "Here's a minimal, production-ready example for deploying a Java (Spring Boot)\n\napp on Kubernetes.";
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe(
      "Here's a minimal, production-ready example for deploying a Java (Spring Boot)\napp on Kubernetes."
    );
  });

  it('joins uppercase continuation when previous line lacks sentence punctuation', () => {
    const input = "Adjust health probe paths if you don't use Spring Boot\n\nActuator.";
    const result = collapseTerminalBlankLines(input);
    // "...Spring Boot" (55 chars) is short, so NOT joined
    expect(result).toBe("Adjust health probe paths if you don't use Spring Boot\n\nActuator.");
  });

  it('joins uppercase continuation when previous line is long and lacks ending punctuation', () => {
    const input =
      "app on Kubernetes. Adjust health probe paths if you don't use Spring Boot\n\nActuator.";
    const result = collapseTerminalBlankLines(input);
    // "...Spring Boot" (74 chars) >= 60, doesn't end with punctuation → join
    expect(result).toBe(
      "app on Kubernetes. Adjust health probe paths if you don't use Spring Boot\nActuator."
    );
  });

  it('keeps blank between short line and next paragraph', () => {
    const input = 'Actuator.\n\nDockerfile (multi-stage build):';
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe('Actuator.\n\nDockerfile (multi-stage build):');
  });

  it('collapses runs of 3+ blank lines to 1 in general case', () => {
    const input = 'Dockerfile (multi-stage build):\n\n\n\n # syntax=docker/dockerfile:1';
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe('Dockerfile (multi-stage build):\n\n # syntax=docker/dockerfile:1');
  });

  it('does not alter content inside code fences', () => {
    const input = '```\n FROM x\n\n WORKDIR y\n```';
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe('```\n FROM x\n\n WORKDIR y\n```');
  });

  it('handles mixed prose and code sections', () => {
    const input = [
      "Here's a minimal, production-ready example for deploying a Java (Spring Boot)",
      '',
      'app on Kubernetes.',
      '',
      'Dockerfile:',
      '',
      ' # syntax=docker/dockerfile:1',
      '',
      ' FROM maven:3.9',
      '',
      ' WORKDIR /src',
    ].join('\n');
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe(
      [
        "Here's a minimal, production-ready example for deploying a Java (Spring Boot)",
        'app on Kubernetes.',
        '',
        'Dockerfile:',
        '',
        ' # syntax=docker/dockerfile:1',
        ' FROM maven:3.9',
        ' WORKDIR /src',
      ].join('\n')
    );
  });
});

describe('looksLikeShellOrDockerCodeLine — Dockerfile parser directives', () => {
  it('detects # syntax=docker/dockerfile:1', () => {
    expect(looksLikeShellOrDockerCodeLine('# syntax=docker/dockerfile:1')).toBe(true);
  });

  it('detects # escape=`', () => {
    expect(looksLikeShellOrDockerCodeLine('# escape=`')).toBe(true);
  });

  it('detects # check=error=true', () => {
    expect(looksLikeShellOrDockerCodeLine('# check=error=true')).toBe(true);
  });
});

describe('extractAIAnswer — terminal-formatted Java deployment with Rich code blocks', () => {
  // Simulates the real-world terminal output where Rich renders Dockerfile and
  // YAML code blocks with [40m (black background) ANSI formatting, producing
  // space-prefixed lines and blank lines between every content line.
  const rawJavaDeployTerminal = [
    'stty -echo',
    '\x1b[?2004l',
    '\x1b[?2004hroot@aks-agent-846df6ffb-tz9xn:/app# ',
    '\x1b[?2004l',
    '',
    '\x1b[?2004h',
    '> ',
    '\x1b[?2004l',
    '',
    "Loaded models: \x1b[1m[\x1b[0m\x1b[32m'azure/gpt-5-2'\x1b[0m\x1b[1m]\x1b[0m",
    '\u2705 Toolset core_investigation',
    'Using \x1b[1;36m4\x1b[0m datasources',
    'NO ENABLED LOGGING TOOLSET',
    '\x1b[1;97mUser:\x1b[0m IMPORTANT INSTRUCTIONS:',
    'Now answer: Show me an example java application deploy on kubernetes?',
    'The AI requested \x1b[1;36m1\x1b[0m tool call.',
    'Running tool #1 TodoWrite: Update tasks',
    'Task List:',
    '+----+----------------------------+---------------+',
    '| ID | Content                    | Status        |',
    '+----+----------------------------+---------------+',
    '| t1 | Create K8s YAML            | completed     |',
    '+----+----------------------------+---------------+',
    '  Finished #1 in 0.00s',
    '\x1b[1;96mAI:\x1b[0m ',
    "Here's a minimal, production-ready example for deploying a Java (Spring Boot)   ",
    '',
    "app on Kubernetes. Adjust health probe paths if you don't use Spring Boot       ",
    '',
    'Actuator.                                                                       ',
    '',
    '',
    'Dockerfile (multi-stage build):                                                 ',
    '',
    '',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40m# syntax=docker/dockerfile:1\x1b[0m\x1b[40m                                                  \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mFROM maven:3.9-eclipse-temurin-17 AS build\x1b[0m\x1b[40m                                    \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mWORKDIR /src\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mCOPY pom.xml .\x1b[0m\x1b[40m                                                                \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mRUN mvn -B -q -DskipTests package\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[40m                                                                              \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mFROM eclipse-temurin:17-jre\x1b[0m\x1b[40m                                                   \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mWORKDIR /app\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mCOPY --from=build /src/target/app.jar ./app.jar\x1b[0m\x1b[40m                               \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mEXPOSE 8080\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[97;40mCMD ["bash","-lc","java $JAVA_OPTS -jar app.jar"]\x1b[0m\x1b[40m                              \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    '',
    'Kubernetes manifests (Deployment + Service):                                    ',
    '',
    '',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
    '',
    '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mdemo                                                                  \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps/v1                                                           \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mService                                                                 \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mjava-hello                                                            \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mtype\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mClusterIP                                                             \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    'Build/push and deploy:                                                          ',
    '',
    '\x1b[1;33m \u2022 \x1b[0mBuild: docker build -t ghcr.io/yourorg/java-hello:1.0.0 .                    ',
    '\x1b[1;33m \u2022 \x1b[0mApply: kubectl apply -f k8s.yaml                                             ',
    '',
    'Notes:                                                                          ',
    '',
    '\x1b[1;33m \u2022 \x1b[0mFor HPA to work, install metrics-server in the cluster.                      ',
    '',
    '\x1b[?2004hroot@aks-agent-846df6ffb-tz9xn:/app# ',
  ].join('\r\n');

  it('joins terminal-wrapped prose into a single paragraph', () => {
    const result = extractAIAnswer(rawJavaDeployTerminal);
    // "Here's a minimal..." and "app on Kubernetes..." should be one paragraph
    // (no blank line between them), so markdown joins them
    expect(result).toContain(
      "Here's a minimal, production-ready example for deploying a Java (Spring Boot)\napp on Kubernetes."
    );
    // Should NOT have a blank line between the continuation lines
    expect(result).not.toMatch(/Here's a minimal.*\(Spring Boot\)\s*\n\n\s*app on Kubernetes/);
    // "...Spring Boot" + "Actuator." continuation should also be joined
    expect(result).toMatch(/Spring Boot\nActuator\./);
  });

  it('wraps Dockerfile in a code fence including # syntax line', () => {
    const result = extractAIAnswer(rawJavaDeployTerminal);
    // The Dockerfile should be in a code fence
    expect(result).toContain('```\n# syntax=docker/dockerfile:1');
    expect(result).toContain('FROM maven:3.9-eclipse-temurin-17 AS build');
    expect(result).toContain('CMD ["bash","-lc","java $JAVA_OPTS -jar app.jar"]');
    // # syntax should NOT appear outside a code fence as a heading
    const fenceStart = result.indexOf('```\n# syntax');
    expect(fenceStart).toBeGreaterThan(-1);
  });

  it('collapses Dockerfile stages without extra blank lines', () => {
    const result = extractAIAnswer(rawJavaDeployTerminal);
    // Terminal formatting artefact blank lines are collapsed; Dockerfile stages
    // are adjacent (the intentional blank between stages is collapsed by the
    // upstream stripAgentNoise blank-collapsing step — this is acceptable since
    // the Dockerfile remains syntactically correct)
    expect(result).toMatch(/RUN mvn.*package\nFROM eclipse-temurin/);
  });

  it('removes terminal-artefact blank lines within Dockerfile', () => {
    const result = extractAIAnswer(rawJavaDeployTerminal);
    // Adjacent Dockerfile instructions should NOT have blank lines between them
    expect(result).toMatch(/FROM maven.*AS build\nWORKDIR \/src/);
    expect(result).toMatch(/WORKDIR \/src\nCOPY pom\.xml/);
  });

  it('wraps YAML block without blank lines between YAML lines', () => {
    const result = extractAIAnswer(rawJavaDeployTerminal);
    // YAML should be in a fenced block
    expect(result).toContain('```yaml');
    // apiVersion and kind should be on adjacent lines (no blank between them)
    expect(result).toMatch(/apiVersion: v1\nkind: Namespace/);
    expect(result).toMatch(/apiVersion: apps\/v1\nkind: Service/);
  });

  it('bullet list items are present', () => {
    const result = extractAIAnswer(rawJavaDeployTerminal);
    expect(result).toContain('- Build: docker build -t ghcr.io/yourorg/java-hello:1.0.0 .');
    expect(result).toContain('- Apply: kubectl apply -f k8s.yaml');
  });
});

// ─── Real-world Java deployment with Option A / Option B structure ────────────

describe('extractAIAnswer — real-world Java deploy with Option A/B and Rich panels', () => {
  // Reconstructed from real dev console logs: aks-agent response with
  // Rich-panel YAML and kubectl code blocks, centered "Option B" heading,
  // Java source code, and Dockerfile.
  const rawJavaDeployOptionAB = [
    'stty -echo',
    '\x1b[?2004l',
    '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
    '\x1b[?2004l',
    '',
    '\x1b[?2004h> ',
    '\x1b[?2004l',
    '',
    '\x1b[?2004h> ',
    '\x1b[?2004l',
    '',
    "Loaded models: \x1b[1m[\x1b[0m\x1b[32m'azure/gpt-5.2'\x1b[0m\x1b[1m]\x1b[0m",
    '\u2705 Toolset core_investigation',
    '\u2705 Toolset internet',
    '\u2705 Toolset aks_mcp',
    'Using \x1b[1;36m3\x1b[0m datasources',
    'NO ENABLED LOGGING TOOLSET',
    '\x1b[1;97mUser:\x1b[0m IMPORTANT INSTRUCTIONS:',
    'Now answer the following new question:',
    'Show me how to deploy an example java application on kubernetes?',
    'The AI requested \x1b[1;36m1\x1b[0m tool call.',
    'Running tool #\x1b[1;36m1\x1b[0m \x1b[1mTodoWrite\x1b[0m: Update investigation tasks',
    'Task List:',
    '+----+----------+---------------+',
    '| ID | Content  | Status        |',
    '+----+----------+---------------+',
    '| 1  | Deploy   | completed     |',
    '+----+----------+---------------+',
    '  Finished #1 in 0.00s',
    '',
    '\x1b[1;96mAI:\x1b[0m ',
    // ── Option A: prebuilt image ──
    '     \x1b[1mOption A (fastest): deploy a prebuilt example Java (Spring Boot) image\x1b[0m     ',
    '',
    'Apply this manifest:                                                            ',
    '',
    // YAML in Rich panel (black background, syntax-highlighted)
    '\x1b[40m                                                                                \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mjava-demo                                                             \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps/v1                                                           \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mDeployment                                                              \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                      \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mnamespace\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mjava-demo                                                        \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mreplicas\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m2                                                                 \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mselector\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[91;40mmatchLabels\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                              \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m      \x1b[0m\x1b[91;40mapp\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                   \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mService                                                                 \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                      \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mselector\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[91;40mapp\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mspring-boot-demo                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mports\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                      \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[40m-\x1b[0m\x1b[97;40m \x1b[0m\x1b[91;40mport\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m80                                                                \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m      \x1b[0m\x1b[91;40mtargetPort\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m8080                                                        \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mtype\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mClusterIP                                                             \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    'Run:                                                                            ',
    '',
    '\x1b[40m                                                                                \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapply\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-f\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapp.yaml\x1b[0m\x1b[40m                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mget\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpods\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-n\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mjava-demo\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-w\x1b[0m\x1b[40m                                              \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mport-forward\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-n\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mjava-demo\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40msvc/spring-boot-demo\x1b[0m\x1b[97;40m \x1b[0m\x1b[37;40m8080\x1b[0m\x1b[97;40m:80\x1b[0m\x1b[40m                \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[37;40m# then open http://localhost:8080\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    '',
    // Rich separator and centered heading
    '\x1b[33m\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\x1b[0m',
    '            \x1b[1mOption B: build your own tiny Java app image + deploy it\x1b[0m            ',
    '',
    '\x1b[1m1) Minimal Spring Boot app + Dockerfile\x1b[0m                                         ',
    '',
    'Use Spring Initializr (Web dependency), then add a controller like:             ',
    '',
    // Java code in Rich panel
    '\x1b[40m                                                                                \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[92;40m@RestController\x1b[0m\x1b[40m                                                               \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mclass\x1b[0m\x1b[97;40m \x1b[0m\x1b[92;40mHelloController\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m{\x1b[0m\x1b[40m                                                       \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[92;40m@GetMapping\x1b[0m\x1b[97;40m(\x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40m/\x1b[0m\x1b[93;40m"\x1b[0m\x1b[97;40m)\x1b[0m\x1b[40m                                                            \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[97;40mString\x1b[0m\x1b[97;40m \x1b[0m\x1b[92;40mhello\x1b[0m\x1b[97;40m(\x1b[0m\x1b[97;40m)\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m{\x1b[0m\x1b[97;40m \x1b[0m\x1b[96;40mreturn\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mhello from k8s\x1b[0m\x1b[93;40m"\x1b[0m\x1b[97;40m;\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m}\x1b[0m\x1b[40m                                 \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40m}\x1b[0m\x1b[40m                                                                             \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    'Dockerfile (builds and runs jar):                                               ',
    '',
    // Dockerfile in Rich panel
    '\x1b[40m                                                                                \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mFROM\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40meclipse-temurin:21-jdk\x1b[0m\x1b[97;40m \x1b[0m\x1b[96;40mAS\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40mbuild\x1b[0m\x1b[40m                                          \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mWORKDIR\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m/src\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[40m                                                                      \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mRUN\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m./mvnw\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-q\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-DskipTests\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpackage\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[40m                                                                              \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mFROM\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40meclipse-temurin:21-jre\x1b[0m\x1b[40m                                                   \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mWORKDIR\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m/app\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mCOPY\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m--from\x1b[0m\x1b[91;40m=\x1b[0m\x1b[97;40mbuild\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m/src/target/*.jar\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m/app/app.jar\x1b[0m\x1b[40m                              \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mEXPOSE\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m8080\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[96;40mENTRYPOINT\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m[\x1b[0m\x1b[93;40m"java"\x1b[0m\x1b[97;40m,\x1b[0m\x1b[93;40m"-jar"\x1b[0m\x1b[97;40m,\x1b[0m\x1b[93;40m"/app/app.jar"\x1b[0m\x1b[97;40m]\x1b[0m\x1b[40m                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    '\x1b[1m2) Build + push\x1b[0m                                                                 ',
    '',
    '\x1b[40m                                                                                \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40mdocker\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mbuild\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-t\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m<your-registry>/<your-repo>/spring-boot-demo:1.0\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m.\x1b[0m\x1b[40m            \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40mdocker\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mpush\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m<your-registry>/<your-repo>/spring-boot-demo:1.0\x1b[0m\x1b[40m                  \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    '\x1b[1m3) Update Deployment image\x1b[0m In the Deployment above, set:                        ',
    '',
    '\x1b[40m                                                                                \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[91;40mimage\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m<your-registry>/<your-repo>/spring-boot-demo:1.0                       \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    'Then:                                                                           ',
    '',
    '\x1b[40m                                                                                \x1b[0m',
    '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapply\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-f\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapp.yaml\x1b[0m\x1b[40m                                                     \x1b[0m\x1b[40m \x1b[0m',
    '\x1b[40m                                                                                \x1b[0m',
    '',
    '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
  ].join('\r\n');

  it('does not absorb "Option B" heading into kubectl code block', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    // After the kubectl code fence closes, "Option B:" should appear as prose
    expect(result).toMatch(/# then open http:\/\/localhost:8080\n```[\s\S]*Option B/);
    // "Option B:" should be visible as prose/heading text
    expect(result).toContain('Option B');
  });

  it('wraps kubectl commands in a code fence', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    expect(result).toContain('kubectl apply -f app.yaml');
    expect(result).toContain('kubectl get pods -n java-demo -w');
    expect(result).toContain('kubectl port-forward');
    // Shell comment should be in same code block as kubectl commands
    expect(result).toContain('# then open http://localhost:8080');
  });

  it('wraps YAML in a yaml-fenced code block', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    expect(result).toContain('```yaml');
    expect(result).toMatch(/apiVersion: v1\nkind: Namespace/);
    expect(result).toMatch(/apiVersion: apps\/v1\nkind: Deployment/);
    expect(result).toMatch(/apiVersion: v1\nkind: Service/);
  });

  it('wraps Dockerfile in a code fence', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    expect(result).toContain('FROM eclipse-temurin:21-jdk AS build');
    expect(result).toContain('WORKDIR /src');
    expect(result).toContain('COPY . .');
    expect(result).toContain('RUN ./mvnw -q -DskipTests package');
    expect(result).toContain('ENTRYPOINT ["java","-jar","/app/app.jar"]');
  });

  it('wraps docker build/push commands in a code fence', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    expect(result).toContain('docker build -t');
    expect(result).toContain('docker push');
  });

  it('preserves numbered section headers outside code blocks', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    expect(result).toMatch(/1\).*Minimal Spring Boot/);
    expect(result).toMatch(/2\).*Build \+ push/);
    expect(result).toMatch(/3\).*Update Deployment image/);
  });

  it('keeps prose text outside code fences', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    expect(result).toContain('Apply this manifest:');
    expect(result).toContain('Run:');
    expect(result).toContain('Use Spring Initializr');
    expect(result).toContain('Then:');
  });

  it('wraps trailing kubectl apply -f in a code fence, not as emphasis', () => {
    const result = extractAIAnswer(rawJavaDeployOptionAB);
    // The trailing 'kubectl apply -f app.yaml' MUST be inside a code fence
    const lastKubectl = result.lastIndexOf('kubectl apply -f app.yaml');
    expect(lastKubectl).toBeGreaterThan(-1);
    // Check that there's a ``` fence before it (and no unclosed fence between)
    const before = result.slice(0, lastKubectl);
    const fencesBefore = (before.match(/```/g) || []).length;
    // Odd number of fences before = inside a fence (good)
    expect(fencesBefore % 2).toBe(1);
  });
});

// ─── Kubernetes-focused normalizeTerminalMarkdown tests ──────────────────────

describe('normalizeTerminalMarkdown — Kubernetes / kubectl scenarios', () => {
  it('wraps indented kubectl commands in a code fence', () => {
    const input = [
      'Run these commands:',
      '',
      ' kubectl apply -f deployment.yaml',
      ' kubectl get pods -n my-namespace',
      ' kubectl rollout status deployment/my-app',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```\nkubectl apply -f deployment.yaml');
    expect(result).toContain('kubectl rollout status deployment/my-app\n```');
  });

  it('wraps indented helm commands in a code fence', () => {
    const input = [
      'Install the chart:',
      '',
      ' helm repo add bitnami https://charts.bitnami.com/bitnami',
      ' helm install my-release bitnami/nginx',
      ' helm upgrade my-release bitnami/nginx --set replicaCount=3',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```\nhelm repo add');
    expect(result).toContain('helm upgrade my-release');
  });

  it('stops code block before centered heading after kubectl commands', () => {
    const input = [
      ' kubectl apply -f app.yaml',
      ' kubectl get pods -n java-demo -w',
      ' kubectl port-forward -n java-demo svc/demo 8080:80',
      ' # then open http://localhost:8080',
      '            Option B: build your own app',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    // kubectl commands should be in a code fence
    expect(result).toContain('```\nkubectl apply');
    // "Option B:" should NOT be inside the code fence
    expect(result).not.toMatch(/```[^`]*Option B[^`]*```/);
    expect(result).toContain('Option B: build your own app');
  });

  it('stops code block at blank line followed by non-code prose', () => {
    const input = [
      ' kubectl apply -f app.yaml',
      ' kubectl get pods -w',
      '',
      'Next, configure the ingress:',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```\nkubectl apply');
    expect(result).toContain('kubectl get pods -w\n```');
    expect(result).toContain('Next, configure the ingress:');
  });

  it('keeps shell comments with URLs inside kubectl code blocks', () => {
    const input = [
      ' kubectl port-forward svc/my-app 8080:80',
      ' # then visit http://localhost:8080',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('kubectl port-forward');
    expect(result).toContain('# then visit http://localhost:8080');
  });

  it('wraps az aks commands in code fence', () => {
    const input = [
      'Create your cluster:',
      '',
      ' az aks create -g myRG -n myCluster --node-count 3',
      ' az aks get-credentials -g myRG -n myCluster',
      ' kubectl get nodes',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    expect(result).toContain('```\naz aks create');
    expect(result).toContain('kubectl get nodes\n```');
  });

  it('does not absorb prose into kubectl code blocks across blank lines', () => {
    const input = [
      ' kubectl create namespace monitoring',
      ' kubectl apply -f prometheus.yaml',
      '',
      ' This will create the monitoring stack.',
    ].join('\n');
    const result = normalizeTerminalMarkdown(input);
    // The prose line starts with space but isn't code
    expect(result).toContain('```\nkubectl create namespace monitoring');
    expect(result).toContain('kubectl apply -f prometheus.yaml\n```');
  });
});

// ─── Kubernetes-focused collapseTerminalBlankLines tests ─────────────────────

describe('collapseTerminalBlankLines — Kubernetes / centered heading scenarios', () => {
  it('preserves blank line between kubectl code and a centered heading', () => {
    const input = [
      ' kubectl apply -f app.yaml',
      '',
      '            Option B: build your own app',
    ].join('\n');
    const result = collapseTerminalBlankLines(input);
    // The blank should be preserved (centered heading is NOT terminal code)
    expect(result).toContain('kubectl apply -f app.yaml\n\n');
    expect(result).toContain('Option B: build your own app');
  });

  it('still collapses blanks between kubectl commands (both 1-space indented)', () => {
    const input = [' kubectl apply -f deployment.yaml', '', ' kubectl get pods -n default'].join(
      '\n'
    );
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe(' kubectl apply -f deployment.yaml\n kubectl get pods -n default');
  });

  it('collapses blanks between YAML lines with typical Rich indentation', () => {
    const input = [' apiVersion: v1', '', ' kind: Service', '', ' metadata:'].join('\n');
    const result = collapseTerminalBlankLines(input);
    expect(result).toBe(' apiVersion: v1\n kind: Service\n metadata:');
  });
});

// ─── Shell comment detection in looksLikeShellOrDockerCodeLine ───────────────

describe('looksLikeShellOrDockerCodeLine — shell comments with URLs', () => {
  it('detects shell comments containing URLs', () => {
    expect(looksLikeShellOrDockerCodeLine('# then open http://localhost:8080')).toBe(true);
    expect(looksLikeShellOrDockerCodeLine('# visit https://example.com/api')).toBe(true);
  });

  it('detects shell comments containing paths', () => {
    expect(looksLikeShellOrDockerCodeLine('# edit /etc/nginx/nginx.conf')).toBe(true);
    expect(looksLikeShellOrDockerCodeLine('# see /var/log/syslog for details')).toBe(true);
  });

  it('does NOT detect generic prose comments as code', () => {
    // No URL, no path — this is more like markdown
    expect(looksLikeShellOrDockerCodeLine('# This is a heading')).toBe(false);
    expect(looksLikeShellOrDockerCodeLine('# Notes about deployment')).toBe(false);
  });

  it('still detects Dockerfile parser directives', () => {
    expect(looksLikeShellOrDockerCodeLine('# syntax=docker/dockerfile:1')).toBe(true);
    expect(looksLikeShellOrDockerCodeLine('# escape=\\')).toBe(true);
    expect(looksLikeShellOrDockerCodeLine('# check=skip=all')).toBe(true);
  });
});

// ─── More Kubernetes YAML / kubectl extractAIAnswer tests ────────────────────

describe('extractAIAnswer — Kubernetes kubectl and YAML patterns', () => {
  it('handles kubectl get with wide output and JSON format', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Check your pods:',
      '',
      ' kubectl get pods -n kube-system -o wide',
      ' kubectl get svc -o json | jq .items[].metadata.name',
      '',
      'Look for any pods in CrashLoopBackOff state.',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('kubectl get pods -n kube-system -o wide');
    expect(result).toContain('kubectl get svc -o json');
    expect(result).toContain('CrashLoopBackOff');
  });

  it('handles mixed kubectl describe and logs commands', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Debug the failing pod:',
      '',
      ' kubectl describe pod my-app-xyz -n default',
      ' kubectl logs my-app-xyz -n default --previous',
      ' kubectl get events -n default --sort-by=.lastTimestamp',
      '',
      'The events will show scheduling failures and OOM kills.',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('kubectl describe pod');
    expect(result).toContain('kubectl logs my-app-xyz');
    expect(result).toContain('kubectl get events');
    expect(result).toContain('The events will show scheduling failures');
  });

  it('handles kubectl apply with multi-resource YAML', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Apply the following:',
      '',
      '```yaml',
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: app-config',
      '  namespace: default',
      'data:',
      '  APP_ENV: production',
      '---',
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: my-app',
      '  namespace: default',
      'spec:',
      '  replicas: 3',
      '  selector:',
      '    matchLabels:',
      '      app: my-app',
      '  template:',
      '    metadata:',
      '      labels:',
      '        app: my-app',
      '    spec:',
      '      containers:',
      '        - name: app',
      '          image: myregistry/my-app:latest',
      '          envFrom:',
      '            - configMapRef:',
      '                name: app-config',
      '```',
      '',
      'Then run:',
      '',
      ' kubectl apply -f manifests.yaml',
      ' kubectl rollout status deployment/my-app -n default',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```yaml\napiVersion: v1');
    expect(result).toContain('kind: ConfigMap');
    expect(result).toContain('kind: Deployment');
    expect(result).toContain('envFrom:');
    expect(result).toContain('kubectl apply -f manifests.yaml');
    expect(result).toContain('kubectl rollout status');
  });

  it('handles kubectl exec and port-forward commands', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Connect to your pod:',
      '',
      ' kubectl exec -it my-app-pod -n default -- /bin/bash',
      ' kubectl port-forward svc/my-app 8080:80 -n default',
      ' # then curl http://localhost:8080/healthz',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('kubectl exec -it');
    expect(result).toContain('kubectl port-forward');
    expect(result).toContain('# then curl http://localhost:8080/healthz');
  });

  it('handles bare YAML with HPA resource', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Here is a HorizontalPodAutoscaler:',
      '',
      'apiVersion: autoscaling/v2',
      'kind: HorizontalPodAutoscaler',
      'metadata:',
      '  name: my-app',
      '  namespace: default',
      'spec:',
      '  scaleTargetRef:',
      '    apiVersion: apps/v1',
      '    kind: Deployment',
      '    name: my-app',
      '  minReplicas: 2',
      '  maxReplicas: 10',
      '  metrics:',
      '    - type: Resource',
      '      resource:',
      '        name: cpu',
      '        target:',
      '          type: Utilization',
      '          averageUtilization: 70',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```yaml');
    expect(result).toContain('kind: HorizontalPodAutoscaler');
    expect(result).toContain('averageUtilization: 70');
  });

  it('handles kubectl with Azure AKS commands', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Scale your AKS cluster:',
      '',
      ' az aks scale -g myRG -n myCluster --node-count 5',
      ' az aks nodepool add -g myRG --cluster-name myCluster -n gpupool --node-count 2 --node-vm-size Standard_NC6',
      ' kubectl get nodes -o wide',
      '',
      'The GPU nodepool will take a few minutes to provision.',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('az aks scale');
    expect(result).toContain('az aks nodepool add');
    expect(result).toContain('kubectl get nodes -o wide');
  });

  it('handles Kubernetes NetworkPolicy YAML', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Create a NetworkPolicy to restrict traffic:',
      '',
      '```yaml',
      'apiVersion: networking.k8s.io/v1',
      'kind: NetworkPolicy',
      'metadata:',
      '  name: deny-all',
      '  namespace: production',
      'spec:',
      '  podSelector: {}',
      '  policyTypes:',
      '    - Ingress',
      '    - Egress',
      '```',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```yaml');
    expect(result).toContain('kind: NetworkPolicy');
    expect(result).toContain('podSelector: {}');
    expect(result).toContain('policyTypes:');
  });

  it('handles kubectl create secret and configmap', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Create secrets and config:',
      '',
      ' kubectl create secret generic db-creds --from-literal=password=s3cret -n default',
      ' kubectl create configmap app-config --from-file=config.yaml -n default',
      ' kubectl get secrets -n default',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('kubectl create secret generic');
    expect(result).toContain('kubectl create configmap');
    expect(result).toContain('kubectl get secrets');
  });

  it('handles terminal-wrapped YAML values (key: on one line, value on next)', () => {
    // Simulates Rich terminal formatting where long YAML values wrap to next line
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Below is a multi-document YAML example for a microservice setup.',
      '',
      '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mConfigMap                                                               \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mglobal-config                                                         \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mdata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mLOG_LEVEL\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40minfo\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                                                           \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mOTEL_EXPORTER_OTLP_ENDPOINT\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m                                               \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mhttp://otel-collector.observability.svc.cluster.local:4317\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                  \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mSecret                                                                  \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mdb-credentials                                                        \x1b[0m\x1b[40m \x1b[0m',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    // The OTEL endpoint URL must be INSIDE the yaml fence, not outside
    expect(result).toContain('OTEL_EXPORTER_OTLP_ENDPOINT:');
    expect(result).toContain('"http://otel-collector.observability.svc.cluster.local:4317"');
    // Both ConfigMap and Secret should be in a single yaml block
    expect(result).toContain('kind: ConfigMap');
    expect(result).toContain('kind: Secret');
    const yamlFences = (result.match(/```yaml/g) || []).length;
    expect(yamlFences).toBe(1);
  });

  it('handles terminal-wrapped YAML with unclosed flow braces', () => {
    // Simulates Rich terminal wrapping a long flow expression across lines
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Here is the StatefulSet:',
      '',
      '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps/v1                                                           \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mStatefulSet                                                             \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[91;40mspec\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mcontainers\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                             \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m    \x1b[0m\x1b[40m-\x1b[0m\x1b[97;40m \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mpostgres                                                      \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m      \x1b[0m\x1b[91;40menv\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m        \x1b[0m\x1b[40m-\x1b[0m\x1b[97;40m \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mPOSTGRES_USER                                             \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40m          \x1b[0m\x1b[91;40mvalueFrom\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m{\x1b[0m\x1b[91;40m secretKeyRef\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m{\x1b[0m\x1b[91;40m name\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mdb-credentials\x1b[0m\x1b[40m,\x1b[0m\x1b[91;40m key\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m        \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40mPOSTGRES_USER\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m}\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m}                                                             \x1b[0m\x1b[40m \x1b[0m',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    // The continuation 'POSTGRES_USER } }' must be inside the yaml fence
    expect(result).toContain('POSTGRES_USER } }');
    expect(result).toContain('```yaml');
    // Should be one yaml block
    const yamlFences = (result.match(/```yaml/g) || []).length;
    expect(yamlFences).toBe(1);
  });
});

// ─── Bare code block wrapping in extractAIAnswer (curl, kubectl, etc.) ───────

describe('extractAIAnswer — bare code line wrapping', () => {
  it('wraps bare curl command in code fence', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Test the endpoint:',
      '',
      'curl http://localhost:8080/health',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```\ncurl http://localhost:8080/health\n```');
  });

  it('wraps bare curl with flags in code fence', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Check the service:',
      '',
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:8080',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```\ncurl');
  });

  it('wraps bare kubectl commands in code fence', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Apply and check:',
      '',
      'kubectl apply -f app.yaml',
      'kubectl get pods -n demo',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```\nkubectl apply -f app.yaml\nkubectl get pods -n demo\n```');
  });

  it('wraps bare docker build + push in code fence', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Build and push:',
      '',
      'docker build -t myapp:latest .',
      'docker push myapp:latest',
      '',
      'Then deploy.',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```\ndocker build -t myapp:latest .\ndocker push myapp:latest\n```');
  });

  it('wraps bare helm install in code fence', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Install nginx ingress:',
      '',
      'helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx',
      'helm install nginx ingress-nginx/ingress-nginx --namespace ingress --create-namespace',
      '',
      'Wait for the external IP.',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```\nhelm repo add');
    expect(result).toContain('helm install nginx');
  });

  it('preserves YAML in yaml fence and wraps bare curl separately', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Apply:',
      '',
      '```yaml',
      'apiVersion: v1',
      'kind: Service',
      'metadata:',
      '  name: myapp',
      '```',
      '',
      'Then test:',
      '',
      'curl http://localhost:8080',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```yaml\napiVersion: v1');
    expect(result).toContain('```\ncurl http://localhost:8080\n```');
  });

  it('wraps bare az aks commands in code fence', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Get your kubeconfig:',
      '',
      'az aks get-credentials --resource-group myRG --name myCluster',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```\naz aks get-credentials');
  });

  it('does not wrap prose mentioning commands', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'You can use kubectl to check pod status. The curl command tests connectivity.',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    // Prose should NOT be wrapped in code fences
    expect(result).not.toContain('```');
  });

  it('wraps single indented kubectl line from terminal output in code fence', () => {
    const raw = [
      '\x1b[1;96mAI:\x1b[0m ',
      'Then:',
      '',
      '\x1b[40m                                                                                \x1b[0m',
      '\x1b[40m \x1b[0m\x1b[97;40mkubectl\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapply\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40m-f\x1b[0m\x1b[97;40m \x1b[0m\x1b[97;40mapp.yaml\x1b[0m\x1b[40m                                                     \x1b[0m\x1b[40m \x1b[0m',
      '\x1b[40m                                                                                \x1b[0m',
      '',
      '\x1b[?2004hroot@aks-agent:/app# ',
    ].join('\r\n');
    const result = extractAIAnswer(raw);
    expect(result).toContain('```');
    expect(result).toContain('kubectl apply -f app.yaml');
  });
});

// ── Real-world microservice YAML with Rich terminal formatting ──

const rawMicroserviceYaml = [
  'stty -echo',
  '\x1b[?2004l',
  '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
  '\x1b[?2004l\r',
  '\x1b[?2004h> ',
  '\x1b[?2004l\r',
  '\x1b[1;96mAI:\x1b[0m ',
  'Below is a single (large) multi-document YAML example for a "complicated"       ',
  'microservice setup: multiple namespaces, shared config, secrets, several        ',
  'microservices, HPAs, PDBs, NetworkPolicies, an Ingress, a CronJob, and a Job.   ',
  '',
  '\x1b[40m                                                                                \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# Namespaces\x1b[0m\x1b[40m                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mplatform                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mNamespace                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[40m                                                                              \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# Shared config/secrets\x1b[0m\x1b[40m                                                       \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[37;40m# --------------------------------------------------------\x1b[0m\x1b[40m                    \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mConfigMap                                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mglobal-config                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mnamespace\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mapps                                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mdata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                         \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mLOG_LEVEL\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40minfo\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mOTEL_EXPORTER_OTLP_ENDPOINT\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40m                                               \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mhttp://otel-collector.observability.svc.cluster.local:4317\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m---\x1b[0m\x1b[40m                                                                           \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mapiVersion\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mv1                                                                \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mkind\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mSecret                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mmetadata\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mname\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mdb-credentials                                                        \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mtype\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[40mOpaque                                                                  \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[91;40mstringData\x1b[0m\x1b[97;40m:\x1b[0m\x1b[40m                                                                   \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mPOSTGRES_USER\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mappuser\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                                                     \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m \x1b[0m\x1b[97;40m  \x1b[0m\x1b[91;40mPOSTGRES_PASSWORD\x1b[0m\x1b[97;40m:\x1b[0m\x1b[97;40m \x1b[0m\x1b[93;40m"\x1b[0m\x1b[93;40mreplace-me\x1b[0m\x1b[93;40m"\x1b[0m\x1b[40m                                             \x1b[0m\x1b[40m \x1b[0m',
  '\x1b[40m                                                                                \x1b[0m',
  '',
  'If you want it even more "realistic complicated", tell me what stack you want   ',
  "included (Istio/Linkerd, Kafka, etc.) and I'll tailor the example.              ",
  '',
  '\x1b[?2004hroot@aks-agent-649f94dbb9-whtf8:/app# ',
].join('\r\n');

describe('extractAIAnswer — real-world microservice YAML with Rich terminal formatting', () => {
  let result: string;
  let yamlContent: string;
  let docs: YAML.Document.Parsed[];

  beforeAll(() => {
    result = extractAIAnswer(rawMicroserviceYaml);
    const yamlMatch = result.match(/```yaml\n([\s\S]*?)```/);
    yamlContent = yamlMatch ? yamlMatch[1] : '';
    docs = YAML.parseAllDocuments(yamlContent);
  });

  it('produces exactly one yaml-fenced block', () => {
    expect((result.match(/```yaml/g) || []).length).toBe(1);
  });

  it('includes YAML section comments inside the fence', () => {
    expect(yamlContent).toContain('# Namespaces');
    expect(yamlContent).toContain('# Shared config/secrets');
  });

  it('does NOT render # Namespaces as a markdown heading', () => {
    let inFence = false;
    for (const line of result.split('\n')) {
      if (line.trim().startsWith('```')) inFence = !inFence;
      // CommonMark allows up to 3 spaces before # for headings
      if (!inFence && /^\s{0,3}#\s/.test(line) && line.includes('Namespaces')) {
        throw new Error(`"# Namespaces" outside fence would render as heading: ${line}`);
      }
    }
  });

  it('all YAML documents parse without errors', () => {
    const errors = docs.flatMap(d => d.errors);
    expect(errors).toHaveLength(0);
  });

  it('contains exactly 4 YAML documents', () => {
    expect(docs.length).toBe(4);
  });

  it('document 1 is Namespace "platform"', () => {
    const doc = docs[0].toJSON();
    expect(doc.apiVersion).toBe('v1');
    expect(doc.kind).toBe('Namespace');
    expect(doc.metadata.name).toBe('platform');
  });

  it('document 2 is Namespace "apps"', () => {
    const doc = docs[1].toJSON();
    expect(doc.apiVersion).toBe('v1');
    expect(doc.kind).toBe('Namespace');
    expect(doc.metadata.name).toBe('apps');
  });

  it('document 3 is ConfigMap "global-config" in namespace "apps"', () => {
    const doc = docs[2].toJSON();
    expect(doc.apiVersion).toBe('v1');
    expect(doc.kind).toBe('ConfigMap');
    expect(doc.metadata.name).toBe('global-config');
    expect(doc.metadata.namespace).toBe('apps');
  });

  it('ConfigMap has correct data keys including terminal-wrapped OTEL value', () => {
    const data = docs[2].toJSON().data;
    expect(data.LOG_LEVEL).toBe('info');
    expect(data.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
      'http://otel-collector.observability.svc.cluster.local:4317'
    );
  });

  it('terminal-wrapped OTEL value is joined onto the key line', () => {
    expect(yamlContent).toContain(
      'OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.observability.svc.cluster.local:4317"'
    );
  });

  it('document 4 is Secret "db-credentials" with correct stringData', () => {
    const doc = docs[3].toJSON();
    expect(doc.apiVersion).toBe('v1');
    expect(doc.kind).toBe('Secret');
    expect(doc.metadata.name).toBe('db-credentials');
    expect(doc.type).toBe('Opaque');
    expect(doc.stringData.POSTGRES_USER).toBe('appuser');
    expect(doc.stringData.POSTGRES_PASSWORD).toBe('replace-me');
  });

  it('parseKubernetesYAML recognises multi-document YAML as valid K8s', () => {
    const parsed = parseKubernetesYAML(yamlContent);
    expect(parsed.isValid).toBe(true);
    expect(parsed.resourceType).toBe('Namespace');
    expect(parsed.name).toBe('platform');
  });

  it('prose paragraph appears outside the yaml fence', () => {
    const afterFence = result.split('```').pop() || '';
    expect(afterFence).toContain('If you want it even more');
  });
});
