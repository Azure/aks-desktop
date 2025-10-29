const fs = require('fs');
const path = require('path');

// Read AKS Desktop version from the root package.json
let aksDesktopVersion;
try {
  const aksDesktopPackageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
  );
  aksDesktopVersion = aksDesktopPackageJson.version;
} catch (e) {
  console.error('Could not read AKS Desktop version from package.json:', e.message);
  process.exit(1);
}

// Read the base package.json to get the build configuration
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// Override the build configuration with the AKS desktop version
const config = {
  ...packageJson.build,
  buildVersion: aksDesktopVersion,
  // Use buildVersion in artifact names
  artifactName: '${name}-' + aksDesktopVersion + '-${os}-${arch}.${ext}',
};

// Override the deb artifactName as well
if (config.deb) {
  config.deb = {
    ...config.deb,
    artifactName: '${name}_' + aksDesktopVersion + '-1_${arch}.${ext}',
  };
}

// On non-Mac platforms, ensure dmg-license is truly optional by not including Mac targets during --dir builds
// This prevents electron-builder from trying to validate Mac-specific dependencies on Linux/Windows
if (process.env.npm_lifecycle_event === 'build' && process.platform !== 'darwin') {
  // For unpacked builds on non-Mac, don't include Mac configuration
  delete config.mac;
}

module.exports = config;
